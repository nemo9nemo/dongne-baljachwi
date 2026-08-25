/**
 * 원천 데이터의 "알려진 오류" 정정 목록 (docs/specs/02-station-master.md §9, 2026-08-24 발견).
 *
 * 전국도시철도역사정보표준데이터는 data.go.kr 파일 다운로드라 저장소에 원본을 체크인하지
 * 않는다(연 1회 갱신, 매번 새로 받는다). 그래서 원본 파일 자체의 오기재는 우리가 고칠 수
 * 없고, 재적재(`npm run stations:load`)할 때마다 같은 오류가 그대로 되살아난다. 이 파일은
 * `fetch → 정규화` 사이에서 딱 한 번 거치는 "알려진 오류 목록"이다 — TAGO 로 원천을 바꾸는
 * 날이 와도(현재는 폐기 상태) 같은 물리 역이면 같은 교정이 적용되도록 파이프라인 공통
 * 지점(load-station-master.mjs)에 둔다. 어댑터별(sources/*.mjs) 파싱 로직에 흩어놓지 않는다.
 *
 * 이 목록은 **그룹핑 규칙(F-02~F-06)의 예외가 아니다** — station_merge_overrides 와 달리
 * "어느 행이 같은 역인가"를 바꾸지 않고, 개별 행의 좌표값 자체를 실측치로 덮어쓸 뿐이다.
 * 그래서 DB 테이블이 아니라 배치 코드에 둔다(운영자만 손대는 값이고, 항목이 늘어도 많아야
 * 수십 건 규모라 테이블화할 만큼의 빈도가 아니다).
 *
 * 새 항목을 추가할 때 반드시 남길 것: (1) 원본 파일에서 확인한 잘못된 원값, (2) 정정값의
 * 실측 근거(어떻게 확인했는지), (3) 발견 경위.
 */

/**
 * 키: `${lineCode}:${stationNo}` (SourceRow.lineCode, stationNo 원문 그대로 — 정규화 전).
 * 표준데이터의 station_no("역번호")는 노선 안에서만 유일하므로, 노선코드로 네임스페이스해야
 * 서로 다른 노선의 동일 역번호가 충돌하지 않는다(F-06 buildStationCode 와 같은 이유).
 *
 * `lat`/`lng`/`regionCode` 는 모두 선택 필드다 — 원천 행이 잘못 들고 있는 필드만 지정하면
 * 나머지는 원문 그대로 통과한다(아래 `applyKnownCorrections` 참고).
 *
 * @type {Record<string, { lat?: number, lng?: number, regionCode?: string, reason: string }>}
 */
const KNOWN_SOURCE_CORRECTIONS = {
  // 양원역(경의중앙선, 역번호 1204). 원본 표준데이터
  // (data.go.kr/15013205, `전체_도시철도역사정보_20260630.xlsx`, 데이터기준일자 2025-04-08)
  // 이 행의 역위도/역경도를 (36.963729, 129.091321)로 잘못 기재하고 있다 —
  // 경상북도 포항/영덕 인근 좌표다. 같은 행의 도로명주소는 "서울시 중랑구 송림길
  // 147(망우동)"로 정상이라 위경도 컬럼만 다른 지역 값이 잘못 들어간 것으로 보인다.
  // 원본 파일을 직접 열어 확인했다(2026-08-25) — 파싱/그룹핑 배치의 버그가 아니다.
  //
  // 정정값 출처: OpenStreetMap Nominatim 실측(2026-08-25, "양원역" railway=station 노드,
  // 서울 중랑구 망우동 — 인근 bus_stop 노드도 같은 위치를 가리켜 상호 검증됨). 인접역
  // (경의중앙선 seq 6 망우역 37.599288,127.092318 / seq 8 구리역 37.60326,127.143373) 사이
  // 경로 상에 자연스럽게 들어맞는 것도 함께 확인했다. 소수점 6자리로 반올림해 이
  // 데이터셋의 다른 좌표 정밀도에 맞췄다.
  'L-I4108:1204': {
    lat: 37.606582,
    lng: 127.107935,
    reason: '양원역(경의중앙선 1204) 원본 좌표가 경북 포항 인근을 가리킴 — OSM 실측으로 정정 (02 §9, 2026-08-24 발견)',
  },
  // 동구릉역·장자호수공원역(별내선/8호선 연장, 역번호 806/808). 원본 표준데이터의
  // 도로명주소가 "인창동 679-8 일원"처럼 시/도명이 맨 앞에 없는 형태라
  // normalize.mjs 의 regionCodeFromAddress() 가 지역을 못 뽑아 region_code='00'(needs_review)
  // 로 적재되고 있었다 — 좌표 자체는 정확하다(양원역과 달리 원본 데이터 오류가 아니라
  // 이 배치의 주소 파싱 한계). 실제 위치를 좌표로 실측 검증해 정정한다.
  //
  // 정정 근거(2026-08-25, MVP 범위 정정 작업 중 발견): 동구릉역 좌표(37.610556, 127.135056)는
  // 경기도 구리시 인창동의 세계유산 "동구릉" 소재지와 일치, 장자호수공원역 좌표
  // (37.587222, 127.13793)는 경기도 남양주시 다산동 소재 공원과 일치 — 둘 다 경기도(41).
  // region_code 를 못 뽑은 나머지 ~86건(양원역 마이그레이션 §9에 "알려진 한계"로 기록됨)은
  // 이번 조사 범위 밖이라 그대로 둔다 — 이 2건만 MVP 범위 정정(02 §9) 전수 스캔 중 직접
  // 좌표로 지역을 확정할 수 있어 함께 고친다.
  'L-S1108:806': {
    regionCode: '41',
    reason: '동구릉역(별내선 806) 주소 파싱 실패로 region_code=00 — 좌표 실측으로 경기도(41) 확정 (02 §9, 2026-08-25 MVP 범위 정정 중 발견)',
  },
  'L-S1108:808': {
    regionCode: '41',
    reason: '장자호수공원역(별내선 808) 주소 파싱 실패로 region_code=00 — 좌표 실측으로 경기도(41) 확정 (02 §9, 2026-08-25 MVP 범위 정정 중 발견)',
  },
};

/**
 * @param {import('./types.mjs').SourceRow[]} rows
 * @param {(msg: string) => void} log
 * @returns {import('./types.mjs').SourceRow[]}
 */
export function applyKnownCorrections(rows, log) {
  let count = 0;
  const corrected = rows.map((r) => {
    const key = `${r.lineCode}:${r.stationNo ?? ''}`;
    const fix = KNOWN_SOURCE_CORRECTIONS[key];
    if (!fix) return r;
    count += 1;
    /** @type {string[]} */
    const changes = [];
    if (fix.lat !== undefined || fix.lng !== undefined) {
      changes.push(`(${r.lat}, ${r.lng}) → (${fix.lat ?? r.lat}, ${fix.lng ?? r.lng})`);
    }
    if (fix.regionCode !== undefined) {
      changes.push(`region_code ${r.regionCode ?? '(null)'} → ${fix.regionCode}`);
    }
    log(`  [알려진 원천 오류 정정] ${r.stationName}(${r.lineName}, ${key}): ${changes.join(', ')} — ${fix.reason}`);
    return {
      ...r,
      lat: fix.lat ?? r.lat,
      lng: fix.lng ?? r.lng,
      regionCode: fix.regionCode ?? r.regionCode,
    };
  });
  if (count > 0) log(`알려진 원천 오류 ${count}건 정정 적용 (scripts/station-master/known-corrections.mjs)`);
  return corrected;
}
