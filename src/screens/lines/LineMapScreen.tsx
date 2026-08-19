import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { lineMap, stationGeometryByCode, lineCodeByStationCode } from '../../data/line-map'
import type { LineRow } from '../../lib/station-master'
import { useLineMapData } from './line-map-data'
import { LineMapCanvas } from './LineMapCanvas'
import type { LineMapCanvasHandle, MapLine, MapStation } from './LineMapCanvas'
import styles from './line-map.module.css'
import ui from '../../styles/ui.module.css'

/**
 * 노선도 화면 (`docs/specs/03-line-map.md`). 앱의 기본 화면.
 *
 * 이번 라운드 범위는 **2호선 파일럿**이다. 좌표 파일(`src/data/line-map/`)에는 본선 43역 +
 * 성수지선 4역 + 신정지선 3역만 있고, 나머지 노선은 좌표가 없어 그리지 않는다. 그래서
 * §5 마지막 행("좌표 미보유 역 존재 → 하단 안내")이 지금은 상시 표시된다 — 의도된 상태다.
 *
 * 미구현(다음 라운드): AC-08 뷰포트 상태 보존, AC-11 1,100역 성능 프로파일.
 */

/**
 * 셀렉트박스 한 항목.
 *
 * DB 에는 `2호선`이라는 이름의 `lines` 행이 셋(본선·성수지선·신정지선) 있다. 그대로 뿌리면
 * "2호선"이 세 번 나온다. 그래서 **이름이 같은 노선을 한 항목으로 묶고**, 선택 시 그 집합
 * 전체를 강조 대상으로 삼는다. §7 확장 포인트가 필터를 "선택된 노선 집합 → 강조 대상 역
 * 집합"으로 다루라고 한 것과 같은 구조다.
 */
type LineOption = {
  /** URL 쿼리에 실리는 값. 그룹 내 최소 `lines.code` (F-15) */
  id: string
  label: string
  codes: string[]
}

function buildLineOptions(lines: LineRow[]): LineOption[] {
  const byName = new Map<string, { sortOrder: number; codes: string[] }>()
  for (const line of lines) {
    const found = byName.get(line.name)
    if (found === undefined) byName.set(line.name, { sortOrder: line.sort_order, codes: [line.code] })
    else found.codes.push(line.code)
  }
  return [...byName.entries()]
    // F-11: 순서는 `lines.sort_order` 가 정한다. 프론트에 호선 목록을 하드코딩하지 않는다.
    .sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[0].localeCompare(b[0], 'ko'))
    .map(([label, group]) => {
      const codes = [...group.codes].sort()
      return { id: codes[0]!, label, codes }
    })
}

/** 라벨 줄바꿈. 5자를 넘으면 두 줄로 쪼갠다 — 역 간격(약 66단위)보다 넓어지면 이웃과 겹친다. */
function splitLabel(name: string): string[] {
  if (name.length <= 5) return [name]
  const head = Math.ceil(name.length / 2)
  return [name.slice(0, head), name.slice(head)]
}

export function LineMapScreen() {
  const navigate = useNavigate()
  const canvasRef = useRef<LineMapCanvasHandle>(null)
  // 07(지도 보기)과 마스터·방문 집계를 공유한다 — 토글 전환 시 네트워크 요청 0회가 목표다.
  const { master, visits, reloadMaster: loadMaster, reloadVisits: loadVisits } = useLineMapData()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showMissing, setShowMissing] = useState(false)
  const selectedId = searchParams.get('line') ?? ''

  const masterData = master.kind === 'ready' ? master.master : null
  const visitCountByStationId = useMemo(
    () => (visits.kind === 'ready' ? new Map(visits.rows.map((r) => [r.station_id, r.visit_count])) : null),
    [visits],
  )
  const options = useMemo(
    () => (masterData === null ? [] : buildLineOptions(masterData.lines)),
    [masterData],
  )
  const selected = options.find((o) => o.id === selectedId) ?? null

  /** 선택된 그룹 중 **도식 좌표가 있는** 노선. 비어 있으면 아직 안 그려지는 호선이다. */
  const selectedDrawableCodes = useMemo(() => {
    if (selected === null) return null
    const drawn = new Set(lineMap.lines.map((l) => l.lineCode))
    const codes = selected.codes.filter((c) => drawn.has(c))
    return codes.length === 0 ? null : new Set(codes)
  }, [selected])

  /**
   * 렌더 대상 계산. 마스터 944행 × 도식 50역 조인이라 매 렌더 다시 돌리면 안 된다.
   * 방문 집계가 도착하면 여기만 다시 돌고, 캔버스의 변환 상태(ref)는 건드리지 않는다.
   */
  const view = useMemo(() => {
    if (masterData === null) return null
    const stationByCode = new Map(masterData.stations.map((s) => [s.code, s]))
    const colorByLineCode = new Map(masterData.lines.map((l) => [l.code, `var(--${l.color_token})`]))
    const visitCounts = visitCountByStationId

    const lines: MapLine[] = lineMap.lines.map((line) => ({
      code: line.lineCode,
      points: line.polyline.map(([x, y]) => `${x},${y}`).join(' '),
      color: colorByLineCode.get(line.lineCode) ?? 'var(--line-default)',
      dimmed: selectedDrawableCodes !== null && !selectedDrawableCodes.has(line.lineCode),
    }))

    const stations: MapStation[] = []
    for (const geom of lineMap.stations) {
      const row = stationByCode.get(geom.stationCode)
      // 좌표는 있는데 마스터에 없는 역 = 정합성 깨짐. CI 가 잡아야 할 상황이라 여기서는 건너뛴다.
      if (row === undefined || !row.is_active) continue
      const lineCode = lineCodeByStationCode.get(geom.stationCode)
      stations.push({
        code: geom.stationCode,
        id: row.id,
        name: row.name_short,
        x: geom.x,
        y: geom.y,
        labelAnchor: geom.labelAnchor,
        isTransfer: row.is_transfer,
        // F-08: 기록은 물리 역 단위다. 환승역은 소속 호선 전부에서 같은 방문 상태로 보인다.
        visitCount: visitCounts?.get(row.id) ?? 0,
        color:
          lineCode === undefined
            ? 'var(--line-default)'
            : (colorByLineCode.get(lineCode) ?? 'var(--line-default)'),
        dimmed:
          selectedDrawableCodes !== null &&
          (lineCode === undefined || !selectedDrawableCodes.has(lineCode)),
        labelLines: splitLabel(row.name_short),
      })
    }
    return { lines, stations }
  }, [masterData, visitCountByStationId, selectedDrawableCodes])

  /** 좌표가 없어 노선도에 못 그리는 역 (§2.2 / §5). 2호선 파일럿 동안은 대부분이 여기 들어온다. */
  const missing = useMemo(() => {
    if (masterData === null) return []
    return masterData.stations
      .filter((s) => s.is_active && !stationGeometryByCode.has(s.code))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [masterData])

  // F-14: 필터를 걸면 해당 호선이 화면에 차도록 이동/확대한다. 화면이 그대로면 뭐가 바뀐 건지 모른다.
  // 의존성에 `view` 자체를 넣으면 방문 집계가 도착할 때마다 사용자가 잡아둔 화면이 튄다 —
  // 캔버스가 마운트됐는지 여부(boolean)만 본다.
  const canvasMounted = view !== null
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    if (selectedDrawableCodes === null) {
      canvas.reset()
      return
    }
    const pts = lineMap.lines
      .filter((l) => selectedDrawableCodes.has(l.lineCode))
      .flatMap((l) => l.polyline)
    if (pts.length === 0) return
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const pad = 60
    canvas.fitTo({
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      width: Math.max(...xs) - Math.min(...xs) + pad * 2,
      height: Math.max(...ys) - Math.min(...ys) + pad * 2,
    })
  }, [selectedDrawableCodes, canvasMounted])

  const goStation = useCallback(
    (stationId: string) => navigate(`/stations/${stationId}`),
    [navigate],
  )

  const totalVisited = visitCountByStationId?.size ?? 0

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>노선도</h1>
        <div className={styles.headerControls}>
          <label className="srOnly" htmlFor="line-filter">
            호선 필터
          </label>
          <select
            id="line-filter"
            className={styles.select}
            value={selectedId}
            disabled={options.length === 0}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams)
              // F-15: 새로고침·뒤로가기 후에도 선택이 유지되도록 URL 에 담는다.
              if (e.target.value === '') next.delete('line')
              else next.set('line', e.target.value)
              setSearchParams(next, { replace: true })
            }}
          >
            <option value="">전체</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {/* F-23: 노선도 ↔ 지도 보기 토글 */}
          <Link className={styles.toggleLink} to="/map">
            지도 보기
          </Link>
        </div>
      </header>

      {master.kind === 'failed' && (
        <div className={styles.banner} role="alert">
          <span>역 정보를 불러오지 못했습니다.</span>
          <button type="button" className={styles.bannerButton} onClick={loadMaster}>
            다시 시도
          </button>
        </div>
      )}

      {/* AC-10: 방문 집계만 실패하면 노선도는 살려둔다. 화면 전체를 죽이지 않는다 (§2.2). */}
      {visits.kind === 'failed' && (
        <div className={styles.banner} role="alert">
          <span>방문 정보를 불러오지 못했어요.</span>
          <button type="button" className={styles.bannerButton} onClick={loadVisits}>
            다시 시도
          </button>
        </div>
      )}

      {masterData?.stale === true && (
        <div className={styles.banner}>
          <span>오프라인 — 저장된 역 정보로 표시 중이에요.</span>
        </div>
      )}

      {/* 조사(은/는)를 붙이려면 노선명의 받침을 따져야 한다. 노선명은 DB가 주는 값이라
          규칙을 프론트에 두지 않고, 조사가 필요 없는 문장으로 쓴다. */}
      {selected !== null && selectedDrawableCodes === null && (
        <p className={styles.notice}>{selected.label} — 노선도에 아직 준비되지 않았어요.</p>
      )}

      <div className={styles.canvasWrap}>
        {view === null ? (
          <div className={styles.skeleton} aria-hidden="true" />
        ) : (
          <>
            <LineMapCanvas
              ref={canvasRef}
              width={lineMap.viewBox.width}
              height={lineMap.viewBox.height}
              lines={view.lines}
              stations={view.stations}
              onSelectStation={goStation}
            />
            <div className={styles.zoomControls}>
              <button
                type="button"
                className={styles.zoomButton}
                aria-label="확대"
                onClick={() => canvasRef.current?.zoomBy(1.5)}
              >
                +
              </button>
              <button
                type="button"
                className={styles.zoomButton}
                aria-label="축소"
                onClick={() => canvasRef.current?.zoomBy(1 / 1.5)}
              >
                −
              </button>
              {/* F-22: 길을 잃었을 때의 탈출구 */}
              <button
                type="button"
                className={styles.zoomButton}
                aria-label="전체 보기로 리셋"
                onClick={() => canvasRef.current?.reset()}
              >
                ⤢
              </button>
            </div>
          </>
        )}
      </div>

      <footer className={styles.footer}>
        {/* AC-09: 기록 0건이면 전 역이 빈 원이고, 첫 기록을 유도하는 안내가 보인다. */}
        {visits.kind === 'ready' && totalVisited === 0 && (
          <p className={styles.emptyHint}>
            아직 발자취가 없어요. <Link to="/records/new">첫 발자취를 남겨보세요</Link>
          </p>
        )}

        {missing.length > 0 && (
          <details
            className={styles.missing}
            open={showMissing}
            onToggle={(e) => setShowMissing(e.currentTarget.open)}
          >
            <summary>노선도에 아직 표시되지 않은 역 {missing.length}개</summary>
            {/* 열었을 때만 마운트한다. 지금은 894개라 항상 그리면 첫 렌더가 그만큼 느려진다.
                좌표를 채워 갈수록 줄어드는 목록이라 가상화는 아직 넣지 않았다. */}
            {showMissing && (
              <ul className={styles.missingList}>
                {missing.map((s) => (
                  <li key={s.code}>
                    <Link to={`/stations/${s.id}`}>{s.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}

        {master.kind === 'failed' && (
          <p className={ui.hint}>노선도를 그리려면 역 정보가 필요해요.</p>
        )}
      </footer>
    </div>
  )
}
