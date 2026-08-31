import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import { useSession } from '../../auth/session-context'
import { supabase } from '../../lib/supabase'
import { loadStationMaster } from '../../lib/station-master'
import type { StationMaster } from '../../lib/station-master'
import { fetchRecordCardPage } from '../../lib/record-card-query'
import type { CardCursor, RecordCard as RecordCardData } from '../../lib/record-card-query'
import { readStateFlag } from '../../lib/router-state'
import { findScrollParent, screenCache, scopeToCouple } from '../../lib/screen-cache'
import { normalizeTag, toTagNorm } from '../../lib/tags'
import { RecordCard } from '../../components/RecordCard'
import { Button } from '@/components/ui/button'
import styles from './timeline.module.css'
import ui from '../../styles/ui.module.css'

/**
 * 타임라인 (`docs/specs/08-timeline.md`).
 *
 * 노선도가 공간 축이라면 이 화면은 시간 축이다 — 전체 기록을 최신순으로 훑고, 태그 칩으로
 * 좁힌다. 역이 정해지지 않은 상태에서 기록을 시작하는 유일한 진입점이기도 하다(F-09).
 *
 * 이번 라운드에 없는 것:
 * - **목록 가상화**: §9가 "측정 후 판단"으로 미뤘고 아직 500개 누적 시나리오를 측정할
 *   방법이 없다. DOM에 전부 쌓인다.
 * - **칩 정렬의 최근 사용 순 타이브레이커(F-12)**: `couple_tag_usage` 뷰에 `last_used_at`이
 *   없어(00 §4.9) 사용 횟수만으로 정렬한다.
 * - **뷰포트 단위 서명 URL 발급**: 페이지당 최대 20장이라 배치로 한 번에 서명한다.
 */

type Chip = { tag: string; tagNorm: string; usageCount: number }

export function TimelineScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const location = useLocation()
  const session = useSession()

  const coupleId = session.couple?.id ?? null
  // POP 복귀 캐시(F-10)는 화면 밖에 산다 — 읽기 전에 소유 커플을 맞춘다(01 AC-15).
  scopeToCouple(coupleId)

  const rawTag = searchParams.get('tag')
  // F-19: tag_norm 기준 매칭. URL에는 06이 표시용 tag를 그대로 실어 보내므로 여기서 정규화한다.
  const selectedTagNorm = rawTag === null ? null : toTagNorm(normalizeTag(rawTag))

  const [chips, setChips] = useState<Chip[] | null>(null)
  const [cards, setCards] = useState<RecordCardData[]>([])
  const [cursor, setCursor] = useState<CardCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [master, setMaster] = useState<StationMaster | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [announcement, setAnnouncement] = useState('')

  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLButtonElement>(null)
  const scrollParentRef = useRef<HTMLElement | null>(null)

  // ── 태그 칩 (§4.1 ①) — 목록과 독립적으로 로드. 실패해도 목록은 정상 표시(AC-13) ──
  useEffect(() => {
    let alive = true
    void supabase
      .from('couple_tag_usage')
      .select('tag, tag_norm, usage_count')
      .order('usage_count', { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (!alive) return
        if (error !== null || data === null) return
        setChips(data.map((row) => ({ tag: row.tag, tagNorm: row.tag_norm, usageCount: row.usage_count })))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    void loadStationMaster()
      .then(setMaster)
      .catch(() => setMaster(null))
  }, [])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // ── 목록 로드 — 태그 필터가 바뀔 때마다 처음부터 (F-21) ────────────────────
  const load = useCallback(async (tagNorm: string | null) => {
    setLoadState('loading')
    setMoreError(false)
    try {
      const page = await fetchRecordCardPage({ tagNorm })
      setCards(page.cards)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setLoadState('ready')
    } catch {
      setLoadState('failed')
    }
  }, [])

  useEffect(() => {
    // POP(뒤로가기)이고 같은 필터의 캐시가 있으면 새로 받지 않고 그대로 되살린다(F-10).
    // `navigationType`을 의도적으로 의존성에서 뺀다 — 이 화면은 라우트 전용이라 마운트마다
    // 한 번만 의미가 있고, 넣으면 "필터만 바뀐" 재실행에서도 오래된 POP 판정이 새로 걸린다.
    //
    // `restoreList`: 06이 삭제 후 `replace`로 돌려보낸 경우다. POP이 아니지만 캐시는 방금
    // 그 카드를 뺀 최신 상태라 되살리는 게 맞다(AC-14 — 스크롤도 함께 유지된다).
    const restoreAllowed = navigationType === 'POP' || readStateFlag(location.state, 'restoreList')
    const cached = screenCache.timeline
    if (restoreAllowed && cached !== null && cached.tagNorm === selectedTagNorm) {
      setCards(cached.cards)
      setCursor(cached.cursor)
      setHasMore(cached.hasMore)
      setLoadState('ready')
      const savedTop = cached.scrollTop
      // 목록이 그려진 뒤에야 스크롤 컨테이너가 그만큼 커진다.
      requestAnimationFrame(() => {
        const parent = scrollParentRef.current
        if (parent !== null) parent.scrollTop = savedTop
        else window.scrollTo(0, savedTop)
      })
      return
    }
    void load(selectedTagNorm)
    // `load`는 useCallback(deps: [])로 참조가 고정돼 있어 넣어도 재실행 트리거가 되지 않는다.
    // `coupleId`는 커플이 바뀌었을 때(캐시가 비워졌을 때) 다시 받게 하려고 넣는다.
  }, [selectedTagNorm, load, coupleId])

  useEffect(() => {
    scrollParentRef.current = findScrollParent(rootRef.current)
  }, [])

  // 상태가 바뀔 때마다 캐시를 최신으로 유지한다. 실제 스크롤 위치는 언마운트 시점에 채운다.
  useEffect(() => {
    screenCache.timeline = {
      tagNorm: selectedTagNorm,
      cards,
      cursor,
      hasMore,
      scrollTop: screenCache.timeline?.scrollTop ?? 0,
    }
  }, [selectedTagNorm, cards, cursor, hasMore])

  useEffect(() => {
    return () => {
      if (screenCache.timeline === null) return
      const parent = scrollParentRef.current
      screenCache.timeline.scrollTop = parent !== null ? parent.scrollTop : window.scrollY
    }
  }, [])

  // ── 다음 페이지 ─────────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || cursor === null) return
    setLoadingMore(true)
    setMoreError(false)
    try {
      const page = await fetchRecordCardPage({ tagNorm: selectedTagNorm, cursor })
      setCards((prev) => [...prev, ...page.cards])
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch {
      setMoreError(true)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, cursor, selectedTagNorm])

  // §6 접근성: 무한 스크롤은 스크린리더가 끝을 알 수 없으므로 "더 보기" 버튼(sentinelRef)을
  // 항상 함께 둔다. IntersectionObserver는 그 버튼이 보이면 자동으로 같은 동작을 트리거한다.
  useEffect(() => {
    const target = sentinelRef.current
    if (target === null || !hasMore || online === false) return
    const root = scrollParentRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { root, rootMargin: '200px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, online, loadMore, cards.length])

  // ── 필터 전환 (F-14/F-15/F-18) ──────────────────────────────────────────
  function toggleTag(chip: Chip) {
    const params = new URLSearchParams(searchParams)
    if (selectedTagNorm === chip.tagNorm) {
      params.delete('tag')
    } else {
      params.set('tag', chip.tag)
    }
    setSearchParams(params)
    // AC-17: 필터가 걸릴 때 결과 건수를 즉시 안내한다. usage_count가 그 태그의 총 기록 수다.
    setAnnouncement(selectedTagNorm === chip.tagNorm ? '' : `${chip.tag} 태그 기록 ${chip.usageCount}건`)
  }

  function clearFilter() {
    const params = new URLSearchParams(searchParams)
    params.delete('tag')
    setSearchParams(params)
    setAnnouncement('')
  }

  // ── 파생 데이터 ─────────────────────────────────────────────────────────
  const stationNameById = useMemo(
    () => new Map((master?.stations ?? []).map((station) => [station.id, station.name])),
    [master],
  )

  const authorNameOf = useCallback(
    (authorId: string) => session.members.find((m) => m.userId === authorId)?.displayName ?? '알 수 없음',
    [session.members],
  )

  /** F-07: 카드 사이에 월 구분 헤더. 정렬이 이미 최신순이라 연속 구간만 잡으면 된다 */
  const monthOf = (visitedOn: string) => visitedOn.slice(0, 7)
  const monthLabel = (visitedOn: string) => {
    const [y, m] = visitedOn.split('-')
    return `${y}년 ${Number(m)}월`
  }

  const selectedChip = chips?.find((chip) => chip.tagNorm === selectedTagNorm) ?? null

  // 06이 삭제 후 돌아올 곳(AC-09). 태그 필터가 걸린 목록으로 진입했으면 그 필터까지 되살린다.
  const backTo = rawTag === null ? '/timeline' : `/timeline?tag=${encodeURIComponent(rawTag)}`

  // 최초 로딩 중(칩·목록 둘 다 아직 없음)인지 여부. 예전에는 이 상태를 별도의 `return`으로
  // 완전히 다른 트리(h1도, FAB도 없는 트리)로 그렸는데, 그러면 데이터가 도착하는 순간
  // 화면 최상단 구조 자체가 통째로 바뀌면서 탭 전환 직후 눈에 띄는 레이아웃 시프트가
  // 생겼다(하단 탭바 "타임라인" 진입 시 덜컹거림). h1·FAB처럼 로딩 여부와 무관한 뼈대는
  // 항상 같은 자리에 마운트해 두고, 그 사이(칩 행·목록)만 스켈레톤 ↔ 실제 콘텐츠로 바꾼다.
  const initialLoading = loadState === 'loading' && cards.length === 0

  return (
    <div className={styles.screen} ref={rootRef}>
      <h1 className={ui.title}>타임라인</h1>

      <p className="srOnly" role="status" aria-live="polite">
        {initialLoading ? '불러오는 중' : announcement}
      </p>

      {!initialLoading && !online && (
        <p className={ui.hint}>오프라인 — 마지막으로 불러온 목록을 보여드려요.</p>
      )}

      {initialLoading ? (
        <>
          <div className={styles.chipSkeleton} aria-hidden="true" />
          <div className={styles.cardSkeleton} aria-hidden="true" />
          <div className={styles.cardSkeleton} aria-hidden="true" />
          <div className={styles.cardSkeleton} aria-hidden="true" />
        </>
      ) : (
        <>
          {/* F-11~F-17: 태그가 하나도 없으면 칩 영역 자체를 그리지 않는다 */}
          {chips !== null && chips.length > 0 && (
            <div className={styles.chipRow} role="group" aria-label="태그 필터">
              {chips.map((chip) => (
                <button
                  key={chip.tagNorm}
                  type="button"
                  className={
                    selectedTagNorm === chip.tagNorm ? `${styles.chip} ${styles.chipOn}` : styles.chip
                  }
                  aria-pressed={selectedTagNorm === chip.tagNorm}
                  onClick={() => toggleTag(chip)}
                >
                  #{chip.tag} <span className={styles.chipCount}>{chip.usageCount}</span>
                </button>
              ))}
            </div>
          )}

          {loadState === 'failed' && (
            <div className={ui.centerBox}>
              <p>기록을 불러오지 못했어요.</p>
              <Button type="button" variant="default" onClick={() => void load(selectedTagNorm)}>
                다시 시도
              </Button>
            </div>
          )}

          {loadState === 'ready' && cards.length === 0 && selectedTagNorm === null && (
            <div className={ui.centerBox}>
              <p>아직 발자취가 없어요.</p>
              <Button asChild variant="default">
                <Link to="/records/new">첫 기록 남기기</Link>
              </Button>
            </div>
          )}

          {loadState === 'ready' && cards.length === 0 && selectedTagNorm !== null && (
            <div className={ui.centerBox}>
              <p>{selectedChip?.tag ?? rawTag} 태그의 기록이 없어요.</p>
              <Button type="button" variant="outline" onClick={clearFilter}>
                필터 해제
              </Button>
            </div>
          )}

          {cards.length > 0 && (
            <ul className={styles.list}>
              {cards.map((card, index) => {
                const showHeader =
                  index === 0 || monthOf(cards[index - 1]?.visitedOn ?? '') !== monthOf(card.visitedOn)
                return (
                  // `RecordCard`가 이미 자기 자신을 <li>로 그린다(04/08 공용 컴포넌트) — 월 헤더를
                  // 그 안에 감싸면 <li> 안에 <li>가 중첩되는 잘못된 HTML이 된다. Fragment로 형제로 둔다.
                  <Fragment key={card.id}>
                    {showHeader && (
                      <li className={styles.monthHeaderItem}>
                        <h2 className={styles.monthHeader}>{monthLabel(card.visitedOn)}</h2>
                      </li>
                    )}
                    <RecordCard
                      card={card}
                      authorName={authorNameOf(card.authorId)}
                      stationName={stationNameById.get(card.stationId) ?? '역 정보 없음'}
                      stationHref={`/stations/${card.stationId}`}
                      backTo={backTo}
                    />
                  </Fragment>
                )
              })}
            </ul>
          )}

          {hasMore && (
            <Button
              ref={sentinelRef}
              type="button"
              variant="outline"
              disabled={loadingMore || !online}
              onClick={() => void loadMore()}
            >
              {loadingMore ? '불러오는 중…' : '더 보기'}
            </Button>
          )}

          {moreError && (
            <p className={ui.error} role="alert">
              더 불러오지 못했어요 ·{' '}
              <button type="button" className={styles.retryLink} onClick={() => void loadMore()}>
                다시 시도
              </button>
            </p>
          )}
        </>
      )}

      {/* F-09: 역이 정해지지 않은 상태에서 기록을 시작하는 유일한 진입점.
          로딩 중에도 항상 같은 자리에 둔다 — 데이터가 도착할 때 갑자기 나타나는 요소를
          하나라도 줄이는 편이 체감 레이아웃 시프트를 줄인다. */}
      <button
        type="button"
        className={styles.fab}
        aria-label="새 기록 작성"
        onClick={() => navigate('/records/new')}
      >
        +
      </button>
    </div>
  )
}
