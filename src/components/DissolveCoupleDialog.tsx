import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth/session-context'
import { supabase } from '../lib/supabase'
import {
  DISSOLVE_CONFIRM_PHRASE,
  dissolveCouple,
  failureMessage,
} from '../lib/couple-rpc'
import { scopeToCouple } from '../lib/screen-cache'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from './ui/dialog'
import ui from '../styles/ui.module.css'
import styles from './DissolveCoupleDialog.module.css'

type Props = {
  /** 사용자가 취소했을 때. 실행 중에는 호출되지 않는다 */
  onClose: () => void
}

/**
 * 커플 연결 해제 (F-19~F-23, 01 §2.3).
 *
 * 되돌릴 수 없는 동작이라(F-22) 2단계 확인 + 확인 문구 타이핑으로 마찰을 준다(F-23).
 * 실행 중에는 모달을 닫을 수 없다(01 §5).
 *
 * 포털·포커스 트랩·Esc·포커스 복귀는 Radix `Dialog`(`@/components/ui/dialog`)가 담당한다.
 * Radix의 FocusScope는 포커스가 트랩 밖(예: body)으로 빠졌을 때도 `focusin` 리스너로
 * 스스로 되돌리므로, 예전처럼 "포커스가 밖으로 떨어지면 되돌린다"는 범용 effect는 더 필요
 * 없다 — 여기 남긴 effect는 오직 "확인 단계 진입 시 입력창으로 보낸다"는 이 화면만의
 * UX 규칙(F-23)이다.
 */
export function DissolveCoupleDialog({ onClose }: Props) {
  const session = useSession()
  const navigate = useNavigate()
  const confirmInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'warn' | 'confirm'>('warn')
  const [recordCount, setRecordCount] = useState<number | null>(null)
  const [confirmInput, setConfirmInput] = useState('')
  const [pending, setPending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const coupleId = session.couple?.id ?? null

  // 확인 단계에서는 곧바로 타이핑할 수 있게 문구 입력 필드로 포커스를 보낸다(F-23).
  useEffect(() => {
    if (step === 'confirm' && !pending) confirmInputRef.current?.focus()
  }, [step, pending])

  // 01 §2.3: 경고에 "지금까지 쌓인 기록 수"를 함께 보여준다. 행 본문은 필요 없으므로
  // head 요청으로 개수만 받는다.
  useEffect(() => {
    if (coupleId === null) return
    let alive = true
    void supabase
      .from('records')
      .select('id', { count: 'exact', head: true })
      .eq('couple_id', coupleId)
      .then(({ count, error }) => {
        if (alive && !error) setRecordCount(count ?? 0)
      })
    return () => {
      alive = false
    }
  }, [coupleId])

  async function handleDissolve() {
    if (pending || confirmInput !== DISSOLVE_CONFIRM_PHRASE) return
    setPending(true)
    setErrorText(null)

    const result = await dissolveCouple(confirmInput)
    if (!result.ok) {
      // 트랜잭션 1건이므로 부분 해제 상태는 없다. 모달을 유지하고 에러만 보여준다 (01 §2.4).
      setErrorText(failureMessage(result.failure))
      setPending(false)
      return
    }

    // F-21: 이 시점부터 `current_couple_id()`가 NULL이라 기록이 전부 0건이 된다.
    // AC-12: 서버가 0건을 돌려줘도 화면 밖 모듈 캐시(방문 집계·목록)가 남아 있으면 해제
    // 직후 재결합했을 때 옛 커플의 기록이 그대로 보인다. 세션 갱신보다 **먼저** 비운다 —
    // reload()가 끝나는 순간 라우팅이 바뀌면서 다른 화면이 캐시를 읽을 수 있다.
    scopeToCouple(null)
    // 여기서는 갱신이 먼저다. 커플이 사라지는 순간 RequireCouple이 이 화면을 온보딩으로
    // 돌려보내므로 아래 navigate는 대개 같은 목적지에 대한 확인 사살이다
    // (해제 도중 다른 곳으로 이동한 경우를 대비해 남겨 둔다).
    await session.reload()
    navigate('/onboarding', { replace: true })
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <DialogPortal>
        <DialogOverlay className={styles.overlay}>
          <DialogContent
            className={styles.dialog}
            onEscapeKeyDown={(event) => pending && event.preventDefault()}
            onInteractOutside={(event) => pending && event.preventDefault()}
          >
            <DialogTitle className={styles.title}>커플 연결 해제</DialogTitle>

            {step === 'warn' && (
              <>
                <div className={styles.warning}>
                  <p>해제하면 두 사람 모두 지금까지의 기록을 볼 수 없게 됩니다.</p>
                  <p>30일 후 영구 삭제됩니다.</p>
                </div>
                <p>
                  지금까지의 기록{' '}
                  <span className={styles.stat}>
                    {recordCount === null ? '세는 중…' : `${recordCount}건`}
                  </span>
                </p>
                {/* F-22: 되돌릴 수 없다는 것을 명시한다. */}
                <p className={ui.subtitle}>한 번 해제하면 되돌릴 수 없어요.</p>
                <div className={ui.buttonRow}>
                  <Button type="button" onClick={onClose}>
                    취소
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => setStep('confirm')}>
                    계속
                  </Button>
                </div>
              </>
            )}

            {step === 'confirm' && (
              <>
                <p>
                  계속하려면 <span className={styles.phrase}>{DISSOLVE_CONFIRM_PHRASE}</span>{' '}
                  를 그대로 입력해주세요.
                </p>
                <div className={ui.field}>
                  <label className={ui.label} htmlFor="dissolve-confirm">
                    확인 문구
                  </label>
                  <Input
                    id="dissolve-confirm"
                    ref={confirmInputRef}
                    type="text"
                    value={confirmInput}
                    autoComplete="off"
                    disabled={pending}
                    onChange={(event) => setConfirmInput(event.target.value)}
                  />
                </div>

                {errorText !== null && (
                  <p className={ui.error} role="alert" aria-live="assertive">
                    {errorText}
                  </p>
                )}

                <div className={ui.buttonRow}>
                  <Button type="button" disabled={pending} onClick={onClose}>
                    취소
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending || confirmInput !== DISSOLVE_CONFIRM_PHRASE}
                    onClick={() => void handleDissolve()}
                  >
                    {pending ? '해제하는 중…' : '연결 해제'}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </DialogOverlay>
      </DialogPortal>
    </Dialog>
  )
}
