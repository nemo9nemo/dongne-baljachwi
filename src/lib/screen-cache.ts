import type { CardCursor, RecordCard } from './record-card-query'

/**
 * 화면 생명주기 **밖**에서 사는 커플 범위 캐시들의 유일한 보관소이자 무효화 지점.
 *
 * 이 캐시들이 모듈 스코프에 있어야 하는 이유는 분명하다 — 노선도 ↔ 지도 전환 시 네트워크
 * 요청 0회(07 §4.1), 뒤로가기 복귀 시 목록·스크롤 유지(08 F-10 / 04 AC-12). 컴포넌트가
 * 실제로 언마운트되는 구조(데이터 라우터)라 state·ref로는 살릴 수 없다.
 *
 * 그런데 "생명주기 밖"은 **로그아웃·커플 해제·계정 전환에도 살아남는다**는 뜻이기도 하다.
 * 그래서 화면마다 흩어 두지 않고 여기 모아서
 *   (1) 캐시 전체에 소유 커플 id를 하나 달아 두고 ({@link scopeToCouple}),
 *   (2) 기록 저장·삭제 시의 무효화 규칙을 여기서만 정의한다.
 * 흩어 두면 화면이 캐시를 하나 더 만들 때마다 무효화 지점이 하나씩 빠진다 — 실제로
 * 그렇게 빠져서 로그아웃 후에도 이전 커플의 기록이 보이는 결함이 났다.
 *
 * 관련: 01 AC-12/AC-14/AC-15, 04 AC-07, 05 AC-18, 06 AC-09/AC-10, 08 AC-04/AC-14,
 * 09 AC-11/AC-19.
 *
 * 역 마스터(`station-master.ts`)는 여기 들어오지 않는다 — 전원 공개 데이터라 커플이
 * 바뀌어도 유효하고, 자체 버전 키로 이미 무효화된다.
 */

/** `couple_station_visits` 한 행 (03/04/07/09 공용) */
export type VisitRow = { station_id: string; visit_count: number; last_visited_on: string }

/** 목록 화면(08 타임라인 / 04 역 상세)이 POP 복귀 때 되살리는 값 */
export type ListCache = {
  cards: RecordCard[]
  cursor: CardCursor | null
  hasMore: boolean
  /** 스크롤 컨테이너의 scrollTop(px). 언마운트 시점에 채워진다 */
  scrollTop: number
}

type Store = {
  /** 이 캐시들이 누구 것인지. 현재 커플과 다르면 통째로 버린다 */
  coupleId: string | null
  visits: VisitRow[] | null
  timeline: (ListCache & { tagNorm: string | null }) | null
  station: (ListCache & { stationId: string }) | null
}

export const screenCache: Store = {
  coupleId: null,
  visits: null,
  timeline: null,
  station: null,
}

/**
 * 캐시 소유자를 현재 커플로 맞춘다. 달라졌으면(다른 계정 로그인, 커플 해제 후 재결합)
 * 전부 버린다.
 *
 * **읽기 직전에 부른다.** SessionProvider가 커플 변화를 감지해 부르기도 하지만, 부모의
 * effect는 자식이 마운트하며 캐시를 읽은 **뒤에** 돌기 때문에 그것만 믿으면 한 프레임짜리
 * 유출 창이 남는다. 비교 한 번이라 렌더 경로에서 불러도 비용이 없다.
 *
 * @param coupleId 현재 세션의 커플 id. 커플이 없으면 null
 */
export function scopeToCouple(coupleId: string | null): void {
  if (screenCache.coupleId === coupleId) return
  screenCache.coupleId = coupleId
  screenCache.visits = null
  screenCache.timeline = null
  screenCache.station = null
}

/** 기록 저장(신규·수정) 후. 목록 순서·본문·방문 집계가 한꺼번에 낡는다 */
export function invalidateRecordCaches(): void {
  screenCache.visits = null
  screenCache.timeline = null
  screenCache.station = null
}

/**
 * 기록 1건 삭제 후.
 *
 * 목록을 통째로 버리지 않고 해당 카드만 빼는 이유: 08 AC-14가 "카드가 사라져 있고
 * **스크롤 위치는 유지**"를 동시에 요구한다. 버리면 복귀 시 1페이지부터 다시 받아
 * 스크롤이 맨 위로 튄다. 키셋 커서는 마지막 행 기준이라 중간 한 건이 빠져도 그대로
 * 유효해서 다음 페이지에 중복·누락이 생기지 않는다.
 *
 * 방문 집계는 부분 갱신이 불가능하다(그 역의 카운트가 줄고, 0이 되면 행 자체가 사라진다).
 * 통째로 버려서 다음 진입이 다시 받게 한다 — 06 AC-10 "빈 원으로 돌아간다".
 */
export function dropRecordFromCaches(recordId: string): void {
  screenCache.visits = null
  const { timeline, station } = screenCache
  if (timeline !== null) {
    screenCache.timeline = { ...timeline, cards: timeline.cards.filter((c) => c.id !== recordId) }
  }
  if (station !== null) {
    screenCache.station = { ...station, cards: station.cards.filter((c) => c.id !== recordId) }
  }
}

/**
 * 목록의 스크롤을 담당하는 실제 컨테이너를 찾는다. 모바일은 window, 데스크톱은 `.frame`이
 * 스크롤한다(`styles/app-frame.module.css`) — 하드코딩된 셀렉터 대신 계산한다.
 *
 * {@link ListCache}의 `scrollTop`을 읽고 쓰는 대상이라 캐시와 같은 자리에 둔다.
 * 08·04 두 화면이 같은 계산을 해야 한다.
 *
 * @returns 스크롤 컨테이너. 없으면 null(= window가 스크롤한다는 뜻)
 */
export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node !== null) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}
