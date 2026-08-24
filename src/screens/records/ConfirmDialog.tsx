import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import styles from './record-editor.module.css'
import ui from '../../styles/ui.module.css'

type Props = {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel: string
  /** 되돌릴 수 없는 쪽(나가기·삭제)이면 확인 버튼을 danger로 그린다 */
  danger?: boolean
  /** 진행 중(예: 삭제 요청 대기)이면 두 버튼을 막고 Esc·배경 클릭으로도 닫히지 않는다 */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 확인 모달. 이 화면에서 두 곳에 쓴다 — 작성 중 이탈(F-04)과 "삭제된 기록" 안내(§2.3).
 *
 * 접근성 배관(포털·포커스 트랩·Esc·포커스 복귀)은 Radix `Dialog`(`@/components/ui/dialog`)가
 * 담당한다 — Content 마운트 시 첫 포커스 가능 요소(취소 버튼, 파괴적이지 않은 쪽)로 자동
 * 이동하므로 `DissolveCoupleDialog`처럼 별도 지정이 필요 없다.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogPortal>
        <DialogOverlay className={styles.overlay}>
          <DialogContent
            className={styles.dialog}
            // busy 중에는 Esc·바깥 클릭 모두로 닫히지 않는다(진행 중 삭제 요청 등).
            onEscapeKeyDown={(event) => busy && event.preventDefault()}
            onInteractOutside={(event) => busy && event.preventDefault()}
          >
            {/* Radix가 id를 자동 생성해 Content의 aria-labelledby에 연결한다 — 직접 잇지 않는다. */}
            <DialogTitle className={ui.sectionTitle}>{title}</DialogTitle>
            {children}
            <div className={ui.buttonRow}>
              <Button type="button" disabled={busy} onClick={onCancel}>
                {cancelLabel}
              </Button>
              <Button
                type="button"
                variant={danger ? 'destructive' : 'default'}
                disabled={busy}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </DialogContent>
        </DialogOverlay>
      </DialogPortal>
    </Dialog>
  )
}
