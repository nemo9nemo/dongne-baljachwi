import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { StationRow } from '../../lib/station-master'
import styles from './record-editor.module.css'
import ui from '../../styles/ui.module.css'

/** 검색 결과에 붙는 호선 배지 (F-09). `colorToken`은 색상값이 아니라 tokens.css 변수 이름 */
export type LineBadge = { code: string; name: string; colorToken: string }

type Props = {
  /** 마스터 전체. 여기서 필터링한다 (F-08 초성 검색을 서버 왕복 없이 하기 위해) */
  stations: StationRow[]
  badgesByStationId: Map<string, LineBadge[]>
  /** 선택된 역. 없으면 검색 입력이 처음부터 열려 있다 */
  value: StationRow | null
  onChange: (station: StationRow) => void
  disabled: boolean
}

const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]

const HANGUL_BASE = 0xac00
const HANGUL_LAST = 0xd7a3
/** 초성 하나가 담당하는 음절 수 (중성 21 × 종성 28) */
const SYLLABLES_PER_CHOSUNG = 588

/** 완성형 음절을 초성으로 접는다. 자모·영문·숫자는 그대로 둔다 */
function toChosung(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      out += CHOSUNG[Math.floor((code - HANGUL_BASE) / SYLLABLES_PER_CHOSUNG)]
    } else {
      out += char
    }
  }
  return out
}

/** 호환 자모 영역(ㄱ~ㅎ). 이 문자가 하나라도 있으면 초성 질의로 본다 */
const JAMO = /[ㄱ-ㅎ]/

const MAX_RESULTS = 20

/**
 * 역 선택 (F-06~F-10).
 *
 * 폼 안에 노선도를 다시 띄우지 않고 이름 검색으로만 바꾼다 (F-07). 검색은 **서버를 타지 않고**
 * 이미 캐시된 마스터(944행)를 필터링한다 — 초성 검색을 서버에서 하려면 별도 인덱스 컬럼이
 * 필요한데, 전국 확장(1,073행)까지도 클라이언트 필터로 충분하다 (§9 판단).
 */
export function StationPicker({ stations, badgesByStationId, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(value === null)
  const [query, setQuery] = useState('')
  const resultsRef = useRef<HTMLUListElement>(null)

  /**
   * 검색 인덱스. 944행 × 초성 변환은 키 입력마다 다시 할 만한 비용이 아니다.
   * F-10: 폐역은 애초에 인덱스에 넣지 않는다 (이미 선택된 역은 `value`로 따로 들어오므로
   * 목록에서 빠져도 표시가 사라지지 않는다).
   */
  const index = useMemo(
    () =>
      stations
        .filter((station) => station.is_active)
        .map((station) => ({ station, chosung: toChosung(station.name) })),
    [stations],
  )

  const trimmed = query.trim()
  const results = useMemo(() => {
    if (trimmed === '') return []
    // 초성 질의면 양쪽을 초성으로 접어 비교한다. "홍대ㅇ"처럼 IME 조합 중인 입력도
    // 같은 경로로 처리된다 — 사용자가 타이핑을 멈춘 순간마다 결과가 사라지지 않는다.
    const chosungQuery = JAMO.test(trimmed)
    const needle = chosungQuery ? toChosung(trimmed) : trimmed
    const matched = index.filter(({ station, chosung }) =>
      chosungQuery ? chosung.includes(needle) : station.name.includes(needle),
    )
    // 앞에서부터 일치하는 역을 위로 올린다. "역삼"을 치고 "역삼"이 3번째에 있으면 검색이
    // 안 되는 것처럼 느껴진다.
    matched.sort((a, b) => {
      const aHead = (chosungQuery ? a.chosung : a.station.name).startsWith(needle)
      const bHead = (chosungQuery ? b.chosung : b.station.name).startsWith(needle)
      if (aHead !== bHead) return aHead ? -1 : 1
      return a.station.name.localeCompare(b.station.name, 'ko')
    })
    return matched.slice(0, MAX_RESULTS).map((item) => item.station)
  }, [index, trimmed])

  /** 위/아래 화살표로 입력 ↔ 결과를 오간다 (AC-19). 항목마다 ref를 두지 않고 DOM에서 찾는다 */
  function moveFocus(from: HTMLElement, delta: number) {
    const list = resultsRef.current
    if (list === null) return
    const items = [...list.querySelectorAll<HTMLButtonElement>('button')]
    if (items.length === 0) return
    const current = items.indexOf(from as HTMLButtonElement)
    const next = current === -1 ? (delta > 0 ? 0 : items.length - 1) : current + delta
    if (next < 0 || next >= items.length) return
    items[next]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Escape' && value !== null) {
      setOpen(false)
    }
  }

  return (
    <div className={ui.field}>
      <span className={ui.label} id="station-label">
        역 <span className={styles.required}>*</span>
      </span>

      {value !== null && (
        <div className={styles.selectedStation}>
          <div>
            <span className={styles.selectedStationName}>{value.name}</span>
            <Badges badges={badgesByStationId.get(value.id) ?? []} />
          </div>
          <button
            type="button"
            className={styles.linkButton}
            disabled={disabled}
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
          >
            {open ? '닫기' : '역 변경'}
          </button>
        </div>
      )}

      {open && (
        <>
          <label className="srOnly" htmlFor="station-search">
            역 이름 검색
          </label>
          <input
            id="station-search"
            className={ui.input}
            type="search"
            value={query}
            disabled={disabled}
            placeholder="역 이름 또는 초성 (예: 홍대입구, ㅎㄷㅇㄱ)"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />

          {/* 역 미선택은 저장 불가 사유이므로 인라인으로 안내한다 (§2.3) */}
          {value === null && <p className={ui.hint}>기록할 역을 골라주세요.</p>}

          {trimmed !== '' && results.length === 0 && (
            <p className={ui.hint} role="status">
              검색 결과가 없어요.
            </p>
          )}

          <ul className={styles.searchResults} ref={resultsRef}>
            {results.map((station) => (
              <li key={station.id}>
                <button
                  type="button"
                  className={styles.searchResult}
                  onClick={() => {
                    onChange(station)
                    setOpen(false)
                    setQuery('')
                  }}
                  onKeyDown={handleKeyDown}
                >
                  <span className={styles.searchResultName}>{station.name}</span>
                  <Badges badges={badgesByStationId.get(station.id) ?? []} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * F-09: 동명이역을 구분하려면 소속 호선이 함께 보여야 한다.
 *
 * 배지 바탕을 노선 색으로 칠하지 않는다 — `lines.color_token`에 대응하는 CSS 변수가
 * 아직 2호선만 정의돼 있고(tokens.css), 없는 노선은 대비를 보장할 수 없다.
 * 색은 점으로만 쓰고 글자는 본문색으로 둔다.
 */
function Badges({ badges }: { badges: LineBadge[] }) {
  if (badges.length === 0) return null
  return (
    <span className={styles.badges}>
      {badges.map((badge) => (
        <span key={badge.code} className={styles.badge}>
          <span
            className={styles.badgeDot}
            style={{ background: `var(--${badge.colorToken}, var(--line-default))` }}
            aria-hidden="true"
          />
          {badge.name}
        </span>
      ))}
    </span>
  )
}
