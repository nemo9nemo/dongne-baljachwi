import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useSession } from '../../auth/session-context'
import { Wordmark } from '../../components/Wordmark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ui from '../../styles/ui.module.css'

/** F-03 */
const MIN_PASSWORD_LENGTH = 8

/**
 * F-04: 재설정 메일 링크의 착지 화면.
 *
 * 링크의 토큰은 supabase 클라이언트가 `detectSessionInUrl`로 이미 세션으로 바꿔 놓는다.
 * 그래서 이 화면에서 할 일은 "세션이 생겼는지 확인하고 새 비밀번호를 저장"하는 것뿐이다.
 */
export function ResetPasswordScreen() {
  const session = useSession()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  if (session.status === 'loading') {
    return (
      <div className={ui.centerBox} role="status" aria-live="polite">
        <p>확인하는 중…</p>
      </div>
    )
  }

  if (session.status === 'signed-out') {
    return (
      <div className={ui.screen}>
        <header className={ui.screenHeader}>
          <Wordmark />
          <h1 className={ui.title}>링크가 만료되었어요</h1>
          <p className={ui.subtitle}>재설정 링크를 다시 받아주세요.</p>
        </header>
        <p className={ui.linkRow}>
          <Link to="/forgot-password">재설정 링크 다시 받기</Link>
        </p>
      </div>
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH || pending) return

    setPending(true)
    setFormError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setFormError('비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해주세요.')
      setPending(false)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className={ui.screen}>
      <header className={ui.screenHeader}>
        <Wordmark />
        <h1 className={ui.title}>새 비밀번호 설정</h1>
      </header>

      {formError !== null && (
        <p className={ui.errorBanner} role="alert">
          {formError}
        </p>
      )}

      <form className={ui.form} onSubmit={handleSubmit} noValidate>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="reset-password">
            새 비밀번호
          </label>
          <Input
            id="reset-password"
            type="password"
            value={password}
            autoComplete="new-password"
            disabled={pending}
            aria-describedby="reset-password-hint"
            onChange={(event) => setPassword(event.target.value)}
          />
          <p id="reset-password-hint" className={ui.hint}>
            {MIN_PASSWORD_LENGTH}자 이상
          </p>
        </div>
        <Button
          type="submit"
          variant="default"
          disabled={password.length < MIN_PASSWORD_LENGTH || pending}
        >
          {pending ? '저장하는 중…' : '비밀번호 바꾸기'}
        </Button>
      </form>
    </div>
  )
}
