import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { lineMap, stationGeometryByCode, lineCodesByStationCode } from '../../data/line-map'
import type { LineRow } from '../../lib/station-master'
import { searchStations } from '../../lib/station-search'
import { useLineMapData } from './line-map-data'
import { useSession } from '../../auth/session-context'
import { LineMapCanvas } from './LineMapCanvas'
import type { LineMapCanvasHandle, LineMapTransform, MapLine, MapStation } from './LineMapCanvas'
import styles from './line-map.module.css'

type MapData = ReturnType<typeof useLineMapData>
let savedViewport: { scope: string; lineId: string; transform: LineMapTransform; revision: string } | null = null

type LineOption = { id: string; label: string; codes: string[]; color: string }
const LINE_NAMES: Record<string, string> = {
  'line-bundang': '수인·분당선', 'line-airport': '공항철도', 'line-incheon1': '인천1호선',
  'line-incheon2': '인천2호선', 'line-sillim': '신림선', 'line-gimpo': '김포골드라인',
  'line-uisinseol': '우이신설선', 'line-uijeongbu': '의정부경전철',
}
function buildLineOptions(lines: LineRow[]): LineOption[] {
  const groups = new Map<string, { order: number; name: string; codes: string[] }>()
  for (const l of lines.filter(l => l.is_active)) {
    const found = groups.get(l.color_token)
    if (found) { found.codes.push(l.code); found.order = Math.min(found.order, l.sort_order) }
    else groups.set(l.color_token, { order: l.sort_order, name: l.name, codes: [l.code] })
  }
  return [...groups].sort((a, b) => a[1].order - b[1].order).map(([token, group]) => ({
    id: [...group.codes].sort()[0], codes: group.codes, color: `var(--${token})`,
    label: /^line-[1-9]$/.test(token) ? `${token.slice(-1)}호선` : LINE_NAMES[token] ?? group.name,
  }))
}

export function LineMapScreen() {
  return <LineMapView {...useLineMapData()} />
}

/** 네트워크와 분리해 실제 전체 도식을 같은 렌더러로 검증할 수 있게 한다. */
export function LineMapView({ master, visits, reloadMaster, reloadVisits }: MapData) {
  const session = useSession()
  const scope = JSON.stringify([session.userId, session.couple?.id])
  const navigate = useNavigate()
  const canvasRef = useRef<LineMapCanvasHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLUListElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('line') ?? ''
  const [query, setQuery] = useState('')
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)
  const [ambiguous, setAmbiguous] = useState<MapStation[]>([])
  const masterData = master.kind === 'ready' ? master.master : null
  const counts = useMemo(() => visits.kind === 'ready' ? new Map(visits.rows.map(r => [r.station_id, r.visit_count])) : null, [visits])
  const options = useMemo(() => masterData ? buildLineOptions(masterData.lines) : [], [masterData])
  const selected = options.find(o => o.codes.includes(selectedId)) ?? null
  const selectedCodes = useMemo(() => selected ? new Set(selected.codes) : null, [selected])
  const drawable = useMemo(() => new Set(lineMap.lines.map(l => l.lineCode)), [])
  const selectedHasGeometry = selected === null || selected.codes.some(code => drawable.has(code))

  const view = useMemo(() => {
    if (!masterData) return null
    const rows = new Map(masterData.stations.map(s => [s.code, s]))
    const colors = new Map(masterData.lines.map(l => [l.code, `var(--${l.color_token})`]))
    const lines: MapLine[] = lineMap.lines.map(l => ({ code: l.id, points: l.polyline.map(p => p.join(',')).join(' '),
      color: colors.get(l.lineCode) ?? 'var(--line-default)', dimmed: selectedCodes !== null && !selectedCodes.has(l.lineCode) }))
    const stations: MapStation[] = []
    for (const geom of lineMap.stations) {
      const row = rows.get(geom.stationCode)
      if (!row?.is_active) continue
      const memberships = lineCodesByStationCode.get(geom.stationCode) ?? []
      const stationColors = [...new Set(memberships.map(code => colors.get(code) ?? 'var(--line-default)'))]
      stations.push({ code: row.code, id: row.id, name: row.name_short, x: geom.x, y: geom.y,
        labelAnchor: geom.labelAnchor, labelPriority: geom.labelPriority, labelOffset: geom.labelOffset,
        labelLines: geom.labelLines ?? [row.name_short], isTransfer: stationColors.length > 1,
        visitCount: counts === null ? null : counts.get(row.id) ?? 0,
        color: stationColors[0] ?? 'var(--line-default)', colors: stationColors,
        dimmed: selectedCodes !== null && !memberships.some(code => selectedCodes.has(code)) })
    }
    // 지리 위치를 안내하는 지도가 아닌, 도식 방향을 읽기 위한 한강 단서다.
    const riverAnchors: [string, number, number][] = [['홍대입구', -180, -120], ['합정', -110, 5], ['여의나루', 0, -50], ['동작', 0, -65], ['옥수', 60, 70], ['잠실나루', 130, -80]]
    const river = riverAnchors.flatMap(([name, dx, dy]) => { const s = stations.find(s => s.name === name); return s ? [`${s.x + dx},${s.y + dy}`] : [] }).join(' ')
    return { lines, stations, river }
  }, [masterData, counts, selectedCodes])
  const results = useMemo(() => searchStations(masterData?.stations ?? [], query), [masterData, query])
  const missing = useMemo(() => masterData?.stations.filter(s => s.is_active && s.in_mvp_scope && !stationGeometryByCode.has(s.code)) ?? [], [masterData])
  const totalVisited = counts === null ? null : view?.stations.filter(s => (counts.get(s.id) ?? 0) > 0).length ?? 0
  const mounted = view !== null

  // 스펙 03 F-21: 같은 필터/같은 도식 버전이면 복원을 자동 맞춤보다 우선한다.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    setAmbiguous([])
    if (savedViewport?.scope === scope && savedViewport.lineId === selectedId && savedViewport.revision === lineMap.revision) {
      canvas.setTransform(savedViewport.transform); savedViewport = null; return
    }
    savedViewport = null
    if (!selectedCodes || !selectedHasGeometry) { canvas.reset(); return }
    const points = lineMap.lines.filter(l => selectedCodes.has(l.lineCode)).flatMap(l => l.polyline)
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    canvas.fitTo({ x: Math.min(...xs) - 60, y: Math.min(...ys) - 60,
      width: Math.max(...xs) - Math.min(...xs) + 120, height: Math.max(...ys) - Math.min(...ys) + 120 })
  }, [mounted, selectedId, selectedCodes, selectedHasGeometry, scope])
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return () => { savedViewport = { scope, lineId: selectedId, transform: canvas.getTransform(), revision: lineMap.revision } }
  }, [mounted, selectedId, scope])
  useLayoutEffect(() => {
    if (!pendingFocus || !canvasRef.current) return
    canvasRef.current.focusOn(pendingFocus); setPendingFocus(null)
  }, [pendingFocus, selectedId, mounted])

  const goStation = useCallback((id: string) => navigate(`/stations/${id}`), [navigate])
  function showOnMap(code: string) {
    setQuery(''); setAmbiguous([])
    const next = new URLSearchParams(searchParams); next.delete('line')
    setSearchParams(next, { replace: true }); setPendingFocus(code)
  }
  function selectLine(id: string) {
    const next = new URLSearchParams(searchParams)
    if (id) next.set('line', id); else next.delete('line')
    setSearchParams(next, { replace: true })
  }

  return <div className={`${styles.screen} ${styles.mapScreen}`}>
    <header className={styles.mapHeader}>
      <div><p className={styles.eyebrow}>동네 발자취 · 수도권</p><h1 className={styles.mapTitle}>노선도</h1></div>
      <div className={styles.headerControls}>
        <Link className={styles.toggleLink} to="/map">지도 보기</Link>
        <Link className={styles.addRecord} to="/records/new">+ 기록 남기기</Link>
      </div>
    </header>
    {master.kind === 'failed' && <div className={styles.banner} role="alert"><span>역 정보를 불러오지 못했습니다.</span><button className={styles.bannerButton} onClick={reloadMaster}>다시 시도</button></div>}
    {visits.kind === 'failed' && <div className={styles.banner} role="alert"><span>방문 정보를 불러오지 못했어요.</span><button className={styles.bannerButton} onClick={reloadVisits}>다시 시도</button></div>}
    {masterData?.stale && <div className={styles.banner}>오프라인 — 저장된 역 정보로 표시 중이에요.</div>}
    <div className={styles.mapWorkspace}>
      <aside className={styles.sidebar} aria-label="노선도 탐색">
        <div className={styles.searchArea}>
          <label className="srOnly" htmlFor="station-search">역 이름 또는 초성 검색</label>
          <input ref={searchRef} id="station-search" className={styles.searchInput} type="search" placeholder="어느 역을 찾고 있나요?" autoComplete="off"
            value={query} disabled={!masterData} aria-controls={query.trim() ? 'station-search-results' : undefined}
            onChange={e => setQuery(e.target.value)} onKeyDown={e => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'ArrowDown') { e.preventDefault(); resultsRef.current?.querySelector<HTMLElement>('a')?.focus() }
              if (e.key === 'Enter' && results[0]) goStation(results[0].id)
            }} />
          {query.trim() && <div className={styles.searchDropdown}>
            <p className={styles.searchMeta} role="status">{results.length ? `${results.length}개 역 · 역 이름을 누르면 기록을 볼 수 있어요` : '검색 결과가 없어요. 다른 역 이름으로 찾아보세요.'}</p>
            <ul id="station-search-results" ref={resultsRef} className={styles.searchResults} onKeyDown={e => {
              if (e.key === 'Escape') { setQuery(''); searchRef.current?.focus() }
            }}>
              {results.map(s => <li key={s.code}>
                <Link to={`/stations/${s.id}`}><strong>{s.name_short}</strong><span>{stationGeometryByCode.has(s.code) ? '역 기록 보기' : s.in_mvp_scope ? '도식 준비 중 · 기록 보기' : '표시 범위 밖 · 기록 보기'}</span></Link>
                {stationGeometryByCode.has(s.code) && <button type="button" onClick={() => showOnMap(s.code)} aria-label={`${s.name_short} 노선도에서 보기`}>지도에서 보기</button>}
              </li>)}
            </ul>
          </div>}
        </div>
        <div className={styles.filterRow}>
          <label htmlFor="line-filter" className={styles.filterLabel}>노선</label>
          <select id="line-filter" className={styles.select} value={selected?.id ?? ''} disabled={!options.length} onChange={e => selectLine(e.target.value)}>
            <option value="">전체 노선</option>{options.filter(o => o.codes.some(c => drawable.has(c))).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" className={styles.textButton} onClick={() => { selectLine(''); canvasRef.current?.reset() }}>전체 보기</button>
        </div>
        <div className={styles.mapSummary}>
          <p className={styles.summaryLabel}>내가 남긴 발자취</p>
          <p className={styles.summaryCount}>{totalVisited === null ? '—' : totalVisited}<span> / {view?.stations.length ?? '—'}개 역</span></p>
          <p className={styles.summaryHint}>{visits.kind === 'ready' ? '다녀온 역을 눌러 그날의 기록을 만나보세요.' : visits.kind === 'failed' ? '방문 정보를 다시 불러와 주세요.' : '방문 정보를 확인하고 있어요.'}</p>
        </div>
        <div className={styles.quickStations}>
          <p className={styles.summaryLabel}>바로 둘러보기</p>
          <div>{['홍대입구', '강남', '잠실', '서울'].map(name => { const station = view?.stations.find(s => s.name === name)
            return station ? <button key={name} type="button" onClick={() => showOnMap(station.code)}>{name === '서울' ? '서울역' : name}</button> : null })}</div>
        </div>
        <div className={styles.sidebarLegend}><p className={styles.summaryLabel}>노선 안내</p><div className={styles.lineLegend}>{options.filter(o => o.codes.some(c => drawable.has(c))).map(o => <button key={o.id} type="button" onClick={() => selectLine(o.id)} aria-pressed={selected?.id === o.id}><i style={{ background: o.color }} />{o.label}</button>)}</div></div>
        {visits.kind === 'ready' && totalVisited === 0 && <p className={styles.firstRecord}><Link to="/records/new">첫 발자취 남기기 →</Link></p>}
        {missing.length > 0 && <p className={styles.scopeNote}>도식 준비 중인 역 {missing.length}개도 검색해서 기록할 수 있어요.</p>}
      </aside>
      <div className={styles.canvasWrap}>
        {!selectedHasGeometry && <p className={styles.mapHint}>{selected?.label} 노선도는 준비 중이에요.</p>}
        {view ? <>
          <LineMapCanvas ref={canvasRef} width={lineMap.viewBox.width} height={lineMap.viewBox.height} lines={view.lines} stations={view.stations}
            riverPoints={view.river} onSelectStation={goStation} onAmbiguous={setAmbiguous} />
          <div className={styles.mapHint}>확대하거나 역 이름으로 찾아보세요</div>
          <details className={styles.legend}><summary>표시 안내</summary><div><p><span className={styles.legendVisit}>✓</span> 방문한 역</p><p>○ 일반역 · ◉ 환승역</p><p>정확한 방문 횟수는 확대해서 확인해요.</p>{visits.kind !== 'ready' && <p role="status">방문 정보 {visits.kind === 'failed' ? '미확인' : '확인 중'}</p>}</div></details>
          <div className={styles.zoomControls}>
            <button type="button" className={styles.zoomButton} aria-label="확대" onClick={() => canvasRef.current?.zoomBy(1.6)}>+</button>
            <button type="button" className={styles.zoomButton} aria-label="축소" onClick={() => canvasRef.current?.zoomBy(1 / 1.6)}>−</button>
            <button type="button" className={styles.zoomButton} aria-label="전체 보기로 리셋" onClick={() => canvasRef.current?.reset()}>⤢</button>
          </div>
          {ambiguous.length > 0 && <section className={styles.stationCandidates} aria-label="겹친 역 선택">
            <div><strong>어느 역을 찾으세요?</strong><button aria-label="역 선택 닫기" onClick={() => setAmbiguous([])}>닫기</button></div>
            {ambiguous.map(s => <button key={s.code} onClick={() => goStation(s.id)}>{s.name} · 기록 보기</button>)}
          </section>}
        </> : <div className={styles.skeleton} role="status">{master.kind === 'failed' ? '역 정보를 다시 불러와 주세요.' : '노선도를 준비하고 있어요.'}</div>}
      </div>
    </div>
  </div>
}
