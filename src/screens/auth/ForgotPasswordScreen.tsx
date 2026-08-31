import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isNetworkFailure, supabase } from '../../lib/supabase'
import { Wordmark } from '../../components/Wordmark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ui from '../../styles/ui.module.css'

/** F-04: 비밀번호 재설정 메일 요청. */
export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (email.trim().length === 0 || pending) return

    setPending(true)
    setFormError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })

    // 01 §2.4(오프라인): 요청이 서버에 닿지도 못한 실패까지 "보냈어요"로 덮으면, 사용자는
    // 오지 않을 메일을 기다린다. 계정 열거 방지와는 무관한 실패라 구분해서 알린다.
    // (LoginScreen과 같은 판별식 — status 0을 함께 보는 이유도 그쪽 주석 참고)
    if (error !== null && (isNetworkFailure(error) || error.status === 0)) {
      setFormError('메일을 보내지 못했어요. 네트워크 연결을 확인하고 다시 시도해주세요.')
      setPending(false)
      return
    }

    // 그 외에는 실패든 성공이든 같은 문구를 보여준다. 여기서 결과를 구분하면 "그 이메일이
    // 가입돼 있는지"가 새어 나간다 (로그인 화면의 문구 정책과 같은 이유, 01 §5).
    setSent(true)
    setPending(false)
  }

  if (sent) {
    return (
      <div className={ui.screen}>
        <header className={ui.screenHeader}>
          <Wordmark />
          <h1 className={ui.title}>메일을 확인해주세요</h1>
          <p className={ui.subtitle}>
            가입된 이메일이라면 비밀번호 재설정 링크를 보냈어요. 메일이 안 보이면 스팸함도
            확인해주세요.
          </p>
        </header>
        <p className={ui.linkRow}>
          <Link to="/login">로그인으로 돌아가기</Link>
        </p>
      </div>
    )
  }

  return (
    <div className={ui.screen}>
      <header className={ui.screenHeader}>
        <Wordmark />
        <h1 className={ui.title}>비밀번호 재설정</h1>
        <p className={ui.subtitle}>가입한 이메일로 재설정 링크를 보내드려요.</p>
      </header>

      {formError !== null && (
        <p className={ui.errorBanner} role="alert">
          {formError}
        </p>
      )}

      <form className={ui.form} onSubmit={handleSubmit} noValidate>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="forgot-email">
            이메일
          </label>
          <Input
            id="forgot-email"
            type="email"
            value={email}
            autoComplete="email"
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <Button type="submit" variant="default" disabled={email.trim().length === 0 || pending}>
          {pending ? '보내는 중…' : '재설정 링크 보내기'}
        </Button>
      </form>

      <p className={ui.linkRow}>
        <Link to="/login">로그인으로 돌아가기</Link>
      </p>
    </div>
  )
}
