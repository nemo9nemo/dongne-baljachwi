import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isNetworkFailure, supabase } from '../../lib/supabase'
import { readStateString } from '../../lib/router-state'
import { Wordmark } from '../../components/Wordmark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ui from '../../styles/ui.module.css'

/** F-01: 이메일+비밀번호 로그인. */
export function LoginScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const submittable = email.trim().length > 0 && password.length > 0 && !pending

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!submittable) return

    setPending(true)
    setFormError(null)

    const trimmedEmail = email.trim()
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    })

    if (error) {
      // 01 §2.4: 이메일 확인 전이면 로그인이 아니라 "확인 대기" 안내로 보낸다.
      if (error.code === 'email_not_confirmed') {
        navigate('/verify-email', { state: { email: trimmedEmail } })
        return
      }
      // 01 §2.4(오프라인): 요청이 서버에 닿지도 못한 실패를 자격증명 오류로 뭉개면 안 된다.
      // auth-js는 fetch 실패를 AuthRetryableFetchError로 감싸면서 원본 TypeError 메시지를
      // 그대로 넘기므로 RPC 쪽과 같은 판별식(isNetworkFailure)이 통한다. status 0을 함께 보는
      // 이유는 그 메시지 문구가 브라우저·로케일에 따라 달라질 수 있어서다 — HTTP 응답이 있었다면
      // status는 0일 수 없다.
      if (isNetworkFailure(error) || error.status === 0) {
        setFormError('로그인하지 못했어요. 네트워크 연결을 확인하고 다시 시도해주세요.')
      } else if (error.status !== undefined && error.status >= 500) {
        // 5xx는 응답은 왔지만 인증 판정이 이뤄지지 않은 것이다. 재시도 안내로 보낸다.
        setFormError('서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해주세요.')
      } else {
        // 01 §5: 어느 쪽이 틀렸는지 구분해 알리지 않는다 (계정 존재 여부 노출 방지).
        setFormError('이메일 또는 비밀번호가 올바르지 않습니다.')
      }
      setPending(false)
      return
    }

    // 가드가 보내준 원래 목적지로 복귀한다.
    navigate(readStateString(location.state, 'from') ?? '/', { replace: true })
  }

  return (
    <div className={ui.screen}>
      <header className={ui.screenHeader}>
        <Wordmark />
        <h1 className={ui.title}>로그인</h1>
        <p className={ui.subtitle}>동네 발자취에 다시 오신 걸 환영해요.</p>
      </header>

      {formError !== null && (
        <p className={ui.errorBanner} role="alert">
          {formError}
        </p>
      )}

      <form className={ui.form} onSubmit={handleSubmit} noValidate>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="login-email">
            이메일
          </label>
          <Input
            id="login-email"
            type="email"
            value={email}
            autoComplete="email"
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className={ui.field}>
          <label className={ui.label} htmlFor="login-password">
            비밀번호
          </label>
          <Input
            id="login-password"
            type="password"
            value={password}
            autoComplete="current-password"
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <Button type="submit" variant="default" disabled={!submittable}>
          {pending ? '로그인하는 중…' : '로그인'}
        </Button>
      </form>

      <p className={ui.linkRow}>
        <Link to="/signup">가입하기</Link>
        <Link to="/forgot-password">비밀번호를 잊었어요</Link>
      </p>
    </div>
  )
}
