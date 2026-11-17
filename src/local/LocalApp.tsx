import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  LineMapCanvas,
  type LineMapCanvasHandle,
  type MapStation
} from '../screens/lines/LineMapCanvas'
import { lineMap } from '../data/line-map'
import { catalog, localLines, searchStations, stationByCode } from './catalog'
import { currentMap, isReadOnly, type LocalRecord, type LocalState } from './model'
import { getState, loadState, mutate, subscribe } from './storage'
import { Button } from '../components/ui/button'
import { Modal, Photo, RecordForm } from './components'
import { Settings } from './Settings'
import { errorMessage, localTime } from './ui-utils'
import { useSharing } from './use-sharing'
import './local.css'

type Tab = 'map' | 'timeline' | 'settings'
const tabFromHash = (): Tab =>
  location.hash === '#timeline' ? 'timeline' : location.hash === '#settings' ? 'settings' : 'map'
function DeviceApp({ state }: { state: LocalState }) {
  const map = currentMap(state),
    readonly = isReadOnly(map),
    canvas = useRef<LineMapCanvasHandle>(null)
  const [tab, setTab] = useState<Tab>(tabFromHash),
    [query, setQuery] = useState(''),
    [line, setLine] = useState(''),
    [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState(''),
    [tag, setTag] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState('')
  const [limit, setLimit] = useState(50)
  const [editor, setEditor] = useState<{ record: LocalRecord | null; station: string } | null>(
      null
    ),
    [detail, setDetail] = useState<string | null>(null),
    [viewer, setViewer] = useState<string | null>(null)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const { statuses, connections } = useSharing(state),
    status = statuses[map.id]
  const photo = map.records.flatMap((record) => record.photos).find((photo) => photo.id === viewer),
    detailed = map.records.find((record) => record.id === detail)
  useEffect(() => {
    setSelected(null)
    setDetail(null)
    setEditor(null)
    setViewer(null)
    setFilter('')
    setTag('')
  }, [map.id])
  useEffect(() => setLimit(50), [map.id, filter, tag, start, end])
  useEffect(() => {
    const change = () => setTab(tabFromHash())
    addEventListener('hashchange', change)
    return () => removeEventListener('hashchange', change)
  }, [])
  async function perform(action: () => Promise<void>, success = '') {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (success) setNotice(success)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  function navigate(next: Tab) {
    location.hash = next
    setTab(next)
  }
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const record of map.records)
      result.set(record.stationCode, (result.get(record.stationCode) ?? 0) + 1)
    return result
  }, [map.records])
  const stations: MapStation[] = useMemo(
    () =>
      catalog.map((station) => {
        const colors = [...new Set(station.lineCodes.map(
          (code) => localLines.find((line) => line.code === code)?.color ?? 'var(--color-text)'
        ))]
        return {
          ...station,
          id: station.code,
          labelLines: [station.name],
          color: colors[0] ?? 'var(--color-text)',
          colors,
          isTransfer: colors.length > 1,
          visitCount: counts.get(station.code) ?? 0,
          dimmed: Boolean(line && !station.lineCodes.includes(line))
        }
      }),
    [line, counts]
  )
  const lines = useMemo(
    () =>
      lineMap.lines.map((item) => ({
        code: item.id,
        points: item.polyline.map((point) => point.join(',')).join(' '),
        color: localLines.find((line) => line.code === item.lineCode)?.color ?? 'var(--color-text)',
        dimmed: Boolean(line && line !== item.lineCode)
      })),
    [line]
  )
  const sorted = useMemo(
    () =>
      [...map.records].sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id)
      ),
    [map.records]
  )
  const visible = sorted.filter((record) => {
    const text = [record.place, record.note, stationByCode.get(record.stationCode)?.name ?? '']
      .join(' ')
      .normalize('NFC')
      .toLocaleLowerCase('ko')
    return (
      (!filter || text.includes(filter.normalize('NFC').toLocaleLowerCase('ko'))) &&
      (!tag ||
        record.tags.some(
          (value) =>
            value.normalize('NFC').toLocaleLowerCase('ko') ===
            tag.normalize('NFC').toLocaleLowerCase('ko')
        )) &&
      (!start || record.date >= start) &&
      (!end || record.date <= end)
    )
  })
  const selectedRecords = sorted.filter((record) => record.stationCode === selected),
    tagNames = [...new Set(map.records.flatMap((record) => record.tags))].sort()
  function pickStation(code: string) {
    setSelected(code)
    setQuery('')
    canvas.current?.focusOn(code)
  }
  function recordCard(record: LocalRecord) {
    return (
      <article className="local-record" key={record.id}>
        <button type="button" className="local-record-open" onClick={() => setDetail(record.id)}>
          {record.photos[0] && (
            <Photo
              thumbnail
              id={record.photos[0].id}
              alt={`${record.place || stationByCode.get(record.stationCode)?.name} 대표 사진`}
            />
          )}
          <div>
            <span className="local-eyebrow">
              {record.date.replaceAll('-', '.')} · {stationByCode.get(record.stationCode)?.name}역
            </span>
            <h3>{record.place || stationByCode.get(record.stationCode)?.name}</h3>
            <p>{record.note || '이곳에 발자취를 남겼어요.'}</p>
            {record.tags.length > 0 && (
              <span className="local-tags">
                {record.tags
                  .slice(0, 3)
                  .map((tag) => '#' + tag)
                  .join(' ')}
              </span>
            )}
          </div>
          <span aria-hidden="true">↗</span>
        </button>
      </article>
    )
  }
  return (
    <div className="local-app">
      <aside className="local-sidebar">
        <a href="#map" className="local-wordmark" onClick={() => navigate('map')}>
          동네 발자취<span>나의 일상을 잇는 노선도</span>
        </a>
        <nav aria-label="주 메뉴">
          {(
            [
              ['map', '노선도'],
              ['timeline', '타임라인'],
              ['settings', '내 맵·설정']
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => navigate(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="local-sidebar-note">
          로그인 없이, 이 기기에 보관해요.
          <br />
          백업으로 소중한 기록을 지켜주세요.
        </div>
      </aside>
      <main className="local-main">
        <header className="local-top">
          <div>
            <span className="local-eyebrow">
              {map.share ? (readonly ? '받은 공유 맵' : '공유 중인 맵') : '개인 맵'}
            </span>
            <h1>
              {tab === 'map'
                ? '오늘의 발자취는 어디인가요'
                : tab === 'timeline'
                  ? '쌓여가는 나의 순간들'
                  : '나의 기록을 안전하게'}
            </h1>
          </div>
          <label className="local-map-select">
            <span>현재 맵</span>
            <select
              aria-label="현재 맵"
              value={map.id}
              onChange={(event) =>
                void perform(() =>
                  mutate((state) => {
                    state.selectedMapId = event.target.value
                  }).then(() => {})
                )
              }
            >
              {state.maps.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                  {item.share ? ' · 공유' : ''}
                </option>
              ))}
            </select>
          </label>
        </header>
        {error && (
          <p role="alert" className="local-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="local-notice">
            {notice}
          </p>
        )}
        {map.share && (
          <div className="local-share-banner">
            <p>
              {readonly
                ? '공유받은 기록은 읽기 전용이에요. 연결을 끊으면 이 기기의 개인 맵이 돼요.'
                : '이 맵의 기록과 사진을 연결된 상대 기기에 공유해요.'}
              <small>
                {status?.message ?? '공유 연결을 준비하고 있어요.'} · 마지막 동기화{' '}
                {localTime(map.share.lastSync)}
              </small>
            </p>
            <button type="button" onClick={() => navigate('settings')}>
              연결 관리 ↗
            </button>
          </div>
        )}
        {map.source && !map.share && (
          <p className="local-notice">
            {map.source.kind === 'backup'
              ? '백업에서 복원한 개인 맵이에요.'
              : '독립된 개인 맵이에요. 이 맵의 변경은 이전 상대에게 전달되지 않아요.'}
          </p>
        )}
        <div className="local-stats">
          <div>
            <strong>{map.records.length}</strong>
            <span>남긴 기록</span>
          </div>
          <div>
            <strong>{counts.size}</strong>
            <span>다녀온 역</span>
          </div>
          <div>
            <strong>
              {Math.round((counts.size / catalog.length) * 100)}
              <small>%</small>
            </strong>
            <span>채워가는 노선도</span>
          </div>
          <div>
            <strong>{map.records.reduce((sum, record) => sum + record.photos.length, 0)}</strong>
            <span>기억할 사진</span>
          </div>
        </div>
        {tab === 'map' && (
          <>
            <div className="local-map-toolbar">
              <div className="local-search">
                <label>
                  <span className="local-sr">역 이름 검색</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="가보고 싶은 역, 다녀온 역 검색"
                  />
                </label>
                {query && (
                  <ul className="local-results">
                    {searchStations(query).map((station) => (
                      <li key={station.code}>
                        <button type="button" onClick={() => pickStation(station.code)}>
                          {station.name}
                          <span>지도에서 보기 ↗</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label>
                <span className="local-sr">노선 선택</span>
                <select
                  aria-label="노선 선택"
                  value={line}
                  onChange={(event) => setLine(event.target.value)}
                >
                  <option value="">모든 노선</option>
                  {localLines.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="local-map-card">
              <div className="local-map-stage">
                <div className="local-map-caption">
                  SEOUL METRO<span>수도권의 기억을 한 장의 맵으로</span>
                </div>
                <LineMapCanvas
                  ref={canvas}
                  width={lineMap.viewBox.width}
                  height={lineMap.viewBox.height}
                  stations={stations}
                  lines={lines}
                  onSelectStation={pickStation}
                  onAmbiguous={(items) => pickStation(items[0]!.code)}
                />
                <div className="local-map-controls">
                  <button
                    type="button"
                    aria-label="지도 확대"
                    onClick={() => canvas.current?.zoomBy(1.5)}
                  >
                    ＋
                  </button>
                  <button
                    type="button"
                    aria-label="지도 축소"
                    onClick={() => canvas.current?.zoomBy(1 / 1.5)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label="지도 전체 보기"
                    onClick={() => canvas.current?.reset()}
                  >
                    ↔
                  </button>
                </div>
              </div>
              <section className="local-station-panel">
                <span className="local-eyebrow">
                  {selected ? 'STATION MEMORY' : 'YOUR NEXT MEMORY'}
                </span>
                <h2>
                  {selected ? stationByCode.get(selected)?.name : '어느 역에 다녀왔나요'}
                  {selected && <small>역</small>}
                </h2>
                <p className="local-muted">
                  {selected
                    ? `이 역에 남긴 기록 ${selectedRecords.length}개`
                    : '지도를 확대하거나 역 이름을 검색해보세요.'}
                </p>
                {selectedRecords.slice(0, 3).map(recordCard)}
                {selected && !selectedRecords.length && (
                  <p className="local-empty-small">
                    아직 비어 있는 역이에요.
                    <br />첫 번째 기억을 남겨보세요.
                  </p>
                )}
                {!readonly && (
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => setEditor({ record: null, station: selected ?? '' })}
                  >
                    {selected ? '이 역에 기록 남기기 ＋' : '첫 기록 남기기 ＋'}
                  </Button>
                )}
              </section>
            </div>
          </>
        )}
        {tab === 'timeline' && (
          <section className="local-timeline">
            <div className="local-section-heading">
              <h2>{map.title}</h2>
              {!readonly && (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => setEditor({ record: null, station: '' })}
                >
                  기록 남기기 ＋
                </Button>
              )}
            </div>
            <div className="local-filters">
              <label>
                기록 검색
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="역·장소·이야기"
                />
              </label>
              <label>
                태그
                <select value={tag} onChange={(event) => setTag(event.target.value)}>
                  <option value="">모든 태그</option>
                  {tagNames.map((tag) => (
                    <option key={tag}>{tag}</option>
                  ))}
                </select>
              </label>
              <label>
                시작일
                <input
                  type="date"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label>
                종료일
                <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
            </div>
            {start && end && start > end && (
              <p role="alert" className="local-error">
                시작일이 종료일보다 늦어요.
              </p>
            )}
            <p className="local-muted">기록 {visible.length}개</p>
            {visible.slice(0, limit).map(recordCard)}
            {visible.length > limit && (
              <Button onClick={() => setLimit((previous) => previous + 50)}>기록 더 보기</Button>
            )}
            {!visible.length && (
              <div className="local-empty">
                <h3>{map.records.length ? '조건에 맞는 기록이 없어요' : '아직 기록이 없어요'}</h3>
                <p>역과 날짜만 선택해도 첫 발자취를 남길 수 있어요.</p>
              </div>
            )}
          </section>
        )}
        {tab === 'settings' && (
          <Settings
            state={state}
            map={map}
            status={status}
            connection={connections.current.get(map.id)}
            busy={busy}
            error={error}
            perform={perform}
          />
        )}
        <footer className="local-footer">
          <span>동네 발자취 · {map.title}</span>
          <span>작은 기억이 모여 나의 지도가 돼요.</span>
        </footer>
      </main>
      {editor && (
        <RecordForm
          key={editor.record?.id ?? 'new'}
          map={map}
          record={editor.record}
          station={editor.station}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setEditor(null)
            setDetail(id)
            setNotice('기록과 사진을 기기에 저장했어요.')
          }}
        />
      )}
      {detailed && !editor && (
        <Modal
          title={detailed.place || stationByCode.get(detailed.stationCode)?.name || '기록'}
          onClose={() => setDetail(null)}
        >
          <div className="local-detail">
            <p className="local-muted">
              {detailed.date} · {stationByCode.get(detailed.stationCode)?.name}역 · 작성자{' '}
              {detailed.author==='나'&&detailed.originId?'원본 작성자':detailed.author}
            </p>
            <div className="local-detail-photos">
              {detailed.photos.map((photo, index) => (
                <Photo
                  key={photo.id}
                  id={photo.id}
                  alt={`기록 사진 ${index + 1}`}
                  onClick={() => setViewer(photo.id)}
                />
              ))}
            </div>
            <p className="local-note">{detailed.note || '이곳에 발자취를 남겼어요.'}</p>
            <p>
              {detailed.mood} {detailed.weather}
            </p>
            <p className="local-tags">{detailed.tags.map((tag) => '#' + tag).join(' ')}</p>
            {!readonly && (
              <div className="local-actions">
                <Button
                  type="button"
                  onClick={() => setEditor({ record: detailed, station: detailed.stationCode })}
                >
                  수정
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    if (confirm('이 기록과 연결된 사진을 삭제할까요?'))
                      void perform(
                        () =>
                          mutate((state) => {
                            const target = state.maps.find((item) => item.id === map.id)
                            if (!target || isReadOnly(target))
                              throw new Error('기록을 삭제할 수 없어요.')
                            const current = target.records.find((item) => item.id === detailed.id)
                            if (current?.revision !== detailed.revision)
                              throw new Error('기록이 변경됐어요. 다시 열어주세요.')
                            target.records = target.records.filter(
                              (item) => item.id !== detailed.id
                            )
                            target.revision++
                          }).then(() => setDetail(null)),
                        '기록을 삭제했어요.'
                      )
                  }}
                >
                  삭제
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}
      {viewer && photo && (
        <Modal title="사진 보기" onClose={() => setViewer(null)}>
          <div className="local-viewer">
            <Photo id={photo.id} alt="선택한 사진" />
          </div>
        </Modal>
      )}
    </div>
  )
}
class LocalErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="local-loading">
        <h1>화면을 다시 열어주세요</h1>
        <p>기기 기록을 삭제하지 말고 앱을 새로고침해주세요.</p>
        <Button onClick={() => location.reload()}>다시 열기</Button>
      </div>
    ) : (
      this.props.children
    )
  }
}
export default function LocalApp() {
  const [state, setState] = useState<LocalState | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const update = () => {
      if (alive) setState(getState())
    }
    const unsubscribe = subscribe(update)
    void loadState()
      .then(update)
      .catch((error) => {
        if (alive) setError(errorMessage(error))
      })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  if (error)
    return (
      <div className="local-loading">
        <h1>기기 저장소를 준비하지 못했어요</h1>
        <p role="alert">{error}</p>
        <Button onClick={() => location.reload()}>다시 시도</Button>
      </div>
    )
  if (!state)
    return (
      <div className="local-loading" role="status">
        나의 발자취를 불러오고 있어요…
      </div>
    )
  return (
    <LocalErrorBoundary>
      <DeviceApp state={state} />
    </LocalErrorBoundary>
  )
}
