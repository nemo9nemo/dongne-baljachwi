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
 * 오늘 날짜(**한국 시각 기준**, `YYYY-MM-DD`).
 *
 * 브라우저 로컬 타임존이 아니라 `Asia/Seoul` 고정이다. 이 값이 쓰이는 세 곳이 전부 "한국의
 * 오늘"을 의미하기 때문이다 — 05의 미래 날짜 차단(방문일은 타임존 변환 대상이 아니다,
 * 00 D-08), 01의 사귄 날 상한, 09의 디데이·추천 시드(F-17 "시드 = couple_id + 오늘(KST)").
 * 로컬 기준이면 해외에서 접속한 두 사람의 디데이·추천이 서로 달라지고, 같은 사람이 비행기를
 * 타는 것만으로 어제 쓴 기록이 "미래 날짜"가 된다.
 *
 * 포맷터를 모듈 스코프에 한 번만 만든다 — `Intl.DateTimeFormat` 생성은 로캘 데이터 조회라
 * 호출마다 만들면 비싸다. 'sv-SE' 로캘은 ISO 8601과 같은 `YYYY-MM-DD`로 떨어진다.
 */
const KST_DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function todayKst(): string {
  return KST_DATE.format(new Date())
}
