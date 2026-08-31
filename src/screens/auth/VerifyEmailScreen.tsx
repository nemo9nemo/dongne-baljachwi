import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { STORAGE_PREFIX } from '../../lib/app-storage'
import { readStateString } from '../../lib/router-state'
import { Wordmark } from '../../components/Wordmark'
import { Button } from '@/components/ui/button'
import ui from '../../styles/ui.module.css'

/** 01 §5: 재발송 버튼 쿨다운(초) */
const RESEND_COOLDOWN_SEC = 60

function readCooldownRemaining(email: string | null): number {
  if (email === null) return 0
  const raw = window.localStorage.getItem(`${STORAGE_PREFIX}resend.${email}`)
  if (raw === null) return 0
  const sentAt = Number.parseInt(raw, 10)
  if (!Number.isFinite(sentAt)) return 0
  const elapsed = Math.floor((Date.now() - sentAt) / 1000)
  return Math.max(0, RESEND_COOLDOWN_SEC - elapsed)
}

/**
 * 이메일 확인 대기 화면 (F-02, 01 §2.4).
 * 확인 전에는 Supabase가 세션을 만들어 주지 않으므로, 이 화면은 로그아웃 상태에서 보인다.
 */
export function VerifyEmailScreen() {
  const location = useLocation()
  const email = readStateString(location.state, 'email')

  // 쿨다운을 메모리에만 두면 새로고침으로 즉시 우회된다. 발송 시각을 저장소에 남긴다
  // (F-25의 접두사 규칙을 따라 로그아웃 시 함께 지워진다).
  const [remaining, setRemaining] = useState(() => readCooldownRemaining(email))
  const [pending, setPending] = useState(false)
  // 성공/실패를 같은 스타일로 띄우면 "다시 보냈어요"와 "못 보냈어요"가 시각적으로 구분되지
  // 않는다. 문구와 함께 어느 쪽인지도 들고 있는다.
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)

  // 의존성을 `remaining`이 아니라 boolean으로 둔다. 숫자를 그대로 넣으면 1초마다
  // 타이머를 해제/재생성하게 된다.
  const counting = remaining > 0
  useEffect(() => {
    if (!counting) return
    const timer = window.setInterval(() => setRemaining(readCooldownRemaining(email)), 1000)
    return () => window.clearInterval(timer)
  }, [counting, email])

  async function handleResend() {
    if (email === null || remaining > 0 || pending) return
    setPending(true)
    setToast(null)

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (error) {
      setToast({ text: '메일을 다시 보내지 못했어요. 잠시 후 다시 시도해주세요.', ok: false })
    } else {
      window.localStorage.setItem(`${STORAGE_PREFIX}resend.${email}`, String(Date.now()))
      setRemaining(RESEND_COOLDOWN_SEC)
      setToast({ text: '확인 메일을 다시 보냈어요.', ok: true })
    }
    setPending(false)
  }

  return (
    <div className={ui.screen}>
      <header className={ui.screenHeader}>
        <Wordmark />
        <h1 className={ui.title}>메일함을 확인해주세요</h1>
        <p className={ui.subtitle}>
          {email ?? '가입한 이메일 주소'}로 확인 링크를 보냈어요. 링크를 누르면 로그인할 수
          있어요.
        </p>
      </header>

      <p className={ui.notice}>메일이 안 보이면 스팸함도 확인해주세요.</p>

      {toast !== null &&
        (toast.ok ? (
          <p className={ui.subtitle} role="status" aria-live="polite">
            {toast.text}
          </p>
        ) : (
          <p className={ui.errorBanner} role="alert">
            {toast.text}
          </p>
        ))}

      {/* 이 화면은 가입 직후 `state.email`을 받아 열린다. 새로고침·북마크로 직접 들어오면
          주소를 알 방법이 없어 재발송 버튼이 영구 비활성이다 — 왜 못 누르는지 말해준다. */}
      {email === null && (
        <p className={ui.hint} id="resend-disabled-reason">
          이메일 정보가 없어 재발송할 수 없어요. 로그인 화면에서 다시 시도해주세요.
        </p>
      )}

      <Button
        type="button"
        disabled={email === null || remaining > 0 || pending}
        aria-describedby={email === null ? 'resend-disabled-reason' : undefined}
        onClick={() => void handleResend()}
      >
        {remaining > 0 ? `확인 메일 다시 보내기 (${remaining}초)` : '확인 메일 다시 보내기'}
      </Button>

      <p className={ui.linkRow}>
        <Link to="/login">로그인으로 돌아가기</Link>
      </p>
    </div>
  )
}
