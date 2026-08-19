import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { loadStationLines } from '../../lib/station-master'
import { fetchRecordCardPage } from '../../lib/record-card-query'
import type { CardCursor, RecordCard as RecordCardData } from '../../lib/record-card-query'
import { RecordCard } from '../../components/RecordCard'
import { useSession } from '../../auth/session-context'
import { useLineMapData } from '../lines/line-map-data'
import { formatVisitedOn } from '../../lib/format-date'
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
 * 역명을 카드에 안 보여주는 것뿐이다.
 *
 * 이번 라운드에 없는 것:
 * - F-13(Could): 호선 배지 탭 → 노선도로 돌아가 필터. "없어도 흐름이 끊기지 않는" 항목이라 스킵.
 * - 스크롤 위치 보존(AC-12): 08과 달리 POP 복귀 캐시를 아직 붙이지 않았다. 필요성이
 *   확인되면 타임라인의 `restoreCache` 패턴을 그대로 옮겨온다.
 */

type VisitSummary = { visitCount: number; lastVisitedOn: string } | null
type SummaryState = 'loading' | 'ready' | 'failed'
type ListState = 'loading' | 'ready' | 'failed'

export function StationDetailScreen() {
  const { stationId } = useParams()
  const navigate = useNavigate()
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

  const sentinelRef = useRef<HTMLButtonElement>(null)

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
  useEffect(() => {
    void loadList()
  }, [loadList])

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
    if (target === null || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { rootMargin: '200px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

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
    const lineById = new Map(master.master.lines.map((line) => [line.id, line]))
    const result: { code: string; name: string; colorToken: string }[] = []
    for (const link of lineLinks) {
      if (link.station_id !== stationId) continue
      const line = lineById.get(link.line_id)
      if (line === undefined || !line.is_active) continue
      if (!result.some((item) => item.name === line.name)) {
        result.push({ code: line.code, name: line.name, colorToken: line.color_token })
      }
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
        <Link to="/lines" className={`${ui.button} ${ui.buttonPrimary}`}>
          노선도로 가기
        </Link>
      </div>
    )
  }

  if (station === null) {
    return (
      <div className={ui.centerBox}>
        {/* F-02.2: 존재하지 않는 역 ID. is_active=false는 여기 해당하지 않는다 — 마스터에
            있으면(폐역이어도) 정상 표시한다. */}
        <p>존재하지 않는 역입니다.</p>
        <Link to="/lines" className={`${ui.button} ${ui.buttonPrimary}`}>
          노선도로 돌아가기
        </Link>
      </div>
    )
  }

  const showEmptyState = listState === 'ready' && cards.length === 0

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.stationName}>{station.name}</h1>
        {badges.length > 0 && (
          <div className={styles.badges}>
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
          </div>
        )}
        {/* §5 "부분 성공": 방문 요약만 실패하면 총 횟수 표시를 생략한다(틀린 숫자를 보여주지 않는다) */}
        {summaryState === 'ready' && summary !== null && summary.visitCount > 0 && (
          <p className={styles.visitSummary}>
            총 {summary.visitCount}회 · 마지막 방문 {formatVisitedOn(summary.lastVisitedOn).dateLabel}
          </p>
        )}
      </header>

      {listState === 'failed' && (
        <div className={ui.centerBox}>
          <p>기록을 불러오지 못했어요.</p>
          <button type="button" className={`${ui.button} ${ui.buttonPrimary}`} onClick={() => void loadList()}>
            다시 시도
          </button>
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
          <Link to={`/records/new?stationId=${station.id}`} className={`${ui.button} ${ui.buttonPrimary}`}>
            첫 기록 남기기
          </Link>
        </div>
      )}

      {cards.length > 0 && (
        <ul className={styles.list}>
          {cards.map((card) => (
            <RecordCard key={card.id} card={card} authorName={authorNameOf(card.authorId)} />
          ))}
        </ul>
      )}

      {hasMore && (
        <button
          ref={sentinelRef}
          type="button"
          className={ui.button}
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? '불러오는 중…' : '더 보기'}
        </button>
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
          <button
            type="button"
            className={`${ui.button} ${ui.buttonPrimary}`}
            onClick={() => navigate(`/records/new?stationId=${station.id}`)}
          >
            이 역에 기록 추가
          </button>
        </div>
      )}
    </div>
  )
}
