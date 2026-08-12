import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../auth/session-context'
import styles from './AppShell.module.css'

/** PRD §4: 노선도/타임라인/프로필만 하단 탭. 나머지는 드릴다운으로 진입한다. */
const TABS = [
  { to: '/lines', label: '노선도' },
  { to: '/timeline', label: '타임라인' },
  { to: '/profile', label: '프로필' },
] as const

/** 커플에 연결된 사용자가 보는 기본 레이아웃. */
export function AppShell() {
  const session = useSession()
  const { pathname } = useLocation()

  // F-18: "상대 초대 대기 중" 배너는 노선도·프로필 상단에만 둔다.
  // 멤버 1명이 곧 대기 상태다 — 별도 status를 두지 않는다 (00 §4.2).
  const showInviteBanner =
    session.members.length === 1 && (pathname === '/lines' || pathname === '/profile')

  return (
    <div className={styles.shell}>
      {showInviteBanner && (
        <div className={styles.banner}>
          <span>상대 초대 대기 중</span>
          <Link to="/invite">초대 코드 보기</Link>
        </div>
      )}

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav className={styles.tabbar} aria-label="주요 화면">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
