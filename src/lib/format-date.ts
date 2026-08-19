const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/**
 * `visited_on`(YYYY-MM-DD)을 "그날"의 로컬 날짜로 해석해 표시 문구를 만든다.
 *
 * 방문일은 타임존 변환 대상이 아니다(00 D-08) — `new Date(iso)`로 파싱하면 UTC로 읽혀
 * KST 자정 근처 날짜가 하루 밀릴 수 있어, 문자열을 직접 쪼개 로컬 `Date`를 만든다.
 *
 * `RecordDetailScreen`(06 F-01)과 `RecordCard`(04/08)가 같은 문구가 필요해져 공용으로 뺐다.
 */
export function formatVisitedOn(iso: string): { dateLabel: string; weekday: string } {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 0)
  return { dateLabel: `${y}년 ${m}월 ${d}일`, weekday: WEEKDAYS[date.getDay()] ?? '' }
}
