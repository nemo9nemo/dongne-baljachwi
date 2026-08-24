import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/session-context'
import { readStateString } from '../../lib/router-state'
import { Button } from '@/components/ui/button'
import ui from '../../styles/ui.module.css'

/**
 * 합류 성공 확인 화면 (01 §2.2-4).
 *
 * 상대 이름은 `redeem_invite`가 돌려준 값을 라우터 state로 받는다. 새로고침 등으로
 * state가 사라졌다면 세션의 파트너 정보로 대체하고, 그것도 없으면 그냥 앱으로 보낸다
 * (직접 URL을 친 경우 보여줄 내용이 없다).
 */
export function CoupleLinkedScreen() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  const partnerName =
    readStateString(location.state, 'partnerName') ?? session.partner?.displayName ?? null

  if (partnerName === null) return <Navigate to="/lines" replace />

  return (
    <div className={ui.screen}>
      <header className={ui.screenHeader}>
        <h1 className={ui.title}>{partnerName}님과 연결되었습니다</h1>
        <p className={ui.subtitle}>
          {/* F-17 / AC-11: 상대가 먼저 써 둔 기록도 전부 함께 보인다. */}
          지금까지의 기록이 모두 함께 보여요.
        </p>
      </header>
      <Button type="button" variant="default" onClick={() => navigate('/lines', { replace: true })}>
        시작하기
      </Button>
    </div>
  )
}
