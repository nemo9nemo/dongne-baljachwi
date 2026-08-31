import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { MAX_TAGS, MAX_TAG_LENGTH, normalizeTag, tagLength, toTagNorm } from '../../lib/tags'
import styles from './record-editor.module.css'
import ui from '../../styles/ui.module.css'

type Props = {
  /** 정규화된 표기(`tag`) 목록. 저장 시 이 배열이 그대로 RPC로 간다 */
  tags: string[]
  onChange: (tags: string[]) => void
  /** F-28: 이 커플이 이미 쓴 태그. `couple_tag_usage`의 대표 표기, 사용 횟수 내림차순 */
  suggestions: string[]
  disabled: boolean
}

const MAX_SUGGESTIONS = 6

/**
 * 자유 태그 입력 (F-25~F-29, PRD §5.3).
 *
 * 확정은 **Enter만** 받는다 (F-29). 쉼표·스페이스를 구분자로 쓰면 "홍대 카페"처럼 공백이
 * 들어간 태그를 아예 만들 수 없다.
 */
export function TagField({ tags, onChange, suggestions, disabled }: Props) {
  const [draft, setDraft] = useState('')
  const [announcement, setAnnouncement] = useState('')
  /** 중복 입력 시 잠깐 강조할 대상 (F-27). 값은 tag_norm */
  const [flashNorm, setFlashNorm] = useState<string | null>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (flashNorm === null) return
    const timer = window.setTimeout(() => setFlashNorm(null), 1200)
    return () => window.clearTimeout(timer)
  }, [flashNorm])

  const norms = tags.map(toTagNorm)
  const draftNorm = toTagNorm(normalizeTag(draft))
  const matched =
    draftNorm === ''
      ? []
      : suggestions
          .filter((suggestion) => {
            const norm = toTagNorm(suggestion)
            return norm.includes(draftNorm) && !norms.includes(norm)
          })
          .slice(0, MAX_SUGGESTIONS)

  function commit(raw: string) {
    const tag = normalizeTag(raw)
    if (tag === '') return

    if (tagLength(tag) > MAX_TAG_LENGTH) {
      setAnnouncement(`태그는 ${MAX_TAG_LENGTH}자까지 넣을 수 있어요.`)
      return
    }

    const norm = toTagNorm(tag)
    // F-27: 중복은 에러가 아니다. 이미 있는 칩을 강조해서 "들어가 있다"는 걸 보여준다.
    if (norms.includes(norm)) {
      setFlashNorm(norm)
      setAnnouncement(`${tag}는 이미 추가된 태그예요.`)
      setDraft('')
      return
    }

    // 아래에서 상한을 채우는 순간 입력이 disabled 되므로 이 분기는 자동완성 버튼 경로에서만
    // 도달한다(그쪽은 full이어도 눌린다). 입력창 경로의 안내는 아래 추가 시점이 담당한다.
    if (tags.length >= MAX_TAGS) {
      setAnnouncement(`태그는 최대 ${MAX_TAGS}개까지 넣을 수 있어요.`)
      return
    }

    const next = [...tags, tag]
    onChange(next)
    // F-26 상한 안내: 10개를 채우는 **그 순간**에 함께 알린다. 채워진 뒤에는 입력창이
    // disabled 라 키 입력 자체가 들어오지 않아, 위 분기가 영영 발화되지 않는다.
    setAnnouncement(
      next.length >= MAX_TAGS
        ? `${tag} 태그를 추가했어요. 태그는 최대 ${MAX_TAGS}개까지라 더 넣을 수 없어요.`
        : `${tag} 태그를 추가했어요.`,
    )
    setDraft('')
  }

  function remove(index: number) {
    const removed = tags[index]
    onChange(tags.filter((_, i) => i !== index))
    setAnnouncement(`${removed} 태그를 삭제했어요.`)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // 폼 안의 Enter는 기본적으로 제출이다. 태그 하나 넣으려다 기록이 저장되면 안 된다.
      event.preventDefault()
      commit(draft)
      return
    }
    // F-25: 빈 입력에서 Backspace는 마지막 칩을 지운다.
    if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      event.preventDefault()
      remove(tags.length - 1)
      return
    }
    if (event.key === 'ArrowDown' && matched.length > 0) {
      event.preventDefault()
      suggestionsRef.current?.querySelector('button')?.focus()
    }
  }

  const full = tags.length >= MAX_TAGS

  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor="tag-input">
        태그
      </label>

      {tags.length > 0 && (
        <ul className={styles.chips}>
          {tags.map((tag, index) => (
            // key를 index로 두면 앞 칩을 지웠을 때 뒤 칩들이 전부 새 노드가 된다.
            // tag_norm은 이 목록 안에서 유일하다 (중복은 위에서 막는다).
            <li key={toTagNorm(tag)}>
              <span
                className={
                  flashNorm === toTagNorm(tag)
                    ? `${styles.chip} ${styles.chipFlash}`
                    : styles.chip
                }
              >
                {tag}
                <button
                  type="button"
                  className={styles.chipRemove}
                  disabled={disabled}
                  aria-label={`${tag} 태그 삭제`}
                  onClick={() => remove(index)}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 칩·중복 플래시·자동완성 같은 이 위젯 고유 동작(§9.6이 shadcn 대체를 기각한 이유)은
          그대로 두고, 입력 컨트롤만 다른 폼과 같은 프리미티브를 쓴다. */}
      <Input
        id="tag-input"
        type="text"
        value={draft}
        disabled={disabled || full}
        placeholder={full ? `태그는 ${MAX_TAGS}개까지예요` : 'Enter로 추가 (예: 카페)'}
        autoComplete="off"
        // 자동완성 목록이 뜨는 조합 입력이라 브라우저 기본 제안과 겹치면 안 된다.
        aria-describedby="tag-hint"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {/* 상한에 닿으면 입력이 disabled 라 탭 순서에서 빠진다 — 사유는 이 문구로 남긴다
          (placeholder는 비활성 입력에서 읽히지 않는다). */}
      <p className={ui.hint} id="tag-hint">
        {full ? `태그는 최대 ${MAX_TAGS}개까지예요.` : 'Enter로 추가해요.'} {tags.length}/
        {MAX_TAGS}
      </p>

      {matched.length > 0 && (
        <div className={styles.suggestions} ref={suggestionsRef}>
          <span className={ui.hint}>이전에 쓴 태그</span>
          {matched.map((suggestion) => (
            <button
              key={toTagNorm(suggestion)}
              type="button"
              className={styles.suggestion}
              disabled={disabled}
              onClick={() => commit(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* §6: 칩 추가/삭제를 스크린리더가 알 수 있어야 한다 */}
      <p className="srOnly" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
