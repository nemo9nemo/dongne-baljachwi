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
 * F-08: 셀렉트박스 정렬 순서와 색상 토큰. color_token 은 색상값이 아니라 토큰 이름이다 —
 * 실제 색은 디자이너가 src/styles/tokens.css 에서 정한다.
 *
 * @param {string} lineName
 * @returns {{ sortOrder: number, colorToken: string }}
 */
export function lineDisplayMeta(lineName) {
  const m = lineName.match(/^([1-9])호선$/);
  if (m) return { sortOrder: Number(m[1]), colorToken: `line-${m[1]}` };
  // 노선명이 한글이라 이름에서 ASCII 토큰을 만들 수 없다. 토큰이 정해지지 않은 노선은
  // 공통 토큰으로 두고, 디자이너가 노선별 토큰을 정하면 이 함수에 표를 추가한다.
  // (그때까지 노선도는 기본색으로 그려진다 — 데이터가 비는 것보다 낫다.)
  return { sortOrder: NON_NUMBERED_BASE, colorToken: 'line-default' };
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
