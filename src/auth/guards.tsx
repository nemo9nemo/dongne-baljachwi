import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSession } from './session-context'
import { Button } from '@/components/ui/button'
import ui from '../styles/ui.module.css'

/**
 * 라우팅 가드 모음.
 *
 * 00 §5의 상태표를 그대로 라우팅으로 옮긴 것이다:
 * 미인증 → 로그인 / 인증됨·커플 미연결 → 온보딩 강제 / 연결됨 → 온보딩 차단.
 */

function FullScreenSpinner() {
  return (
    <div className={ui.centerBox} role="status" aria-live="polite">
      <p>불러오는 중…</p>
    </div>
  )
}

/**
 * 프로필/커플 조회가 실패한 상태.
 *
 * RLS 특성상 "권한 없음"과 "데이터 없음"은 구분되지 않지만(00 §5), 네트워크 실패는 구분된다.
 * 이걸 커플 여부에 대한 판정으로 써버리면 양쪽 가드가 정반대로 틀린다 —
 * 연결된 사용자를 온보딩으로 보내 커플을 또 만들게 하거나, 미연결 사용자를 앱 안에 가둔다.
 * 그래서 두 가드 모두 판정 대신 재시도를 보여준다 (01 §2.4 오프라인).
 */
function LoadFailedBox() {
  const session = useSession()

  return (
    <div className={ui.centerBox}>
      <p>정보를 불러오지 못했어요.</p>
      <p className={ui.subtitle}>네트워크 연결을 확인해주세요.</p>
      <Button type="button" variant="default" onClick={() => void session.reload()}>
        다시 시도
      </Button>
    </div>
  )
}

/** 인증 필요. 세션이 없으면 로그인으로 보내고 원래 목적지를 기억해 둔다. */
export function RequireAuth() {
  const session = useSession()
  const location = useLocation()

  if (session.status === 'loading') return <FullScreenSpinner />
  if (session.status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

/** 커플 연결 필요. 미연결이면 온보딩으로 강제 이동한다 (00 §5). */
export function RequireCouple() {
  const session = useSession()

  if (session.status === 'loading') return <FullScreenSpinner />

  // 실패를 커플 미연결로 오인해 온보딩으로 보내면 사용자가 커플을 또 만들려 한다.
  if (session.loadFailed) return <LoadFailedBox />

  if (session.couple === null) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/**
 * 온보딩 전용. 이미 커플에 속해 있으면 화면 자체가 뜨지 않게 한다
 * (01 §2.4 "내가 이미 커플에 속함" — 라우팅 단계에서 차단).
 */
export function RequireNoCouple() {
  const session = useSession()

  if (session.status === 'loading') return <FullScreenSpinner />

  // 조회 실패를 "커플 없음"으로 읽으면 이미 연결된 사용자에게 온보딩이 열린다.
  // 여기서 커플을 새로 만들면 ALREADY_IN_COUPLE로 막히긴 하지만, 그전에 이름·사귄 날을
  // 다 입력하고 나서야 막힌다. RequireCouple과 같은 처리를 해서 애초에 들여보내지 않는다.
  if (session.loadFailed) return <LoadFailedBox />

  if (session.couple !== null) return <Navigate to="/lines" replace />
  return <Outlet />
}

/** 로그인/가입 화면. 이미 로그인돼 있으면 앱 안으로 돌려보낸다. */
export function RedirectIfSignedIn() {
  const session = useSession()

  if (session.status === 'loading') return <FullScreenSpinner />
  if (session.status === 'signed-in') return <Navigate to="/" replace />
  return <Outlet />
}
