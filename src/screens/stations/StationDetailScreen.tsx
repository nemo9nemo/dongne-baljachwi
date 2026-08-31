import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { loadStationLines } from '../../lib/station-master'
import { fetchRecordCardPage } from '../../lib/record-card-query'
import type { CardCursor, RecordCard as RecordCardData } from '../../lib/record-card-query'
import { readStateFlag } from '../../lib/router-state'
import { findScrollParent, screenCache, scopeToCouple } from '../../lib/screen-cache'
import { RecordCard } from '../../components/RecordCard'
import { useSession } from '../../auth/session-context'
import { useLineMapData } from '../lines/line-map-data'
import { formatVisitedOn } from '../../lib/format-date'
import { Button } from '@/components/ui/button'
import styles from './station-detail.module.css'
import ui from '../../styles/ui.module.css'

/**
 * 역 상세 (`docs/specs/04-station-detail.md`).
 *
 * 기록 작성의 주 진입점이다 — "노선도에서 역을 누른다 → 기록 추가를 누른다"가 PRD §2의
 * 기본 흐름이다. 마스터·소속 호선은 노선도(03)/지도(07)와 `useLineMapData()`를 공유해서
 * 노선도에서 역을 탭해 들어오면 헤더가 네트워크 대기 없이 즉시 뜬다(§6 "첫 픽셀").
 *
 * 기록 목록은 08(타임라인)과 완전히 같은 `RecordCard`/`fetchRecordCardPage`를 쓴다
 * (`record-card-query.ts`가 애초에 두 화면 공용으로 설계됐다) — 차이는 `stationId` 필터와
 * 역명을 카드에 안 보여주는 것뿐이다. POP 복귀 시의 목록·스크롤 보존(AC-12)도 08과 같은
 * `lib/screen-cache.ts`를 쓴다.
 */

/** §2.4 오프라인 행: 작성 화면에서 저장이 실패할 게 뻔하므로 진입 자체를 막는다 */
const OFFLINE_ADD_REASON = '오프라인이라 기록을 추가할 수 없어요.'

type VisitSummary = { visitCount: number; lastVisitedOn: string } | null
type SummaryState = 'loading' | 'ready' | 'failed'
type ListState = 'loading' | 'ready' | 'failed'

export function StationDetailScreen() {
  const { stationId } = useParams()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const location = useLocation()
  const session = useSession()
  const { master } = useLineMapData()

  const [lineLinks, setLineLinks] = useState<{ station_id: string; line_id: string }[]>([])
  const [summaryState, setSummaryState] = useState<SummaryState>('loading')
  const [summary, setSummary] = useState<VisitSummary>(null)

  const [cards, setCards] = useState<RecordCardData[]>([])
  const [cursor, setCursor] = useState<CardCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [listState, setListState] = useState<ListState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLButtonElement>(null)
  const scrollParentRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (master.kind !== 'ready') return
    void loadStationLines(master.master.version).then(setLineLinks, () => setLineLinks([]))
  }, [master])

  const loadSummary = useCallback(() => {
    if (stationId === undefined) return
    setSummaryState('loading')
    // `.maybeSingle()`이 아니라 일반 조회 + 첫 행을 쓴다. 미방문 역(0행)에서 `.maybeSingle()`은
    // PostgREST가 406으로 응답한 뒤 supabase-js가 그걸 null로 눕혀주는 방식이라, 정상 상황인데도
    // 매번 네트워크 탭에 에러가 찍힌다. 여긴 PK가 아니라 단일 필터라 결과가 0~1행임을
    // 애플리케이션이 이미 알고 있으므로 굳이 그 경로를 쓸 이유가 없다.
    void supabase
      .from('couple_station_visits')
      .select('visit_count, last_visited_on')
      .eq('station_id', stationId)
      .then(({ data, error }) => {
        if (error !== null) {
          setSummaryState('failed')
          return
        }
        const row = data[0]
        setSummary(row === undefined ? { visitCount: 0, lastVisitedOn: '' } : { visitCount: row.visit_count, lastVisitedOn: row.last_visited_on })
        setSummaryState('ready')
      })
  }, [stationId])

  const loadList = useCallback(async () => {
    if (stationId === undefined) return
    setListState('loading')
    setMoreError(false)
    try {
      const page = await fetchRecordCardPage({ stationId })
      setCards(page.cards)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setListState('ready')
    } catch {
      setListState('failed')
    }
  }, [stationId])

  useEffect(loadSummary, [loadSummary])

  const coupleId = session.couple?.id ?? null
  useEffect(() => {
    // 캐시는 화면 밖에 산다 — 읽기 전에 소유 커플을 맞춘다 (01 AC-15).
    scopeToCouple(coupleId)
    // AC-12: POP(뒤로가기)이고 같은 역의 캐시가 있으면 재조회 없이 목록·스크롤을 되살린다.
    // 08과 같은 규칙이다. `navigationType`을 의존성에 넣지 않는 이유도 같다 — 마운트마다
    // 한 번만 의미가 있고, 넣으면 "역만 바뀐" 재실행에서 오래된 POP 판정이 다시 걸린다.
    // `restoreList`: 06이 삭제 후 `replace`로 돌려보낸 경우. POP은 아니지만 캐시는 방금
    // 그 카드를 뺀 최신 상태다 (AC-07 + AC-12를 동시에 만족시킨다).
    const restoreAllowed = navigationType === 'POP' || readStateFlag(location.state, 'restoreList')
    const cached = screenCache.station
    if (restoreAllowed && cached !== null && cached.stationId === stationId) {
      setCards(cached.cards)
      setCursor(cached.cursor)
      setHasMore(cached.hasMore)
      setListState('ready')
      const savedTop = cached.scrollTop
      // 목록이 그려진 뒤에야 스크롤 컨테이너가 그만큼 커진다.
      requestAnimationFrame(() => {
        const parent = scrollParentRef.current
        if (parent !== null) parent.scrollTop = savedTop
        else window.scrollTo(0, savedTop)
      })
      return
    }
    void loadList()
  }, [loadList, stationId, coupleId])

  useEffect(() => {
    scrollParentRef.current = findScrollParent(rootRef.current)
  }, [])

  // 상태가 바뀔 때마다 캐시를 최신으로 유지한다. 실제 스크롤 위치는 언마운트 시점에 채운다.
  useEffect(() => {
    if (stationId === undefined) return
    screenCache.station = {
      stationId,
      cards,
      cursor,
      hasMore,
      scrollTop: screenCache.station?.scrollTop ?? 0,
    }
  }, [stationId, cards, cursor, hasMore])

  useEffect(() => {
    return () => {
      if (screenCache.station === null) return
      const parent = scrollParentRef.current
      screenCache.station.scrollTop = parent !== null ? parent.scrollTop : window.scrollY
    }
  }, [])

  // §2.4 / §5 오프라인: 목록은 못 받고 기록 추가도 막는다(작성 화면에서 저장 실패가 뻔하다).
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || cursor === null || stationId === undefined) return
    setLoadingMore(true)
    setMoreError(false)
    try {
      const page = await fetchRecordCardPage({ stationId, cursor })
      setCards((prev) => [...prev, ...page.cards])
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch {
      setMoreError(true)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, cursor, stationId])

  useEffect(() => {
    const target = sentinelRef.current
    // 오프라인이면 관찰 자체를 걸지 않는다 — 실패가 뻔한 요청을 스크롤할 때마다 반복한다.
    if (target === null || !hasMore || !online) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { root: scrollParentRef.current, rootMargin: '200px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, online, loadMore])

  const authorNameOf = useCallback(
    (authorId: string) => session.members.find((m) => m.userId === authorId)?.displayName ?? '알 수 없음',
    [session.members],
  )

  const station = useMemo(() => {
    if (master.kind !== 'ready' || stationId === undefined) return null
    return master.master.stations.find((s) => s.id === stationId) ?? null
  }, [master, stationId])

  const badges = useMemo(() => {
    if (master.kind !== 'ready' || stationId === undefined) return []
    const lines = master.master.lines
    const lineById = new Map(lines.map((line) => [line.id, line]))
    const result: { code: string; name: string; colorToken: string; filterId: string }[] = []
    for (const link of lineLinks) {
      if (link.station_id !== stationId) continue
      const line = lineById.get(link.line_id)
      if (line === undefined || !line.is_active) continue
      if (result.some((item) => item.name === line.name)) continue
      // F-13: 노선도의 호선 필터 값은 **이름이 같은 노선 그룹의 최소 code**다
      // (2호선 본선·성수지선·신정지선이 셀렉트박스에서 한 항목이다 — LineMapScreen
      // `buildLineOptions`와 같은 규칙). 여기서 같은 값을 만들어야 링크가 맞는 항목을 연다.
      const filterId = lines
        .filter((item) => item.name === line.name)
        .reduce((min, item) => (item.code < min ? item.code : min), line.code)
      result.push({ code: line.code, name: line.name, colorToken: line.color_token, filterId })
    }
    return result
  }, [master, lineLinks, stationId])

  if (master.kind === 'loading') {
    return (
      <div className={styles.screen}>
        <div className={styles.headerSkeleton} aria-hidden="true" />
        <div className={styles.cardSkeleton} aria-hidden="true" />
        <div className={styles.cardSkeleton} aria-hidden="true" />
        <p className="srOnly" role="status">
          불러오는 중
        </p>
      </div>
    )
  }

  if (master.kind === 'failed') {
    return (
      <div className={ui.centerBox}>
        <p>역 정보를 불러오지 못했어요.</p>
        <Button asChild variant="default">
          <Link to="/lines">노선도로 가기</Link>
        </Button>
      </div>
    )
  }

  if (station === null) {
    return (
      <div className={ui.centerBox}>
        {/* F-02.2: 존재하지 않는 역 ID. is_active=false는 여기 해당하지 않는다 — 마스터에
            있으면(폐역이어도) 정상 표시한다. */}
        <p>존재하지 않는 역입니다.</p>
        <Button asChild variant="default">
          <Link to="/lines">노선도로 돌아가기</Link>
        </Button>
      </div>
    )
  }

  const showEmptyState = listState === 'ready' && cards.length === 0

  return (
    <div className={styles.screen} ref={rootRef}>
      <header className={styles.header}>
        <h1 className={styles.stationName}>{station.name}</h1>
        {/* §9(2026-08-25): 노선도에 없는 역이 기록으로만 나타나면 "왜 노선도엔 없지?"라는
            의문이 남는다. 경고 톤 없이 텍스트 배지 하나로만 알린다 — 폐역이어도 그 기록의
            가치는 달라지지 않는다. */}
        {!station.is_active && (
          <div className={styles.badges}>
            <span className={styles.badge}>폐역</span>
          </div>
        )}
        {badges.length > 0 && (
          <div className={styles.badges}>
            {badges.map((badge) => (
              // F-13: 누르면 노선도가 그 호선으로 필터된 상태로 열린다.
              <button
                key={badge.code}
                type="button"
                className={`${styles.badge} ${styles.badgeButton}`}
                onClick={() => navigate(`/lines?line=${encodeURIComponent(badge.filterId)}`)}
              >
                <span
                  className={styles.badgeDot}
                  style={{ background: `var(--${badge.colorToken}, var(--line-default))` }}
                  aria-hidden="true"
                />
                {badge.name}
                <span className="srOnly"> 노선도에서 보기</span>
              </button>
            ))}
          </div>
        )}
        {/* §5 "부분 성공": 방문 요약만 실패하면 총 횟수 표시를 생략한다(틀린 숫자를 보여주지 않는다) */}
        {summaryState === 'ready' && summary !== null && summary.visitCount > 0 && (
          <p className={styles.visitSummary}>
            총 {summary.visitCount}회 · 마지막 방문 {formatVisitedOn(summary.lastVisitedOn).dateLabel}
          </p>
        )}
      </header>

      {!online && cards.length > 0 && (
        <p className={ui.hint}>오프라인 — 마지막으로 불러온 목록을 보여드려요.</p>
      )}

      {listState === 'failed' && (
        <div className={ui.centerBox}>
          <p>기록을 불러오지 못했어요.</p>
          <Button type="button" variant="default" onClick={() => void loadList()}>
            다시 시도
          </Button>
        </div>
      )}

      {listState === 'loading' && (
        <>
          <div className={styles.cardSkeleton} aria-hidden="true" />
          <div className={styles.cardSkeleton} aria-hidden="true" />
        </>
      )}

      {showEmptyState && (
        <div className={ui.centerBox}>
          <p>아직 이 역에는 발자취가 없어요.</p>
          {online ? (
            <Button asChild variant="default">
              <Link to={`/records/new?stationId=${station.id}`}>첫 기록 남기기</Link>
            </Button>
          ) : (
            <Button type="button" variant="default" disabled title={OFFLINE_ADD_REASON}>
              첫 기록 남기기
            </Button>
          )}
        </div>
      )}

      {cards.length > 0 && (
        <ul className={styles.list}>
          {cards.map((card) => (
            <RecordCard
              key={card.id}
              card={card}
              authorName={authorNameOf(card.authorId)}
              stationName={station.name}
              backTo={`/stations/${station.id}`}
            />
          ))}
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

      {/* F-07: 빈 상태에서는 하단 고정 버튼과 중복되므로 숨긴다 */}
      {!showEmptyState && (
        <div className={styles.addBar}>
          {/* §5 오프라인: 사유를 툴팁(title)과 함께 보이는 문구로 둘 다 남긴다 —
              툴팁만 두면 터치 기기에서 사유를 알 방법이 없다. */}
          {!online && <p className={ui.hint}>{OFFLINE_ADD_REASON}</p>}
          <Button
            type="button"
            variant="default"
            disabled={!online}
            title={online ? undefined : OFFLINE_ADD_REASON}
            onClick={() => navigate(`/records/new?stationId=${station.id}`)}
          >
            이 역에 기록 추가
          </Button>
        </div>
      )}
    </div>
  )
}
