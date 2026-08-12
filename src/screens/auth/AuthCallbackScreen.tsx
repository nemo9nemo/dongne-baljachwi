import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/session-context'
import { Wordmark } from '../../components/Wordmark'
import ui from '../../styles/ui.module.css'

/** 확인 링크가 실패했을 때 Supabase가 프래그먼트에 실어 보내는 설명을 꺼낸다. */
function readHashError(): string | null {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const params = new URLSearchParams(hash)
  const description = params.get('error_description')
  return description === null ? params.get('error') : description
}

/**
 * 이메일 확인 링크(F-02)의 착지 화면.
 *
 * 토큰 → 세션 변환은 supabase 클라이언트가 모듈 초기화 시점에 `detectSessionInUrl`로
 * 이미 처리한다. 그래서 여기서는 세션이 붙기를 기다렸다가 앱 안으로 보내기만 한다.
 */
export function AuthCallbackScreen() {
  const session = useSession()
  const navigate = useNavigate()
  // 첫 렌더에 한 번만 읽는다. 세션이 붙으면서 프래그먼트가 지워질 수 있기 때문이다.
  const [hashError] = useState(readHashError)

  useEffect(() => {
    if (hashError !== null) return
    if (session.status === 'signed-in') navigate('/', { replace: true })
    if (session.status === 'signed-out') navigate('/login', { replace: true })
  }, [hashError, session.status, navigate])

  if (hashError !== null) {
    return (
      <div className={ui.screen}>
        <header className={ui.screenHeader}>
          <Wordmark />
          <h1 className={ui.title}>확인 링크를 처리하지 못했어요</h1>
          <p className={ui.subtitle}>링크가 만료됐거나 이미 사용됐을 수 있어요.</p>
        </header>
        <p className={ui.linkRow}>
          <Link to="/login">로그인으로 이동</Link>
        </p>
      </div>
    )
  }

  return (
    <div className={ui.centerBox} role="status" aria-live="polite">
      <p>확인하는 중…</p>
    </div>
  )
}
