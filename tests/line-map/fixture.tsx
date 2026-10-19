import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, Link, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router-dom'
import { LineMapView } from '../../src/screens/lines/LineMapScreen'
import { AppShell } from '../../src/components/AppShell'
import { SessionContext, type SessionValue } from '../../src/auth/session-context'
import type { StationMaster } from '../../src/lib/station-master'
import source from '../../scripts/line-map/metro-seoul-source.json'
import { lineCodesByStationCode } from '../../src/data/line-map'
import frame from '../../src/styles/app-frame.module.css'
import '@fontsource/noto-sans-kr/400.css'
import '@fontsource/noto-sans-kr/500.css'
import '@fontsource/noto-sans-kr/700.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/700.css'
import '../../src/index.css'

// 공개 역 정보와 가상 방문만 사용한다. 실제 인증·DB 조회 없이 제품 화면을 검증한다.
const master: StationMaster = { version: 1, stale: false,
  stations: source.stations.map(s => ({ id: s.stationCode, code: s.stationCode, name: s.name, name_short: s.name,
    lat: 0, lng: 0, is_active: true, is_transfer: (lineCodesByStationCode.get(s.stationCode)?.length ?? 0) > 1, in_mvp_scope: true, region_code: '11' })),
  lines: source.lines.map((l, i) => ({ id: l.lineCode, code: l.lineCode, name: l.name, color_token: l.colorToken, sort_order: i, in_mvp_scope: true, is_active: true })),
}
// 실제 마스터에는 있지만 도식 좌표가 없는 역의 탐색도 검증한다.
master.stations.push({ id: 'fixture-undrawn', code: 'fixture-undrawn', name: '연천역', name_short: '연천역',
  lat: 38.1, lng: 127.1, is_active: true, is_transfer: false, in_mvp_scope: true, region_code: '41' })
const session: SessionValue = { status: 'signed-in', userId: 'fixture-user', email: 'fixture@example.invalid', displayName: '테스트',
  couple: { id: 'fixture-space', startedOn: '2026-01-01', status: 'active' }, members: [], partner: null, loadFailed: false, reload: async () => {}, signOut: async () => {} }
export function Frame() {
  const map = useLocation().pathname === '/lines'
  return <div className={`${frame.backdrop} ${map ? frame.mapBackdrop : ''}`}><div className={`${frame.frame} ${map ? frame.mapFrame : ''}`}><Outlet /></div></div>
}
export function Detail() {
  const navigate = useNavigate()
  return <div><h1>역 기록 화면</h1><button onClick={() => navigate(-1)}>노선도로 돌아가기</button></div>
}
const scenario = new URLSearchParams(location.search).get('scenario')
const rows = ['홍대입구', '강남', '잠실'].map((name, i) => ({ station_id: master.stations.find(s => s.name === name)!.id, visit_count: [3, 1, 123][i], last_visited_on: '2026-10-01' }))
const router = createMemoryRouter([{ element: <Frame />, children: [{ element: <AppShell />, children: [
  { path: '/lines', element: <LineMapView master={{ kind: 'ready', master }} visits={scenario === 'failed' ? { kind: 'failed' } : scenario === 'loading' ? { kind: 'loading' } : { kind: 'ready', rows: scenario === 'empty' ? [] : rows }} reloadMaster={() => {}} reloadVisits={() => {}} /> },
  { path: '/stations/:id', element: <Detail /> },
  { path: '*', element: <Link to="/lines">노선도로 돌아가기</Link> },
] }] }], { initialEntries: ['/lines'] })
const root: Root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!)
if (import.meta.hot) import.meta.hot.data.root = root
root.render(<StrictMode><SessionContext.Provider value={session}><RouterProvider router={router} /></SessionContext.Provider></StrictMode>)
