import React from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom'
import { SessionContext, type SessionValue } from '../../src/auth/session-context'
import { RecordEditorScreen } from '../../src/screens/records/RecordEditorScreen'
import { TimelineScreen } from '../../src/screens/timeline/TimelineScreen'
import { RecordDetailScreen } from '../../src/screens/records/RecordDetailScreen'
import { StationDetailScreen } from '../../src/screens/stations/StationDetailScreen'
import { SessionProvider } from '../../src/auth/SessionProvider'
import { AppShell } from '../../src/components/AppShell'
import { RequireAuth, RequireCouple } from '../../src/auth/guards'
import '../../src/styles/tokens.css'
import '../../src/index.css'

// 실제 화면을 격리해 테스트한다. 서버 요청은 브라우저 테스트가 모두 가로챈다.
const session: SessionValue = {
  status: 'signed-in', userId: new URLSearchParams(location.search).get('user') ?? 'user-a', email: 'test@example.invalid', displayName: '테스트',
  couple: { id: 'couple-a', startedOn: '2026-01-01', status: 'active' },
  members: [{ userId: 'user-a', role: 'owner', displayName: '테스트' }],
  partner: null, loadFailed: false, reload: async () => {}, signOut: async () => {},
}
const entry = new URLSearchParams(location.search).get('entry') ?? '/records/new?stationId=station-a'
const router = createMemoryRouter([
  { path: '/records/new', element: <><Link to="/timeline">테스트 목록 이동</Link><RecordEditorScreen /></> },
  { path: '/records/:recordId/edit', element: <><Link to="/records/edit-b/edit">다른 기록 편집</Link><RecordEditorScreen /></> },
  { path: '/timeline', element: <TimelineScreen /> },
  { path: '/records/:recordId', element: new URLSearchParams(location.search).has('real') ? <><Link to="/records/detail-b">다른 기록 상세</Link><RecordDetailScreen /></> : <p>저장 완료 상세 화면</p> },
  { path: '/stations/:stationId', element: new URLSearchParams(location.search).has('real') ? <StationDetailScreen /> : <p>역 상세 화면</p> },
], { initialEntries: [entry] })
const live = new URLSearchParams(location.search).has('live')
const liveRouter = live ? createMemoryRouter([{ element: <RequireAuth />, children: [{ element: <RequireCouple />, children: [{ element: <AppShell />, children: [
  { path: '/timeline', element: <TimelineScreen /> }, { path: '/records/new', element: <RecordEditorScreen /> },
] }] }] }], { initialEntries: [entry] }) : null
createRoot(document.getElementById('root')!).render(
  liveRouter ? <SessionProvider><RouterProvider router={liveRouter} /></SessionProvider> : <SessionContext.Provider value={session}><RouterProvider router={router} /></SessionContext.Provider>,
)
