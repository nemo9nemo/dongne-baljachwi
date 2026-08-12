/**
 * 역 마스터 배치의 공통 타입.
 *
 * 원천(TAGO API / 표준데이터 파일)이 확정되지 않았기 때문에
 * `fetch → 정규화 → 그룹핑 → upsert` 파이프라인에서 fetch 단계만 교체 가능해야 한다
 * (docs/specs/02-station-master.md §4.8). 그 교체 지점의 계약이 `SourceRow` 다.
 *
 * 이 파일은 타입 선언만 있고 런타임 코드가 없다.
 */

/**
 * 원천 1행 = "노선별 역" 1건. 환승역은 노선 수만큼 행이 나온다.
 *
 * @typedef {object} SourceRow
 * @property {string}      sourceKey    원천 고유키(역번호 등). 그룹핑/오버라이드의 단위이자 F-06 code 의 재료
 * @property {string}      stationName  역명 원문 (표시용)
 * @property {string}      lineCode     노선 코드 (원천 노선번호 기반)
 * @property {string}      lineName     노선 표시명
 * @property {string|null} operator     운영기관명
 * @property {string|null} stationNo    노선 내 역번호
 * @property {number|null} lat          위도. null 이면 적재 보류 대상 (02 §4.2)
 * @property {number|null} lng          경도
 * @property {string|null} regionCode   시도 코드(11/41/28 ...)
 * @property {number|null} seqHint      원천이 알려주는 노선 내 순서. 없으면 역번호로 파생 (F-11)
 */

/**
 * 원천 어댑터. `fetch` 단계만 갈아끼우기 위한 최소 인터페이스다.
 *
 * @typedef {object} StationSource
 * @property {'tago'|'standard-file'} id
 * @property {string} describe  실행 로그에 남길 한 줄 설명(비밀값 포함 금지)
 * @property {() => Promise<{ rows: SourceRow[], sourceUpdatedOn: string|null, raw: unknown }>} fetchRows
 */

/**
 * 그룹핑 결과 = apply_station_master() 에 그대로 넘길 스냅샷.
 *
 * @typedef {object} MasterSnapshot
 * @property {{ code: string, name: string, operator: string|null, sort_order: number,
 *              color_token: string, in_mvp_scope: boolean }[]} lines
 * @property {{ code: string, name: string, name_short: string, name_key: string,
 *              lat: number, lng: number, region_code: string, needs_review: boolean }[]} stations
 * @property {{ station_code: string, line_code: string, station_no: string|null,
 *              seq: number, lat: number, lng: number }[]} station_lines
 * @property {string[]} warnings  F-05 그룹핑 경고 (사람이 검토할 목록)
 * @property {string[]} skipped   좌표 미확보 등으로 적재하지 않은 원천 행
 */

export {};
