import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../auth/session-context'
import styles from './AppShell.module.css'

/** PRD §4: 노선도/타임라인/프로필만 하단 탭. 나머지는 드릴다운으로 진입한다. */
const TABS = [
  { to: '/lines', label: '노선도' },
  { to: '/timeline', label: '타임라인' },
  { to: '/profile', label: '프로필' },
] as const

const TOAST_MS = 3000

/** 커플에 연결된 사용자가 보는 기본 레이아웃. */
export function AppShell() {
  const session = useSession()
  const location = useLocation()
  const { pathname } = location

  // F-18: "상대 초대 대기 중" 배너는 노선도·프로필 상단에만 둔다.
  // 멤버 1명이 곧 대기 상태다 — 별도 status를 두지 않는다 (00 §4.2).
  const showInviteBanner =
    session.members.length === 1 && (pathname === '/lines' || pathname === '/profile')

  /**
   * 화면 전환 뒤 한 번 보여주는 토스트 (05 저장 성공, 06 삭제 성공 등).
   *
   * 화면들이 `navigate(to, { state: { toast: '…' } })`로 문구를 실어 보내면 여기서 받는다.
   * 라우트를 옮길 때마다(경로가 아니라 `location.key`가 바뀔 때마다) 다시 확인해야
   * 같은 문구를 재방문 시에도 보여줄 수 있다.
   *
   * 의존성을 `location.state`가 아니라 `location.key`로 두는 이유: state는 매 렌더
   * 새 참조로 읽힐 수 있어(`location` 객체 자체가 그렇다) 넣으면 무한 재실행 위험이 있다.
   * key는 내비게이션 1회당 값이 고정이라 안전하다.
   */
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    const state = location.state as { toast?: string } | null
    setToast(typeof state?.toast === 'string' ? state.toast : null)
  }, [location.key])
  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  return (
    <div className={styles.shell}>
      {showInviteBanner && (
        <div className={styles.banner}>
          <span>상대 초대 대기 중</span>
          <Link to="/invite">초대 코드 보기</Link>
        </div>
      )}

      {toast !== null && (
        <p className={styles.toast} role="status" aria-live="polite">
          {toast}
        </p>
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
