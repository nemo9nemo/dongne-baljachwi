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

/**
 * 오늘 날짜(로컬, `YYYY-MM-DD`). `toLocaleDateString('sv-SE')`는 스웨덴 로캘이 ISO 8601과
 * 같은 자리수 형식을 쓰는 걸 이용한 트릭이다 — 별도 포맷팅 없이 로컬 타임존 기준으로 떨어진다.
 *
 * `RecordEditorScreen`(05, 미래 날짜 차단)과 `OnboardingScreen`(01, 사귄 날 상한)이 각자
 * 다른 방식(수동 조립 / 같은 트릭)으로 구현해 두고 있던 걸 공용으로 합쳤다. `ProfileScreen`
 * (09, 디데이·추천 시드)이 세 번째 사용처다.
 */
export function todayLocal(): string {
  return new Date().toLocaleDateString('sv-SE')
}
