import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { lineMap, lineCodesByStationCode } from '../src/data/line-map'
import source from '../scripts/line-map/metro-seoul-source.json'
import { LineMapCanvas, type LineMapCanvasHandle, type MapStation } from '../src/screens/lines/LineMapCanvas'
import '@fontsource/noto-sans-kr/400.css'
import '@fontsource/noto-sans-kr/700.css'
import '../src/styles/tokens.css'
import './mockup.css'

const samples = [
  { station: '홍대입구', title: '연남동 골목 산책', date: '2026.10.18', text: '골목을 걷다가 발견한 작은 카페. 다음엔 창가에 앉아 책을 읽고 싶다.', tag: '산책', number: '01' },
  { station: '성수', title: '오래 머물고 싶은 오후', date: '2026.10.12', text: '커피 한 잔과 느긋한 대화. 익숙한 동네에도 새로운 장면이 있다.', tag: '카페', number: '02' },
  { station: '서울숲', title: '나무 사이로 비치는 빛', date: '2026.10.09', text: '조금 돌아가는 길을 골랐다. 가을 바람이 기분 좋았던 날.', tag: '산책', number: '03' },
]
const names = new Map(source.stations.map(s => [s.stationCode, s.name]))
const colors = new Map(source.lines.map(l => [l.lineCode, `var(--${l.colorToken})`]))
export function Mockup() {
  const canvas = useRef<LineMapCanvasHandle>(null)
  const [selected, setSelected] = useState('홍대입구')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [view, setView] = useState('노선도')
  const [editor, setEditor] = useState(false)
  const [saved, setSaved] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (editor && element) element.showModal()
    return () => { if (element?.open) element.close() }
  }, [editor])
  const stations: MapStation[] = useMemo(() => lineMap.stations.map(s => {
    const memberships = lineCodesByStationCode.get(s.stationCode) ?? []
    const palette = [...new Set(memberships.map(code => colors.get(code) ?? 'var(--line-default)'))]
    const name = names.get(s.stationCode) ?? ''
    return { ...s, code: s.stationCode, id: s.stationCode, name, labelLines: [name], colors: palette,
      color: palette[0], isTransfer: palette.length > 1, visitCount: samples.some(r => r.station === name) ? 3 : 0,
      dimmed: filter !== '' && !memberships.includes(filter) }
  }), [filter])
  const lines = useMemo(() => lineMap.lines.map(l => ({ code: l.id, points: l.polyline.map(p => p.join(',')).join(' '),
    color: colors.get(l.lineCode) ?? 'var(--line-default)', dimmed: filter !== '' && filter !== l.lineCode })), [filter])
  useEffect(() => { if (view === '노선도') setTimeout(() => canvas.current?.fitTo({ x: 850, y: 550, width: 1400, height: 1100 }), 100) }, [view])
  const matches = query ? stations.filter(s => s.name.includes(query)).slice(0, 5) : []
  const chosen = samples.find(r => r.station === selected)
  function select(name: string) {
    setSelected(name); setQuery('')
    const station = stations.find(s => s.name === name)
    if (station) canvas.current?.focusOn(station.code)
  }
  return <div className="prototype">
    <header className="top"><a className="brand" href="./mockup.html"><span className="brandmark">··</span> 동네 발자취</a><span className="preview-note">디자인 목업 · 예시 기록</span><button className="primary" onClick={() => setEditor(true)}>＋ 기록 남기기</button></header>
    <div className="layout"><aside className="sidebar">
      <div className="account"><span className="avatar">나</span><div><strong>나의 발자취</strong><small>내가 다녀온 곳을 차곡차곡</small></div></div>
      <nav aria-label="주요 화면">{['노선도', '타임라인'].map((label, i) => <button key={label} className={view === label ? 'nav active' : 'nav'} onClick={() => setView(label)}><span>{i === 0 ? '⌘' : '≡'}</span>{label}<span>↗</span></button>)}</nav>
      <section className="summary"><span className="eyebrow">나의 기록</span><div className="statrow"><div><strong>24</strong><small>남긴 기록</small></div><div><strong>12</strong><small>방문한 역</small></div></div><p>나의 속도로, 하나씩.</p></section>
      <section className="recent"><div className="section-label">최근 발자취 <span>03</span></div>{samples.map(r => <button key={r.number} onClick={() => { setView('노선도'); select(r.station) }}><span className="recent-number">{r.number}</span><span><strong>{r.station}</strong><small>{r.date}</small></span><span>↗</span></button>)}</section>
      <footer>수도권의 작은 순간들을<br/>한 장의 노선도에.</footer>
    </aside><main>
      <div className="page-heading"><div><span className="eyebrow">MY FOOTPRINTS</span><h1>{view === '노선도' ? '어디에 발자취를 남겼나요?' : '시간을 따라 쌓인 기록'}</h1><p>{view === '노선도' ? '역을 선택하고, 그날의 기억을 꺼내보세요.' : '소중했던 하루를 다시 만나보세요.'}</p></div><span className="scope-label">○ 내 기록</span></div>
      {view === '노선도' ? <><div className="toolbar"><div className="search"><span>⌕</span><input aria-label="역 이름 검색" placeholder="어느 역을 찾으세요?" value={query} onChange={e => setQuery(e.target.value)} />{matches.length > 0 && <ul>{matches.map(s => <li key={s.code}><button onClick={() => select(s.name)}>{s.name} <span>지도에서 보기 ↗</span></button></li>)}</ul>}</div><label className="line-select"><span className="sr-only">노선 선택</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="">전체 노선</option>{source.lines.map(l => <option key={l.lineCode} value={l.lineCode}>{l.name}</option>)}</select></label><span className="legend"><i/> 방문한 역</span></div>
      <div className="map-card"><div className="map-stage"><LineMapCanvas ref={canvas} width={lineMap.viewBox.width} height={lineMap.viewBox.height} lines={lines} stations={stations} onSelectStation={id => select(names.get(id) ?? '')} onAmbiguous={candidates => select(candidates[0].name)} /><span className="map-caption">수도권 노선도<span>기억이 머무는 곳</span></span><div className="map-controls"><button aria-label="확대" onClick={() => canvas.current?.zoomBy(1.5)}>＋</button><button aria-label="축소" onClick={() => canvas.current?.zoomBy(1/1.5)}>−</button><button aria-label="전체 보기" onClick={() => canvas.current?.reset()}>⤢</button></div></div>
      <section className="station-panel"><div className="station-heading"><span className="eyebrow">선택한 역</span><h2>{selected}<span>역</span></h2><p>{chosen ? '이곳에 남긴 작은 기억' : '아직 기록이 없는 역이에요.'}</p></div>{chosen ? <article className="memory"><div className="memory-art" aria-hidden="true"><div className="window"/><span>DAY {chosen.number}</span></div><div className="memory-meta"><span>{chosen.date}</span><span>#{chosen.tag}</span></div><h3>{chosen.title}</h3><p>{chosen.text}</p></article> : <div className="empty-memory">새로운 발자취를 남겨보세요.</div>}<button className="primary full" onClick={() => setEditor(true)}>이 역에 기록 남기기 ＋</button><small className="panel-caption">기록은 내 공간에 안전하게 보관돼요.</small></section></div></>
      : <div className="timeline-preview">{samples.map(r => <article key={r.number}><span>{r.date}</span><h2>{r.station} · {r.title}</h2><p>{r.text}</p><small>#{r.tag}</small></article>)}</div>}
      <footer className="main-footer"><span>일상의 작은 이동이, 나만의 지도가 됩니다.</span><span>동네 발자취 © 2026</span></footer>
    </main></div>
    {editor && <dialog ref={dialog} className="modal-backdrop" aria-label="기록 작성 목업" onCancel={() => setEditor(false)} onClick={() => setEditor(false)}><section className="editor" onClick={e => e.stopPropagation()}><button className="close" aria-label="닫기" onClick={() => setEditor(false)}>×</button><span className="eyebrow">NEW MEMORY</span><h2>오늘의 발자취</h2><form onSubmit={e => { e.preventDefault(); setSaved(true) }}><label>역<input defaultValue={selected} required /></label><label>방문일<input type="date" defaultValue="2026-10-19" required /></label><label>장소 이름 <span>선택</span><input placeholder="어떤 곳에 다녀왔나요?" /></label><label>일기<textarea rows={4} placeholder="기억하고 싶은 순간을 적어보세요." /></label><details><summary>감정 · 날씨 · 태그</summary><p>선택 정보는 필요할 때만 더해요.</p></details><button className="primary full">{saved ? '목업에서 저장 모습을 확인했어요' : '기록 저장'}</button><small>디자인 확인용 화면입니다. 실제 기록은 저장되지 않아요.</small></form></section></dialog>}
  </div>
}
createRoot(document.getElementById('root')!).render(<Mockup />)
