import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../auth/session-context'
import { DissolveCoupleDialog } from '../../components/DissolveCoupleDialog'
import ui from '../../styles/ui.module.css'

/**
 * 프로필 화면 — **이번 라운드는 커플 설정 영역만** 구현한다.
 *
 * 통계(디데이·총 데이트 수·커버리지)와 "다음에 가볼만한 역"은 `09-couple-profile.md`
 * 라운드에서 채운다. 여기 있는 것은 `01-auth-couple-link.md`가 요구하는 진입점뿐이다:
 * 로그아웃(F-25), 초대 코드 다시 보기(F-18), 연결 해제(F-19~F-23).
 */
export function ProfileScreen() {
  const session = useSession()
  const [dissolveOpen, setDissolveOpen] = useState(false)

  return (
    <div className={ui.screen}>
      <h1 className={ui.title}>프로필</h1>

      <div className={ui.card}>
        <p className={ui.label}>나</p>
        <p>{session.displayName ?? '이름 없음'}</p>
        <p className={ui.label}>상대</p>
        {session.partner === null ? (
          // 09 §5 / F-18: 상대 미합류면 이름 자리에 대기 상태와 코드 진입점을 둔다.
          <p>
            상대 초대 대기 중 · <Link to="/invite">초대 코드 보기</Link>
          </p>
        ) : (
          <p>{session.partner.displayName}</p>
        )}
      </div>

      <div className={ui.card}>
        <p className={ui.sectionTitle}>통계</p>
        <p className={ui.subtitle}>추후 구현 예정입니다.</p>
        <p className={ui.hint}>docs/specs/09-couple-profile.md</p>
      </div>

      <button
        type="button"
        className={ui.button}
        onClick={() => void session.signOut()}
      >
        로그아웃
      </button>

      {/* 09 F-26: 파괴적 항목은 목록 최하단에 시각적으로 분리해 배치한다 (오탭 방지). */}
      <hr />
      <button
        type="button"
        className={`${ui.button} ${ui.buttonDanger}`}
        onClick={() => setDissolveOpen(true)}
      >
        커플 연결 해제
      </button>

      {dissolveOpen && <DissolveCoupleDialog onClose={() => setDissolveOpen(false)} />}
    </div>
  )
}
