import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Wordmark } from '../../components/Wordmark'
import ui from '../../styles/ui.module.css'

/** F-04: 비밀번호 재설정 메일 요청. */
export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (email.trim().length === 0 || pending) return

    setPending(true)
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    // 실패든 성공이든 같은 문구를 보여준다. 여기서 결과를 구분하면 "그 이메일이 가입돼 있는지"가
    // 새어 나간다 (로그인 화면의 문구 정책과 같은 이유, 01 §5).
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

      <form className={ui.form} onSubmit={handleSubmit} noValidate>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="forgot-email">
            이메일
          </label>
          <input
            id="forgot-email"
            className={ui.input}
            type="email"
            value={email}
            autoComplete="email"
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className={`${ui.button} ${ui.buttonPrimary}`}
          disabled={email.trim().length === 0 || pending}
        >
          {pending ? '보내는 중…' : '재설정 링크 보내기'}
        </button>
      </form>

      <p className={ui.linkRow}>
        <Link to="/login">로그인으로 돌아가기</Link>
      </p>
    </div>
  )
}
