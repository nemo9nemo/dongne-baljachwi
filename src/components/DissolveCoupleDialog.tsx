import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth/session-context'
import { supabase } from '../lib/supabase'
import {
  DISSOLVE_CONFIRM_PHRASE,
  dissolveCouple,
  failureMessage,
} from '../lib/couple-rpc'
import ui from '../styles/ui.module.css'
import styles from './DissolveCoupleDialog.module.css'

type Props = {
  /** 사용자가 취소했을 때. 실행 중에는 호출되지 않는다 */
  onClose: () => void
}

/**
 * 모달 안에서 Tab 순환 대상으로 삼을 요소들.
 * `disabled`/`tabindex="-1"`은 제외한다 — 실행 중(pending)에는 전부 비활성이라 결과가 빈 목록이
 * 되고, 그때는 컨테이너에 포커스를 묶어 둔다(아래 focus 복구 effect).
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 커플 연결 해제 (F-19~F-23, 01 §2.3).
 *
 * 되돌릴 수 없는 동작이라(F-22) 2단계 확인 + 확인 문구 타이핑으로 마찰을 준다(F-23).
 * 실행 중에는 모달을 닫을 수 없다(01 §5).
 */
export function DissolveCoupleDialog({ onClose }: Props) {
  const session = useSession()
  const navigate = useNavigate()
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'warn' | 'confirm'>('warn')
  const [recordCount, setRecordCount] = useState<number | null>(null)
  const [confirmInput, setConfirmInput] = useState('')
  const [pending, setPending] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const coupleId = session.couple?.id ?? null

  /**
   * 열려 있는 동안 배경(앱 트리 전체)을 접근 불가로 만들고, 닫힐 때 열었던 버튼으로 포커스를
   * 되돌린다. 되돌릴 수 없는 동작(F-22)이라 키보드·스크린리더 사용자가 모달 밖의 컨트롤을
   * 건드릴 수 있는 상태를 두지 않는다.
   *
   * `aria-hidden`이 아니라 `inert`를 쓰는 이유: aria-hidden은 AT 트리에서만 감출 뿐
   * 키보드 포커스는 그대로 배경으로 새어 나간다. inert는 포커스·클릭·AT 노출을 함께 끊는다.
   * 모달 자체는 아래에서 body로 포털한다 — 앱 트리 안에 두면 inert에 같이 걸린다.
   */
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const appRoot = document.getElementById('root')
    appRoot?.setAttribute('inert', '')
    return () => {
      // inert를 먼저 풀어야 한다. inert 하위 요소에 대한 focus()는 무시된다.
      appRoot?.removeAttribute('inert')
      previouslyFocused?.focus()
    }
  }, [])

  /**
   * 포커스가 모달 밖(대개 body)으로 떨어졌을 때 되돌려 놓는다.
   *
   * 최초 마운트 외에도 단계 전환('계속' 버튼이 언마운트)과 실행 시작(버튼이 disabled)에서
   * 포커스를 쥐고 있던 요소가 사라진다. 그러면 activeElement가 body가 되고, body의 keydown은
   * 모달로 버블링되지 않아 아래 Tab 트랩이 아예 동작하지 못한다 — 그래서 상태 변화마다 확인한다.
   */
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null || dialog.contains(document.activeElement)) return
    // 확인 단계에서는 곧바로 타이핑할 수 있게 문구 입력 필드로 보낸다(F-23).
    const target = step === 'confirm' && !pending ? confirmInputRef.current : dialog
    ;(target ?? dialog).focus()
  }, [step, pending])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (!pending) onClose()
      return
    }
    if (event.key !== 'Tab') return

    const dialog = dialogRef.current
    if (dialog === null) return
    const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusables.length === 0) {
      // 실행 중이라 포커스 가능한 컨트롤이 하나도 없다. 밖으로 나가는 것만 막는다.
      event.preventDefault()
      return
    }

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (event.shiftKey) {
      // 컨테이너 자신(tabIndex=-1)에 포커스가 있는 상태는 "첫 요소 앞"으로 취급한다.
      if (active === first || active === dialog || !dialog.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last) {
      event.preventDefault()
      first.focus()
    }
  }

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
    // 여기서는 갱신이 먼저다. 커플이 사라지는 순간 RequireCouple이 이 화면을 온보딩으로
    // 돌려보내므로 아래 navigate는 대개 같은 목적지에 대한 확인 사살이다
    // (해제 도중 다른 곳으로 이동한 경우를 대비해 남겨 둔다).
    await session.reload()
    navigate('/onboarding', { replace: true })
  }

  // 배경을 inert로 덮기 때문에 모달은 앱 트리 바깥(body 직속)에 있어야 한다.
  return createPortal(
    <div
      className={styles.overlay}
      onClick={() => {
        if (!pending) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dissolve-title"
        tabIndex={-1}
        // 오버레이 클릭으로 닫히는 걸 막는다. 내용 클릭이 배경까지 올라가면 안 된다.
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2 id="dissolve-title" className={styles.title}>
          커플 연결 해제
        </h2>

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
              <button type="button" className={ui.button} onClick={onClose}>
                취소
              </button>
              <button
                type="button"
                className={`${ui.button} ${ui.buttonDanger}`}
                onClick={() => setStep('confirm')}
              >
                계속
              </button>
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
              <input
                id="dissolve-confirm"
                ref={confirmInputRef}
                className={ui.input}
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
              <button
                type="button"
                className={ui.button}
                disabled={pending}
                onClick={onClose}
              >
                취소
              </button>
              <button
                type="button"
                className={`${ui.button} ${ui.buttonDanger}`}
                disabled={pending || confirmInput !== DISSOLVE_CONFIRM_PHRASE}
                onClick={() => void handleDissolve()}
              >
                {pending ? '해제하는 중…' : '연결 해제'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
