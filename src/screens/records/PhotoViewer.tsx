import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, TouchEvent } from 'react'
import { createPortal } from 'react-dom'
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
 * `ConfirmDialog`와 같은 접근성 골격(body 포털 + `inert` + 포커스 복귀)을 쓴다.
 * 핀치 줌은 이번 라운드에 넣지 않는다 — 제스처 상태 기계가 이 화면의 본질(스와이프
 * 내비게이션)보다 복잡도가 커서, 필요성이 확인되면 별도로 붙인다.
 */
export function PhotoViewer({ photos, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const touchStartX = useRef<number | null>(null)

  const count = photos.length
  const current = photos[index]

  function go(delta: number) {
    setIndex((prev) => Math.min(Math.max(prev + delta, 0), count - 1))
  }

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const appRoot = document.getElementById('root')
    appRoot?.setAttribute('inert', '')
    closeRef.current?.focus()
    return () => {
      appRoot?.removeAttribute('inert')
      previouslyFocused?.focus()
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      onClose()
      return
    }
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

  return createPortal(
    <div className={styles.viewerOverlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.viewerDialog}
        role="dialog"
        aria-modal="true"
        aria-label={current.alt}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button
          ref={closeRef}
          type="button"
          className={styles.viewerClose}
          aria-label="닫기"
          onClick={onClose}
        >
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
      </div>
    </div>,
    document.body,
  )
}
