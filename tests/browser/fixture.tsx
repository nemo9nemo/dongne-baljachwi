import React from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { SessionContext, type SessionValue } from '../../src/auth/session-context'
import { RecordDetailScreen } from '../../src/screens/records/RecordDetailScreen'
import { RecordEditorScreen } from '../../src/screens/records/RecordEditorScreen'
import '../../src/styles/tokens.css'
import '../../src/index.css'

const session: SessionValue = {
  status: 'signed-in',
  userId: 'user-a',
  email: 'test@example.invalid',
  displayName: '테스트',
  couple: { id: 'couple-a', startedOn: '2026-01-01', status: 'active' },
  members: [{ userId: 'user-a', role: 'owner', displayName: '테스트' }],
  partner: null,
  loadFailed: false,
  reload: async () => {},
  signOut: async () => {},
}

const entry = new URLSearchParams(location.search).get('entry') ?? '/records/record-a/edit'
const router = createMemoryRouter(
  [
    {
      path: '/records/:recordId/edit',
      element: (
        <>
          <Link to="/records/record-b/edit">기록 B로 이동</Link>
          <RecordEditorScreen />
        </>
      ),
    },
    { path: '/records/:recordId', element: <RecordDetailScreen /> },
  ],
  { initialEntries: [entry] },
)

createRoot(document.getElementById('root')!).render(
  <SessionContext.Provider value={session}>
    <RouterProvider router={router} />
  </SessionContext.Provider>,
)
