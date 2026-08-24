import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import {
  ACCEPTED_MIME,
  MAX_PHOTOS,
  preparePhoto,
  rejectionMessage,
  rejectionOf,
} from './photo-pipeline'
import type { PreparedPhoto } from './photo-pipeline'
import type { PhotoContentType } from '../../lib/database.types'
import { Button } from '@/components/ui/button'
import styles from './record-editor.module.css'
import ui from '../../styles/ui.module.css'

/**
 * 폼이 들고 있는 사진 한 장.
 *
 * `existing` = `record_photos`에 행이 있는 사진. `new` = 아직 DB에 없는 사진.
 * 저장 파이프라인이 업로드+행 삽입에 성공하면 `new`를 `existing`으로 승격시킨다 —
 * 그래야 부분 실패 후 재시도할 때 이미 올라간 사진을 두 번 삽입하지 않는다.
 */
export type EditorPhoto =
  | {
      kind: 'existing'
      /** `record_photos.id`. Storage 경로에도 들어 있다 */
      id: string
      storagePath: string
      width: number
      height: number
      /**
       * 아래 둘은 화면에 쓰지 않는다. 순서가 바뀐 행을 **삭제 후 재삽입**할 때
       * 원래 값 그대로 다시 넣어야 해서 들고 있는다 (RecordEditorScreen.syncPhotos 주석).
       */
      byteSize: number
      contentType: PhotoContentType
      /**
       * 썸네일 주소. 서명 URL(1시간)이거나, 방금 올린 사진이면 로컬 blob URL이다.
       * 발급 실패 시 null — 그 자리만 대체 표시한다.
       */
      url: string | null
      /** DB에 저장된 현재 순서. 이 값과 화면 순서가 다를 때만 행을 다시 만든다 */
      dbSortOrder: number
    }
  | {
      kind: 'new'
      /** 클라이언트가 만든 uuid. Storage 경로와 `record_photos.id`에 그대로 쓴다 (§4.3) */
      id: string
      prepared: PreparedPhoto
      previewUrl: string
      /** 직전 저장에서 업로드가 실패했는가 (F-16 부분 실패) */
      failed: boolean
    }

type Props = {
  photos: EditorPhoto[]
  onChange: (photos: EditorPhoto[]) => void
  disabled: boolean
  /** F-22: 업로드 진행률. null이면 업로드 중이 아니다 */
  progress: { done: number; total: number } | null
}

/**
 * 사진 입력 (F-15, F-18~F-23).
 *
 * 선택 즉시 리사이즈·재인코딩까지 끝내 둔다(업로드는 저장 후, F-16). 저장 버튼을 누른
 * 뒤에 5장을 인코딩하면 그 시간이 통째로 "저장이 멈춘 것"처럼 보이기 때문이다.
 */
export function PhotoField({ photos, onChange, disabled, progress }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [preparing, setPreparing] = useState(0)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  /**
   * 만든 objectURL을 전부 모아 두었다가 언마운트 때 해제한다.
   * 화면을 떠날 때 놓치면 원본 크기 blob이 탭이 닫힐 때까지 메모리에 남는다.
   */
  const createdUrls = useRef<Set<string>>(new Set())
  useEffect(() => {
    const urls = createdUrls.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    // 같은 파일을 다시 고를 수 있어야 하므로 값을 비운다 (change 이벤트가 안 뜨는 문제).
    event.target.value = ''
    if (files.length === 0) return

    const nextErrors: string[] = []
    const accepted: File[] = []
    let room = MAX_PHOTOS - photos.length

    for (const file of files) {
      const rejection = rejectionOf(file)
      if (rejection !== null) {
        // §2.3: 거부는 그 파일에만 적용한다. 나머지 선택은 정상 유지된다.
        nextErrors.push(rejectionMessage(rejection, file.name))
        continue
      }
      if (room <= 0) {
        nextErrors.push(`사진은 최대 ${MAX_PHOTOS}장까지 올릴 수 있어요.`)
        break
      }
      accepted.push(file)
      room -= 1
    }
    setErrors(nextErrors)
    if (accepted.length === 0) return

    setPreparing(accepted.length)
    const added: EditorPhoto[] = []
    // 순차 처리한다. 5장을 동시에 디코딩하면 모바일에서 메모리 압박으로 탭이 죽는다
    // (원본 4,000×3,000 한 장이 비트맵으로 48MB다).
    for (const file of accepted) {
      try {
        const prepared = await preparePhoto(file)
        const previewUrl = URL.createObjectURL(prepared.blob)
        createdUrls.current.add(previewUrl)
        added.push({
          kind: 'new',
          id: crypto.randomUUID(),
          prepared,
          previewUrl,
          failed: false,
        })
      } catch {
        nextErrors.push(`${file.name} — 이미지를 읽지 못했어요.`)
      }
      setPreparing((count) => count - 1)
    }
    // 위에서 넘긴 것과 같은 배열 객체를 다시 넘기면 React가 변경 없음으로 보고 건너뛴다.
    // 디코딩 실패 안내가 조용히 사라지는 원인이 된다.
    setErrors([...nextErrors])
    if (added.length > 0) onChange([...photos, ...added])
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= photos.length || from === to) return
    const next = [...photos]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    onChange(next)
  }

  function remove(index: number) {
    const target = photos[index]
    // F-23: 기존 사진은 여기서 지우지 않는다. 저장 시점에야 DB/Storage에 반영된다.
    // (취소하고 나가면 원상복구되어야 한다 — AC-13)
    if (target?.kind === 'new') {
      URL.revokeObjectURL(target.previewUrl)
      createdUrls.current.delete(target.previewUrl)
    }
    onChange(photos.filter((_, i) => i !== index))
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault()
    const from = Number(event.dataTransfer.getData('text/plain'))
    setDragIndex(null)
    if (Number.isInteger(from)) move(from, index)
  }

  const full = photos.length >= MAX_PHOTOS

  return (
    <div className={ui.field}>
      <span className={ui.label} id="photo-label">
        사진
      </span>
      <p className={ui.hint}>
        최대 {MAX_PHOTOS}장. 첫 번째 사진이 대표로 보여요.
      </p>

      {photos.length > 0 && (
        <ul className={styles.photoGrid} aria-labelledby="photo-label">
          {photos.map((photo, index) => {
            const url = photo.kind === 'new' ? photo.previewUrl : photo.url
            return (
              <li
                key={photo.id}
                className={
                  dragIndex === index ? `${styles.photoItem} ${styles.photoDragging}` : styles.photoItem
                }
                // 드래그는 마우스 사용자용 편의다. 터치·키보드는 아래 이동 버튼이 담당한다 (AC-19).
                draggable={!disabled}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', String(index))
                  setDragIndex(index)
                }}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, index)}
              >
                {url === null ? (
                  <div className={styles.photoFallback}>불러오지 못함</div>
                ) : (
                  <img className={styles.photoThumb} src={url} alt={`사진 ${index + 1}`} />
                )}

                {index === 0 && <span className={styles.photoBadge}>대표</span>}
                {photo.kind === 'new' && photo.failed && (
                  <span className={`${styles.photoBadge} ${styles.photoBadgeFailed}`}>실패</span>
                )}

                <div className={styles.photoControls}>
                  <button
                    type="button"
                    className={styles.photoButton}
                    disabled={disabled || index === 0}
                    aria-label={`사진 ${index + 1} 앞으로 이동`}
                    onClick={() => move(index, index - 1)}
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    className={styles.photoButton}
                    disabled={disabled || index === photos.length - 1}
                    aria-label={`사진 ${index + 1} 뒤로 이동`}
                    onClick={() => move(index, index + 1)}
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    className={styles.photoButton}
                    disabled={disabled}
                    aria-label={`사진 ${index + 1} 삭제`}
                    onClick={() => remove(index)}
                  >
                    ×
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <input
        ref={inputRef}
        className="srOnly"
        type="file"
        accept={ACCEPTED_MIME.join(',')}
        multiple
        disabled={disabled || full}
        onChange={(event) => void handleFiles(event)}
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || full || preparing > 0}
        onClick={() => inputRef.current?.click()}
      >
        {preparing > 0 ? '사진 준비 중…' : '사진 추가'}
      </Button>
      {full && <p className={ui.hint}>사진은 최대 {MAX_PHOTOS}장까지</p>}

      {progress !== null && (
        <p className={ui.hint} role="status">
          사진 업로드 중 {progress.done}/{progress.total}
        </p>
      )}

      {errors.length > 0 && (
        <div className={ui.error} role="alert">
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
    </div>
  )
}
