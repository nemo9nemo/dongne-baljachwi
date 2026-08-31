import { useRef, useState } from 'react'
import type { KeyboardEvent, TouchEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog'
import styles from './record-detail.module.css'

export type ViewerPhoto = { id: string; url: string | null; alt: string }

type Props = {
  photos: ViewerPhoto[]
  startIndex: number
  onClose: () => void
}

/** 스와이프로 넘기는 기준 이동량. 이보다 짧으면 탭/스크롤 의도로 본다 */
const SWIPE_THRESHOLD_PX = 48

/**
 * 사진 전체화면 뷰어 (06 F-05, §6 접근성).
 *
 * 접근성 배관(포털·**포커스 트랩**·Esc·포커스 복귀)은 `ConfirmDialog`/`RecordImageDialog`/
 * `DissolveCoupleDialog`와 같은 Radix `Dialog`가 담당한다. 예전에는 `inert` + 수동 포커스
 * 이동으로 직접 짰는데, `inert`는 배경만 막을 뿐 **뷰어 안에서 Tab이 순환하지 않아서**
 * 마지막 컨트롤(다음 사진)에서 Tab을 누르면 포커스가 브라우저 UI로 빠져나갔다.
 * Radix의 `FocusScope`는 Tab을 직접 가로채 순환시킨다.
 *
 * 좌우 이동(ArrowLeft/Right)과 스와이프는 Radix가 관여하지 않는 이 뷰어만의 동작이라
 * 그대로 남긴다. Esc는 Radix가 처리하므로 여기서 다시 받지 않는다.
 *
 * 핀치 줌은 이번 라운드에 넣지 않는다 — 제스처 상태 기계가 이 화면의 본질(스와이프
 * 내비게이션)보다 복잡도가 커서, 필요성이 확인되면 별도로 붙인다.
 */
export function PhotoViewer({ photos, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex)
  const touchStartX = useRef<number | null>(null)

  const count = photos.length
  const current = photos[index]

  function go(delta: number) {
    setIndex((prev) => Math.min(Math.max(prev + delta, 0), count - 1))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') go(-1)
    else if (event.key === 'ArrowRight') go(1)
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current
    touchStartX.current = null
    if (startX === null) return
    const endX = event.changedTouches[0]?.clientX ?? startX
    const delta = endX - startX
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return
    go(delta > 0 ? -1 : 1)
  }

  if (current === undefined) return null

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogPortal>
        {/* 배경 클릭으로 닫는다. Radix의 onInteractOutside 대신 오버레이 클릭을 쓰는 이유는
            이 뷰어의 오버레이가 곧 사진 바깥 여백이어서, "여백을 눌러 닫는다"가 그대로
            같은 동작이기 때문이다. */}
        <DialogOverlay className={styles.viewerOverlay} onClick={onClose}>
          <DialogContent
            className={styles.viewerDialog}
            aria-describedby={undefined}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleKeyDown}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* 사진의 대체 텍스트가 곧 이 다이얼로그의 이름이다. 화면에는 사진이 그 자리를
                대신하므로 시각적으로는 숨긴다. */}
            <DialogTitle className="srOnly">{current.alt}</DialogTitle>

            <button type="button" className={styles.viewerClose} aria-label="닫기" onClick={onClose}>
              ×
            </button>

            {current.url === null ? (
              <p className={styles.viewerFallback}>사진을 불러오지 못했어요.</p>
            ) : (
              <img className={styles.viewerImage} src={current.url} alt={current.alt} />
            )}

            {count > 1 && (
              <>
                <button
                  type="button"
                  className={`${styles.viewerNav} ${styles.viewerNavPrev}`}
                  disabled={index === 0}
                  aria-label="이전 사진"
                  onClick={() => go(-1)}
                >
                  ◀
                </button>
                <button
                  type="button"
                  className={`${styles.viewerNav} ${styles.viewerNavNext}`}
                  disabled={index === count - 1}
                  aria-label="다음 사진"
                  onClick={() => go(1)}
                >
                  ▶
                </button>
                <p className={styles.viewerCount} aria-hidden="true">
                  {index + 1} / {count}
                </p>
              </>
            )}
          </DialogContent>
        </DialogOverlay>
      </DialogPortal>
    </Dialog>
  )
}
