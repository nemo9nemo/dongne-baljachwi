/**
 * 노선 표시·범위 정책 (docs/specs/02-station-master.md F-08, F-10).
 *
 * 노선의 정렬 순서·색상 토큰·MVP 범위를 **데이터가** 정하게 하려면 누군가는 그 값을
 * 계산해야 한다. 그 책임이 여기다. 프론트에는 어떤 순서도 하드코딩하지 않는다.
 */

/**
 * F-10: MVP(수도권) 판정 기준 시도 코드. 서울(11) / 인천(28) / 경기(41).
 *
 * ⚠ 같은 목록이 `supabase/migrations/20260825100000_station_mvp_scope.sql` 의
 * `apply_station_master()` 함수 안에도 SQL 리터럴로 한 번 더 있다(stations.in_mvp_scope
 * 컬럼 계산용, 02 §9 "MVP 범위의 정확한 경계"). 이 목록(노선 단위 OR 집계)과 그 SQL
 * (역 단위 직접 판정)은 판정 대상 granularity 가 달라 함수 하나로 합칠 수 없다 — 정책
 * 자체(어느 시/도가 MVP 인지)가 바뀌면 **두 곳 다** 고쳐야 한다.
 */
const MVP_REGIONS = new Set(['11', '28', '41']);

/** 숫자 호선이 아닌 노선의 시작 순번. 1~9호선 뒤에 광역/민자가 붙는다. */
const NON_NUMBERED_BASE = 100;

/** @typedef {import('./types.mjs').MasterSnapshot} MasterSnapshot */

/**
 * F-08: 노선명 → 색상 토큰 표 (2026-08-31 확정).
 *
 * 왜 정규식이 아니라 표인가: 원천(전국도시철도역사정보표준데이터)의 노선명은 정식 명칭이라
 * `^([1-9])호선$` 같은 패턴으로 일반화되지 않는다. 실제로 "서울 도시철도 9호선"은 9호선인데
 * 패턴에 걸리지 않았고, "인천지하철 1호선"은 패턴에 걸리면 안 되는데 이름만 보면 걸릴 것처럼
 * 생겼다. 이름 하나하나를 명시하는 표만이 두 경우를 동시에 맞힌다.
 * (기존 정규식은 MVP 33개 노선 중 25개를 line-default 로 떨어뜨려 노선도가 거의 회색이었다.)
 *
 * 값은 색상이 아니라 **토큰 이름**이다. 실제 색은 src/styles/tokens.css 가 소유한다 (02 §4.1)
 * — 여기 이름과 tokens.css 의 CSS 변수명(`--line-*`)이 1:1로 맞아야 화면에 색이 나온다.
 * 색상 근거는 위키백과 "틀:한국 철도 노선색"(국가철도공단·서울교통공사 CI 매뉴얼 기반).
 *
 * 노선명 철자는 2026-08-31 실 DB(lines.name) 조회로 대조 확인했다. 이름이 한 글자라도
 * 다르면 그 노선만 조용히 line-default 로 떨어진다 — 원천 파일이 갱신되면 재대조가 필요하다.
 *
 * @type {Readonly<Record<string, string>>}
 */
const LINE_COLOR_TOKENS = Object.freeze({
  // ── 번호 호선 + 그 연장 구간 ────────────────────────────────────────────
  // 연장 구간은 원천에서 별도 노선명으로 오지만 승객에게는 같은 노선이라 같은 색을 쓴다.
  '1호선': 'line-1',
  '경원선': 'line-1',            // 1호선 의정부~소요산 연장
  '경인선': 'line-1',            // 1호선 구로~인천 연장
  '2호선': 'line-2',
  '3호선': 'line-3',
  '일산선': 'line-3',            // 3호선 대화~지축 연장
  '4호선': 'line-4',
  '안산과천선': 'line-4',        // 4호선 연장
  '진접선': 'line-4',            // 4호선 연장
  '5호선': 'line-5',
  '6호선': 'line-6',
  '7호선': 'line-7',
  '8호선': 'line-8',
  // 이름은 헷갈리지만 소속 역(별내·다산)으로 확인한 결과 별내선 = 8호선 연장이다.
  '수도권 광역철도 8호선': 'line-8',
  // 9호선의 정식 명칭. 접두사 때문에 옛 정규식이 놓쳤던 바로 그 노선이다.
  '서울 도시철도 9호선': 'line-9',

  // ── 광역·민자·경전철 ───────────────────────────────────────────────────
  '경강선': 'line-gyeonggang',
  '경의중앙선': 'line-gyeongui',
  '경춘선': 'line-gyeongchun',
  '김포도시철도': 'line-gimpo',
  '분당선': 'line-bundang',
  '수인선': 'line-bundang',      // 수인분당선으로 통합 운영 — 분당선과 같은 색
  '서해선': 'line-seohae',
  '수도권 경량도시철도 신림선': 'line-sillim',
  '신분당선': 'line-sinbundang',
  '에버라인': 'line-everline',
  '우이신설선': 'line-uisinseol',
  '의정부': 'line-uijeongbu',
  '인천국제공항선': 'line-airport',
  // 서울 1·2호선과 이름만 비슷할 뿐 별개 노선이라 토큰도 분리한다.
  '인천지하철 1호선': 'line-incheon1',
  '인천지하철 2호선': 'line-incheon2',
  '자기부상철도': 'line-maglev',
});

/**
 * F-08: 셀렉트박스 정렬 순서와 색상 토큰. color_token 은 색상값이 아니라 토큰 이름이다 —
 * 실제 색은 디자이너가 src/styles/tokens.css 에서 정한다.
 *
 * 표에 없는 노선(MVP 밖 지방 노선, 앞으로 개통할 신규 노선)은 line-default 로 떨어진다.
 * 색이 없는 것보다 회색으로라도 그려지는 편이 낫다 — 적재가 멈출 이유는 아니다.
 *
 * @param {string} lineName
 * @returns {{ sortOrder: number, colorToken: string }}
 */
export function lineDisplayMeta(lineName) {
  // 정렬은 색과 별개 축이다. "N호선"이라는 이름 그대로인 노선만 1~9번 자리를 차지하고,
  // 연장 구간·광역 노선은 색을 얻더라도 순서는 그대로 뒤쪽(NON_NUMBERED_BASE)에 둔다.
  // 여기서 순서까지 바꾸면 셀렉트박스 순서(프론트가 이미 소비 중인 계약)가 흔들린다.
  const numbered = lineName.match(/^([1-9])호선$/);
  const sortOrder = numbered ? Number(numbered[1]) : NON_NUMBERED_BASE;
  // hasOwn 으로 확인한다. 노선명은 외부 파일에서 온 문자열이라 'constructor' 같은 값이
  // 들어오면 프로토타입 체인의 함수가 토큰으로 잡힐 수 있다.
  const colorToken = Object.hasOwn(LINE_COLOR_TOKENS, lineName)
    ? LINE_COLOR_TOKENS[lineName]
    : 'line-default';
  return { sortOrder, colorToken };
}

/**
 * 숫자 호선이 아닌 노선끼리는 이름순으로 100, 101, 102 ... 를 부여한다.
 * 같은 sort_order 가 여러 개면 셀렉트박스 순서가 실행마다 흔들려 멱등성(AC-02)이 깨진다.
 *
 * @param {MasterSnapshot} snapshot
 */
export function applyLineOrdering(snapshot) {
  const rest = snapshot.lines
    .filter((l) => l.sort_order === NON_NUMBERED_BASE)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  rest.forEach((l, i) => { l.sort_order = NON_NUMBERED_BASE + i; });
}

/**
 * F-10: 노선이 수도권 역을 하나라도 포함하면 MVP 범위로 본다.
 * 노선 자체에는 지역 정보가 없어 소속 역의 region_code 에서 파생할 수밖에 없다.
 *
 * @param {MasterSnapshot} snapshot
 */
export function applyMvpScope(snapshot) {
  const regionByStation = new Map(snapshot.stations.map((s) => [s.code, s.region_code]));
  /** @type {Set<string>} */
  const inScope = new Set();
  for (const sl of snapshot.station_lines) {
    const region = regionByStation.get(sl.station_code);
    if (region !== undefined && MVP_REGIONS.has(region)) inScope.add(sl.line_code);
  }
  for (const l of snapshot.lines) l.in_mvp_scope = inScope.has(l.code);
}
