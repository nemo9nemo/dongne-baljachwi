import { useEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './record-editor.module.css'
import ui from '../../styles/ui.module.css'

type Props = {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel: string
  /** 되돌릴 수 없는 쪽(나가기·삭제)이면 확인 버튼을 danger로 그린다 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 확인 모달. 이 화면에서 두 곳에 쓴다 — 작성 중 이탈(F-04)과 "삭제된 기록" 안내(§2.3).
 *
 * `DissolveCoupleDialog`와 같은 접근성 처리(배경 inert + body 포털 + Esc + 포커스 복귀)를
 * 쓰되, 여기는 단계가 없어 포커스 트랩을 버튼 두 개 순환으로 단순화했다.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  /**
   * `aria-hidden`이 아니라 `inert`를 쓴다: aria-hidden은 AT 트리에서만 감출 뿐 키보드
   * 포커스는 배경으로 새어 나간다. 모달 자체를 body로 포털하는 이유도 같다 —
   * 앱 트리 안에 두면 inert에 함께 걸린다.
   */
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const appRoot = document.getElementById('root')
    appRoot?.setAttribute('inert', '')
    // 파괴적이지 않은 쪽(취소)에 기본 포커스를 준다.
    cancelRef.current?.focus()
    return () => {
      // inert를 먼저 풀어야 한다. inert 하위 요소에 대한 focus()는 무시된다.
      appRoot?.removeAttribute('inert')
      previouslyFocused?.focus()
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (dialog === null) return
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
    if (buttons.length === 0) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    const active = document.activeElement
    if (event.shiftKey) {
      if (active === first || active === dialog || !dialog.contains(active)) {
        event.preventDefault()
        last?.focus()
      }
    } else if (active === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return createPortal(
    <div className={styles.overlay} onClick={onCancel}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-dialog-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2 id="record-dialog-title" className={ui.sectionTitle}>
          {title}
        </h2>
        {children}
        <div className={ui.buttonRow}>
          <button ref={cancelRef} type="button" className={ui.button} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? `${ui.button} ${ui.buttonDanger}` : `${ui.button} ${ui.buttonPrimary}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
