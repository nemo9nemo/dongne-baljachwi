import { createContext, useContext } from 'react'
import type { CoupleRole, CoupleStatus } from '../lib/database.types'

export type CoupleMember = {
  userId: string
  role: CoupleRole
  displayName: string
}

export type CoupleSummary = {
  id: string
  /** `YYYY-MM-DD`. 디데이는 클라이언트가 계산한다 (00 D-13) */
  startedOn: string
  status: CoupleStatus
}

export type SessionValue = {
  /** 'loading' 동안에는 라우팅 판단을 미룬다. 안 그러면 새로고침마다 로그인 화면이 번쩍인다 */
  status: 'loading' | 'signed-out' | 'signed-in'
  userId: string | null
  email: string | null
  /** 내 `profiles.display_name`. 가입 직후에는 트리거가 넣은 이메일 로컬파트다 (F-05) */
  displayName: string | null
  /** 커플 미연결이면 null. `current_couple_id()`가 NULL인 상태와 같다 (00 §5) */
  couple: CoupleSummary | null
  /** 0명(미연결) / 1명(상대 대기) / 2명. 상태 조합 대신 인원수로 파생한다 (00 §4.2) */
  members: CoupleMember[]
  /** 나를 제외한 멤버. 상대 미합류면 null */
  partner: CoupleMember | null
  /** 프로필/커플 조회가 네트워크 등으로 실패했는지. true면 "커플 없음"과 구분해야 한다 */
  loadFailed: boolean
  /** 커플 생성·합류·해제 직후 서버 상태를 다시 읽는다. 라우팅 가드가 곧바로 반응한다 */
  reload: () => Promise<void>
  /** F-25: 세션 종료 + 앱이 쓴 브라우저 저장소 전부 삭제 */
  signOut: () => Promise<void>
}

export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (value === null) {
    throw new Error('useSession은 <SessionProvider> 안에서만 쓸 수 있다')
  }
  return value
}
