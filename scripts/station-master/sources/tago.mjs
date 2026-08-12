/**
 * 원천 어댑터 A — 국토교통부 TAGO 지하철정보 (data.go.kr/15098554).
 *
 * ⚠ **기본 경로에서 제외된 어댑터다** (02 §9, ADR-001).
 * 2026-08-12 실제 키로 첫 실 호출을 한 결과 `HTTP 400 NO_OPENAPI_SERVICE_ERROR`
 * (returnReasonCode 12 = "요청 URL 이 게이트웨이에 등록된 서비스와 매칭되지 않음")가 나왔다.
 * 같은 키로 다른 오퍼레이션·가짜 서비스명까지 대조 호출했을 때도 동일 에러였으므로,
 * 키 미승인이 아니라 **아래 `DEFAULT_ENDPOINT` 경로 자체가 유효하지 않다**는 진단이다.
 * 따라서 (a) 200 응답 여부는 실패로 확인됐고, (b) 위/경도 포함 여부·(c) 노선 내 순서(seq)
 * 포함 여부는 응답 바디에 도달하지 못해 여전히 미확인이다.
 *
 * 그래서 역 마스터의 공식 원천은 전국도시철도역사정보표준데이터(standard-file)로 확정됐고,
 * 이 어댑터는 자동 선택되지 않는다 — `--source=tago` 로 명시할 때만 돈다.
 * **코드는 지우지 않는다.** data.go.kr 활용가이드 문서에서 올바른 엔드포인트·오퍼레이션명을
 * 찾으면 `--endpoint=<URL>` 로 덮어써 바로 재시도할 수 있다.
 *
 * 응답 스키마가 미확인인 상태 그대로이므로 로직은 "받아서 적재한다"가 아니라
 * **"받아서 검증하고, 부족하면 크게 실패한다"** 를 유지한다. 실제로 발견한 필드명을 로그로
 * 남기므로 첫 성공 응답을 보고 FIELD_CANDIDATES 를 확정하면 된다.
 * 과거 별개 프로젝트의 SERVICE_KEY_IS_NOT_REGISTERED_ERROR 이력 때문에 그 케이스도
 * 계속 구분해 출력한다.
 */

import { numericPart, regionCodeFromAddress } from '../normalize.mjs';

/** @typedef {import('../types.mjs').SourceRow} SourceRow */

// 2026-08-12 기준 이 URL 은 NO_OPENAPI_SERVICE_ERROR 를 돌려준다. 올바른 경로를 확인하기
// 전까지는 --endpoint=<URL> 로 덮어써야 한다. 기록 목적으로 값은 남겨둔다.
const DEFAULT_ENDPOINT = 'http://apis.data.go.kr/1613000/SubwayInfoService/getKwrdFndSubwaySttnList';
const PAGE_SIZE = 500;

/** 응답 필드명이 미확인이라 후보를 순서대로 훑는다. 실제로 맞은 이름은 로그로 남긴다. */
const FIELD_CANDIDATES = /** @type {const} */ ({
  stationId:   ['subwayStationId', 'sttnId', 'stationId', 'nodeid'],
  stationName: ['subwayStationName', 'sttnNm', 'stationName', 'nodenm'],
  lineName:    ['subwayRouteName', 'routeNm', 'lineName', 'subwayLineName'],
  lineId:      ['subwayRouteId', 'routeId', 'lineId'],
  lat:         ['gpslati', 'latitude', 'lat', 'yCoord', 'ycrd'],
  lng:         ['gpslong', 'longitude', 'lng', 'xCoord', 'xcrd'],
  stationNo:   ['subwayStationNo', 'sttnNo', 'stationNo'],
  seq:         ['subwayStationSeq', 'sttnOrd', 'ord', 'seq'],
  address:     ['adres', 'address', 'lnmadr', 'rdnmadr'],
});

/**
 * @param {Record<string, unknown>} item
 * @param {readonly string[]} candidates
 * @returns {{ key: string, value: unknown } | null}
 */
function pick(item, candidates) {
  for (const key of candidates) {
    const value = item[key];
    if (value !== undefined && value !== null && value !== '') return { key, value };
  }
  return null;
}

/**
 * data.go.kr 키는 "인코딩 키"와 "디코딩 키" 두 가지로 발급된다. 인코딩 키를 다시
 * encodeURIComponent 하면 `%`가 `%25`가 되어 인증에 실패한다 — 실제로 자주 겪는 함정이다.
 * @param {string} key
 * @returns {string}
 */
function serviceKeyParam(key) {
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

/**
 * @param {{ serviceKey: string, endpoint?: string, keyword?: string, log: (msg: string) => void }} opts
 * @returns {import('../types.mjs').StationSource}
 */
export function createTagoSource(opts) {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;

  return {
    id: 'tago',
    // 비밀값(서비스 키)은 절대 로그에 넣지 않는다.
    describe: `TAGO 지하철정보 (${endpoint})`,

    async fetchRows() {
      /** @type {SourceRow[]} */
      const rows = [];
      /** @type {unknown[]} */
      const rawPages = [];
      /** @type {Record<string, string>} */
      const resolvedFields = {};

      let pageNo = 1;
      let total = Number.POSITIVE_INFINITY;

      while (rows.length < total) {
        const url = new URL(endpoint);
        url.searchParams.set('pageNo', String(pageNo));
        url.searchParams.set('numOfRows', String(PAGE_SIZE));
        url.searchParams.set('_type', 'json');
        if (opts.keyword) url.searchParams.set('subwayStationName', opts.keyword);
        // serviceKey 만 직접 붙인다. URLSearchParams 가 이미 인코딩된 키를 재인코딩하기 때문.
        const requestUrl = `${url.toString()}&serviceKey=${serviceKeyParam(opts.serviceKey)}`;

        const res = await fetch(requestUrl);
        const body = await res.text();

        // 02 §5 "수집 실패": HTTP 상태 + 본문 앞 500자 + 중단. 부분 적재 없음.
        if (!res.ok) {
          throw new Error(`TAGO HTTP ${res.status} ${res.statusText}\n${body.slice(0, 500)}`);
        }
        if (body.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')) {
          throw new Error(
            'TAGO 서비스 키가 등록되지 않았다 (SERVICE_KEY_IS_NOT_REGISTERED_ERROR).\n' +
            '  - data.go.kr 마이페이지에서 해당 API 활용신청이 "승인" 상태인지\n' +
            '  - 승인 직후라면 반영까지 최대 1시간 걸린다\n' +
            '  - 인코딩/디코딩 키를 바꿔서 시도했는지\n' +
            '  확인 후 재실행하거나, --source=standard-file 로 전환하라 (02 §9).',
          );
        }

        /** @type {unknown} */
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          // JSON 을 요청했는데 XML 이 오면 대개 인증/파라미터 오류 응답이다.
          throw new Error(`TAGO 응답이 JSON 이 아니다. 앞 500자:\n${body.slice(0, 500)}`);
        }
        rawPages.push(parsed);

        const response = /** @type {{ response?: { header?: Record<string, string>, body?: Record<string, unknown> } }} */ (parsed).response;
        const resultCode = response?.header?.resultCode;
        if (resultCode !== undefined && resultCode !== '00') {
          throw new Error(`TAGO resultCode=${resultCode} msg=${response?.header?.resultMsg ?? '(없음)'}`);
        }

        const rawItems = /** @type {{ item?: unknown }} */ (response?.body?.items ?? {}).item;
        const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
        total = Number(response?.body?.totalCount ?? items.length);

        if (items.length === 0) break;

        for (const raw of items) {
          const item = /** @type {Record<string, unknown>} */ (raw);
          const id = pick(item, FIELD_CANDIDATES.stationId);
          const name = pick(item, FIELD_CANDIDATES.stationName);
          const lineName = pick(item, FIELD_CANDIDATES.lineName);
          const lineId = pick(item, FIELD_CANDIDATES.lineId);
          const lat = pick(item, FIELD_CANDIDATES.lat);
          const lng = pick(item, FIELD_CANDIDATES.lng);
          const stationNo = pick(item, FIELD_CANDIDATES.stationNo);
          const seq = pick(item, FIELD_CANDIDATES.seq);
          const address = pick(item, FIELD_CANDIDATES.address);

          for (const [logical, found] of Object.entries({ id, name, lineName, lineId, lat, lng, stationNo, seq, address })) {
            if (found && !resolvedFields[logical]) resolvedFields[logical] = found.key;
          }

          if (!id || !name || !lineName) {
            throw new Error(
              `TAGO 응답에서 필수 필드를 찾지 못했다. 실제 키 목록: ${Object.keys(item).join(', ')}\n` +
              '  → FIELD_CANDIDATES 를 갱신하거나 --source=standard-file 로 전환하라.',
            );
          }

          rows.push({
            sourceKey: String(id.value),
            stationName: String(name.value),
            lineCode: `L-${String(lineId?.value ?? lineName.value)}`,
            lineName: String(lineName.value),
            operator: null,
            stationNo: stationNo ? String(stationNo.value) : null,
            lat: lat ? Number(lat.value) : null,
            lng: lng ? Number(lng.value) : null,
            regionCode: address ? regionCodeFromAddress(String(address.value)) : null,
            seqHint: seq ? numericPart(String(seq.value)) : null,
          });
        }

        opts.log(`  수집 중 ${rows.length}/${Number.isFinite(total) ? total : '?'}`);
        pageNo += 1;
        if (pageNo > 200) break;   // 무한 루프 방어: 200페이지 × 500 = 10만 행이면 원천이 이상하다
      }

      opts.log(`  응답 필드 매핑: ${JSON.stringify(resolvedFields)}`);

      // 02 §9 (b)/(c) 를 여기서 판정한다. 좌표가 없으면 그룹핑(F-02)도 대표 좌표(F-07)도
      // 성립하지 않으므로 조용히 넘어가지 않고 즉시 중단한다.
      const withCoords = rows.filter((r) => r.lat !== null && r.lng !== null).length;
      if (rows.length > 0 && withCoords === 0) {
        throw new Error(
          'TAGO 응답에 위/경도가 전혀 없다 (02 §9 (b) 검증 실패).\n' +
          '  → 전국도시철도역사정보표준데이터로 원천을 교체하라: --source=standard-file --file=<경로>\n' +
          '  → ADR-001 의 "TAGO API" 항목 갱신도 필요하다.',
        );
      }

      return { rows, sourceUpdatedOn: null, raw: rawPages };
    },
  };
}
