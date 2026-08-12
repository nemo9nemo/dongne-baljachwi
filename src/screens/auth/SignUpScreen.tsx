import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Wordmark } from '../../components/Wordmark'
import ui from '../../styles/ui.module.css'

/** F-03: 비밀번호 최소 길이. 문자 종류는 강제하지 않는다. */
const MIN_PASSWORD_LENGTH = 8

/** F-01 / F-02: 이메일+비밀번호 가입. 확인 메일 발송 후 확인 대기 화면으로 넘긴다. */
export function SignUpScreen() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [alreadyRegistered, setAlreadyRegistered] = useState(false)

  const trimmedEmail = email.trim()
  const atIndex = trimmedEmail.indexOf('@')
  // `@`가 정확히 하나이고 앞뒤가 비어 있지 않은지까지만 본다. 최종 판정은 Supabase가 한다
  // (RFC 수준 정규식은 유효한 주소를 막는 쪽 실수가 더 잦아서 득보다 실이 크다).
  const emailValid =
    atIndex > 0 &&
    atIndex === trimmedEmail.lastIndexOf('@') &&
    atIndex < trimmedEmail.length - 1
  const emailInvalid = trimmedEmail.length > 0 && !emailValid
  const passwordInvalid = password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  // 형식 에러 문구가 떠 있는데 제출은 되는 모순을 막으려면 submittable이 같은 조건을 봐야 한다.
  const submittable = emailValid && password.length >= MIN_PASSWORD_LENGTH && !pending

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!submittable) return

    setPending(true)
    setFormError(null)
    setAlreadyRegistered(false)

    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (error) {
      if (error.code === 'user_already_exists' || error.code === 'email_exists') {
        setAlreadyRegistered(true)
      } else if (error.code === 'weak_password') {
        setFormError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.`)
      } else if (error.code === 'over_email_send_rate_limit') {
        setFormError('메일 발송이 너무 잦아요. 잠시 후 다시 시도해주세요.')
      } else {
        setFormError('가입에 실패했어요. 네트워크 연결을 확인하고 다시 시도해주세요.')
      }
      setPending(false)
      return
    }

    // Supabase는 계정 열거를 막으려고, 이미 가입된 이메일이어도 에러 대신 성공처럼 응답한다.
    // 이때 user.identities가 빈 배열로 온다 — 이게 "이미 존재함"을 구분할 유일한 신호다.
    if (data.user !== null && data.user.identities?.length === 0) {
      setAlreadyRegistered(true)
      setPending(false)
      return
    }

    navigate('/verify-email', { replace: true, state: { email: trimmedEmail } })
  }

  return (
    <div className={ui.screen}>
      <header className={ui.screenHeader}>
        <Wordmark />
        <h1 className={ui.title}>가입하기</h1>
        <p className={ui.subtitle}>둘만의 발자취를 남길 계정을 만들어요.</p>
      </header>

      {alreadyRegistered && (
        <div className={ui.errorBanner} role="alert">
          <p>이미 가입된 이메일입니다.</p>
          <p>
            <Link to="/login">로그인</Link> 하거나{' '}
            <Link to="/forgot-password">비밀번호를 재설정</Link>할 수 있어요.
          </p>
        </div>
      )}
      {formError !== null && (
        <p className={ui.errorBanner} role="alert">
          {formError}
        </p>
      )}

      <form className={ui.form} onSubmit={handleSubmit} noValidate>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="signup-email">
            이메일
          </label>
          <input
            id="signup-email"
            className={ui.input}
            type="email"
            value={email}
            autoComplete="email"
            disabled={pending}
            aria-invalid={emailInvalid}
            onChange={(event) => setEmail(event.target.value)}
          />
          {emailInvalid && <p className={ui.error}>이메일 형식을 확인해주세요.</p>}
        </div>

        <div className={ui.field}>
          <label className={ui.label} htmlFor="signup-password">
            비밀번호
          </label>
          <input
            id="signup-password"
            className={ui.input}
            type="password"
            value={password}
            autoComplete="new-password"
            disabled={pending}
            aria-invalid={passwordInvalid}
            aria-describedby="signup-password-hint"
            onChange={(event) => setPassword(event.target.value)}
          />
          <p id="signup-password-hint" className={passwordInvalid ? ui.error : ui.hint}>
            {MIN_PASSWORD_LENGTH}자 이상
          </p>
        </div>

        <button
          type="submit"
          className={`${ui.button} ${ui.buttonPrimary}`}
          disabled={!submittable}
        >
          {pending ? '가입하는 중…' : '가입하기'}
        </button>
      </form>

      <p className={ui.linkRow}>
        <Link to="/login">이미 계정이 있어요</Link>
      </p>
    </div>
  )
}
