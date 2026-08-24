import { useEffect, useRef, useState } from 'react'
import {
  canvasToPngBlob,
  cardFileName,
  cardTextSample,
  ensureCardFontsReady,
  loadCardPhotos,
  renderCard,
} from './record-image-render'
import type { CardInput } from './record-image-render'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import styles from './record-image.module.css'
import ui from '../../styles/ui.module.css'

type Props = {
  /**
   * 카드 렌더 입력 (10 §4.1). **참조가 안정적이어야 한다** — 이 객체가 매 렌더 새로 만들어지면
   * 사진을 다시 내려받고 카드를 다시 그린다.
   */
  input: CardInput
  /** 시트를 닫는다. 호출부가 메뉴 버튼으로 포커스를 되돌릴 필요는 없다(이 컴포넌트가 복원한다) */
  onClose: () => void
}

type Phase =
  | 'preparing' // 폰트·사진 로드 후 미리보기 렌더 중
  | 'ready'
  | 'saving'
  | 'saved' // 다운로드를 트리거했다
  | 'manual' // F-12: download 미지원 — 길게 눌러 저장
  | 'failed'

/**
 * F-12/AC-11: 구형 iOS Safari에는 `<a download>`가 없다. 그 환경에서 링크를 클릭하면
 * 다운로드가 아니라 **현재 탭이 PNG로 이동해** 앱 상태가 통째로 날아간다. 그래서 UA를 보지
 * 않고 속성 존재 여부만 본다 — 없으면 클릭 자체를 하지 않고 결과 이미지를 띄운다.
 */
function downloadSupported(): boolean {
  return 'download' in document.createElement('a')
}

/**
 * 기록 카드 PNG 미리보기 시트 (`docs/specs/10-record-card-image.md` F-04).
 *
 * 접근성 골격(포털·포커스 트랩·Esc·포커스 복귀, §6.4)은 Radix `Dialog`가 담당한다.
 * 생성 중에는 Esc·배경 클릭을 막는다(`ConfirmDialog`의 `busy`와 같은 규칙) — 단 "닫기"
 * 버튼 자체는 preparing 중엔 눌러서 생성을 취소할 수 있다(§2.2), saving 중에만 막는다.
 *
 * 미리보기와 최종 PNG가 **같은 캔버스**다. "저장"은 이미 그려진 캔버스를 인코딩할 뿐이라
 * §6.3의 "미리보기와 실제 출력이 동일해야 한다"가 구조적으로 지켜진다.
 */
export function RecordImageDialog({ input, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('preparing')
  const [attempt, setAttempt] = useState(0)
  const [missingCount, setMissingCount] = useState(0)
  const [noteTruncated, setNoteTruncated] = useState(false)
  /** §6.1 대비책 ③이 발동해 사진 없이 다시 만든 상태 */
  const [textOnlyFallback, setTextOnlyFallback] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resultUrlRef = useRef<string | null>(null)

  // 생성물 objectURL은 시트가 사라질 때 반드시 해제한다. 2160×2700 PNG라 수 MB짜리다.
  useEffect(
    () => () => {
      if (resultUrlRef.current !== null) URL.revokeObjectURL(resultUrlRef.current)
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    // §2.2 "생성 중 화면 이탈 → 작업을 취소한다". 대비책 ②의 fetch도 같이 끊는다.
    const controller = new AbortController()

    async function run() {
      const canvas = canvasRef.current
      if (canvas === null) return

      await ensureCardFontsReady(cardTextSample(input))
      if (cancelled) return

      const loaded = await loadCardPhotos(input.photos, controller.signal)
      if (cancelled) {
        loaded.images.forEach((image) => image.release())
        return
      }

      try {
        const result = await renderCard(canvas, input, loaded.images, loaded.extraCount)
        if (cancelled) return
        setMissingCount(loaded.failedCount)
        setNoteTruncated(result.noteTruncated)
        setPhase('ready')
      } catch {
        if (!cancelled) setPhase('failed')
      } finally {
        // 캔버스에 이미 픽셀이 복사됐으니 원본은 여기서 버린다. 들고 있으면 objectURL이
        // 그대로 메모리에 남는다.
        loaded.images.forEach((image) => image.release())
      }
    }

    void run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [input, attempt])

  async function handleSave() {
    // AC-16: 연타해도 파일은 하나만 나온다.
    if (phase === 'saving') return
    const canvas = canvasRef.current
    if (canvas === null) return

    setPhase('saving')

    let blob: Blob
    try {
      blob = await canvasToPngBlob(canvas)
    } catch {
      // §6.1 대비책 ③: ①(crossOrigin)·②(fetch+objectURL)를 뚫고도 캔버스가 오염됐다면
      // 재시도해도 결과가 같다. 사진을 빼고 텍스트 전용으로 다시 그려서라도 파일은 준다 —
      // 여기서 포기하면 사용자는 아무것도 얻지 못한다. (버킷 공개 전환은 대비책이 아니다)
      try {
        await renderCard(canvas, input, [], 0)
        blob = await canvasToPngBlob(canvas)
        setTextOnlyFallback(true)
        setMissingCount(input.photos.length)
      } catch {
        setPhase('failed')
        return
      }
    }

    if (resultUrlRef.current !== null) URL.revokeObjectURL(resultUrlRef.current)
    const url = URL.createObjectURL(blob)
    resultUrlRef.current = url
    setResultUrl(url)

    if (!downloadSupported()) {
      setPhase('manual')
      return
    }

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = cardFileName(input.stationName, input.visitedOn)
    // Firefox는 문서에 붙지 않은 링크의 click()을 무시한다.
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setPhase('saved')
  }

  const busy = phase === 'preparing' || phase === 'saving'
  // review §4 D-6: 실패 문구는 아래 `.error`(role="alert")가 이미 말한다 — alert 리전은
  // 그 자체로 즉시 발화되므로, 여기(polite 리전)까지 같은 문장을 넣으면 두 번 읽힌다.
  const status =
    phase === 'preparing'
      ? '카드 미리보기를 만드는 중이에요'
      : phase === 'saving'
        ? '이미지를 만드는 중이에요'
        : phase === 'saved'
          ? '이미지를 저장했어요'
          : phase === 'manual'
            ? '이미지를 만들었어요. 아래 이미지를 길게 눌러 저장하세요'
            : phase === 'failed'
              ? ''
              : '미리보기가 준비됐어요'

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogPortal>
        <DialogOverlay className={styles.overlay}>
          <DialogContent
            className={resultUrl === null ? styles.dialog : `${styles.dialog} ${styles.dialogResult}`}
            // preparing/saving 중에는 Esc·바깥 클릭으로 닫히지 않는다. 아래 "닫기" 버튼은
            // saving 중에만 막는다 — preparing 중 명시적 닫기는 허용해 생성을 취소할 수 있게
            // 두되(§2.2), 실수로 배경을 클릭하거나 Esc를 누르는 것까지는 막는 것이 이 화면의
            // 기존 규칙이었다(원본 구현 그대로 유지).
            onEscapeKeyDown={(event) => busy && event.preventDefault()}
            onInteractOutside={(event) => busy && event.preventDefault()}
          >
            <DialogTitle className={ui.sectionTitle}>이미지로 저장</DialogTitle>

            <div className={resultUrl === null ? styles.preview : `${styles.preview} ${styles.previewResult}`}>
              <canvas
                ref={canvasRef}
                className={resultUrl === null ? styles.canvas : styles.hidden}
                // 캔버스 내용은 아래 안내 문구와 본문(기록 상세)이 이미 텍스트로 전달한다.
                aria-hidden="true"
              />
              {resultUrl !== null && (
                <img
                  className={styles.canvas}
                  src={resultUrl}
                  // §6.4: 폴백으로 화면에 남는 이미지이므로 의미 있는 대체 텍스트를 준다.
                  alt={`${input.stationName} ${input.visitedOn} 기록 카드 이미지`}
                />
              )}
              {phase === 'preparing' && <div className={styles.skeleton} aria-hidden="true" />}
            </div>

            <p className={styles.live} role="status" aria-live="polite">
              {status}
            </p>

            {/* §5 부분 성공: 무엇이 빠졌는지는 반드시 알린다 */}
            {missingCount > 0 && (
              <p className={ui.hint}>
                사진 {missingCount}장을 넣지 못했어요
                {textOnlyFallback && ' — 글자만 담은 카드로 만들었어요'}.
              </p>
            )}
            {noteTruncated && <p className={ui.hint}>일기가 길어 카드에는 앞부분만 담겨요.</p>}
            {phase === 'manual' && (
              <p className={ui.notice}>이미지를 길게 눌러 &quot;사진에 저장&quot;을 선택하세요.</p>
            )}
            {phase === 'saved' && (
              // AC-11: 다운로드를 트리거했어도 실제로 파일이 떨어졌는지는 알 수 없다. "아무 일도
              // 일어나지 않은" 상태로 남지 않도록 길게 눌러 저장하는 길을 함께 열어 둔다.
              <p className={ui.hint}>저장되지 않았다면 위 이미지를 길게 눌러 저장하세요.</p>
            )}
            {phase === 'failed' && (
              <p className={ui.error} role="alert">
                이미지를 만들지 못했어요.
              </p>
            )}

            <div className={ui.buttonRow}>
              {/* preparing 중에는 닫을 수 있게 둔다(생성 취소, §2.2) — saving 중에만 막는다. */}
              <Button type="button" disabled={phase === 'saving'} onClick={onClose}>
                닫기
              </Button>
              {phase === 'failed' ? (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => {
                    setPhase('preparing')
                    setAttempt((prev) => prev + 1)
                  }}
                >
                  다시 시도
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  disabled={busy}
                  onClick={() => void handleSave()}
                >
                  {phase === 'saving' ? '만드는 중…' : '저장'}
                </Button>
              )}
            </div>
          </DialogContent>
        </DialogOverlay>
      </DialogPortal>
    </Dialog>
  )
}
