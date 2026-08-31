/**
 * 물리 역 그룹핑 (docs/specs/02-station-master.md F-02, F-04 ~ F-07, F-11).
 *
 * 공공데이터는 "역"을 노선별 행으로 준다. 홍대입구는 2호선·경의중앙선·공항철도 3행이다.
 * 사용자에게는 하나의 사건이므로 물리 역(`stations`) 1행 + 노선별 역(`station_lines`) N행으로
 * 접어야 한다. 그 판정 규칙이 이 파일 전부다.
 */

import { distanceMeters, isPlausibleKoreanCoord, numericPart, toNameKey, toNameShort } from './normalize.mjs';

/** F-02: 같은 물리 역으로 볼 좌표 이격 상한(m). 02 §9 에서 "실데이터로 조정" 미결로 남은 값. */
const MERGE_RADIUS_M = 500;

/**
 * @typedef {import('./types.mjs').SourceRow} SourceRow
 * @typedef {import('./types.mjs').MasterSnapshot} MasterSnapshot
 */

/**
 * @param {number[]} parent
 * @param {number} i
 * @returns {number}
 */
function find(parent, i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

/**
 * @param {number[]} parent @param {number} a @param {number} b
 */
function union(parent, a, b) {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[rb] = ra;
}

/**
 * 역번호를 code 에 넣을 형태로 정규화한다. 대문자화하고 영숫자·한글만 남긴다.
 *
 * **알파벳 접두어를 지우지 않는 것이 핵심이다.** 표준데이터의 역번호는 `D004`(신분당선),
 * `S110`(우이신설선), `U110`(의정부경전철) 처럼 체계를 구분하는 접두어를 포함한다
 * (자세한 배경은 아래 buildStationCode 주석).
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
function normalizeStationNo(value) {
  if (!value) return '';
  return String(value).normalize('NFC').toUpperCase().replace(/[^0-9A-Z가-힣]/g, '');
}

/**
 * F-06 대표 멤버 선정용 전순서 비교자.
 *
 * `localeCompare` 를 쓰지 않는다. 로케일/ICU 버전에 따라 정렬이 달라지면 같은 입력에서
 * 다른 `stations.code` 가 나올 수 있고, 그러면 재적재 안정성(F-06)이 환경에 좌우된다.
 * 코드유닛 비교만 쓴다.
 *
 * @param {SourceRow} a @param {SourceRow} b
 * @returns {number}
 */
function compareForCode(a, b) {
  if (a.lineCode !== b.lineCode) return a.lineCode < b.lineCode ? -1 : 1;
  // 같은 노선 안에서는 역번호 숫자 비교가 의미를 갖는다 (F-06 "최소 역번호").
  const na = numericPart(a.stationNo) ?? Number.MAX_SAFE_INTEGER;
  const nb = numericPart(b.stationNo) ?? Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;
  const ra = normalizeStationNo(a.stationNo);
  const rb = normalizeStationNo(b.stationNo);
  if (ra !== rb) return ra < rb ? -1 : 1;
  // 원천이 같은 역번호를 두 번 주는 경우까지 결정적으로 만든다.
  const ka = toNameKey(a.stationName);
  const kb = toNameKey(b.stationName);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return 0;
}

/**
 * F-06: 물리 역 그룹의 안정 키 `S-<노선번호>-<역번호>` 를 만든다.
 * 재적재해도 같은 역이 같은 code 여야 `records.station_id` 가 계속 유효하다.
 *
 * ── 왜 역번호만으로는 안 되는가 (2026-08-12 실데이터 1,099행으로 확인) ──
 * 처음 구현은 "그룹 내 최소 역번호"를 `numericPart()` 로 숫자만 뽑아 `S-<숫자>` 로 썼다.
 * 그런데 표준데이터의 역번호는 **전국 단일 번호가 아니라 노선/체계별 지역 번호**이고,
 * 상당수는 체계를 구분하는 알파벳 접두어까지 달고 있다:
 *
 *   신분당선 `D004` · 우이신설선 `S110` · 의정부경전철 `U110` · 김포골드라인 `G110`
 *   광주 1호선 `110` · 대전 1호선 `110` · 서울 2호선 `0239` · 대구 1호선 `0115` · 부산 1호선 `0115`
 *
 * 숫자만 남기면 광주 화정(110)·서울 북한산우이(S110)·의정부 발곡(U110)·대전 탄방(110)이
 * 전부 `S-110` 으로 수렴한다. 실측 결과 `[code 충돌]` 265건이 났고, 그중 10건은 서로 다른
 * 역이 같은 `station_lines` 행으로 접혀 아래 PK 중복 제거에서 **조용히 유실**됐다.
 *
 * ── 왜 노선번호로 네임스페이스하는가 ──
 * 역번호가 유일해지는 범위는 "노선"이다. 실측에서 `(노선번호, 역번호)` 중복은 1,099행 중
 * 5건뿐이고, 그 5건은 같은 물리 역이 두 노선명으로 중복 수록된 행이라 어차피 같은 그룹으로
 * 묶인다. 즉 이 조합이면 서로 다른 역의 code 충돌은 사실상 0이다.
 *
 * ── 왜 "최소 역번호"가 아니라 "노선번호가 가장 작은 노선의 역번호"인가 ──
 * 스펙 F-06 문언은 "그룹 내 최소 역번호"지만, 위 예시처럼 노선이 다르면 역번호의 크기 비교
 * 자체가 의미가 없다. 게다가 숫자 최소를 쓰면 **역번호가 더 작은 노선이 그 역에 새로 개통하는
 * 순간 기존 역의 code 가 바뀐다**(예: 1호선 0139 역에 신림선 S123 이 붙으면 대표가 뒤집힌다).
 * 노선 집합이 바뀔 때만 흔들리는 쪽이 F-06 이 요구하는 "재적재해도 같은 code" 에 더 가깝다.
 * 그래도 노선 집합 변화에는 여전히 취약하다 — 그 경우는 F-04 수동 교정으로 고정한다.
 *
 * @param {SourceRow[]} members 한 물리 역으로 묶인 원천 행들
 * @returns {string}
 */
function buildStationCode(members) {
  const rep = [...members].sort(compareForCode)[0];
  // lines.code 는 `L-<노선번호>` 다. 역 코드에서는 접두어를 떼고 노선번호만 쓴다.
  const lineNo = rep.lineCode.replace(/^L-/, '');
  // 역번호가 없는 원천(TAGO 일부 노선)은 노선 안에서 역명 정규화 키로 식별한다.
  // 노선 하나 안에 같은 이름의 역은 없으므로 유일하고, 역명이 바뀌지 않는 한 안정적이다.
  const ident = normalizeStationNo(rep.stationNo) || toNameKey(rep.stationName);
  return `S-${lineNo}-${ident}`;
}

/**
 * 원천 행들을 물리 역으로 묶어 적재 스냅샷을 만든다.
 *
 * @param {SourceRow[]} rows
 * @param {{ merge: string[][], split: string[][] }} overrides F-04 수동 교정 (원천 역번호 목록)
 * @param {(lineCode: string, lineName: string) => { sortOrder: number, colorToken: string, inMvpScope: boolean }} lineMeta
 * @returns {MasterSnapshot}
 */
export function groupStations(rows, overrides, lineMeta) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const skipped = [];

  // 좌표 없는 행은 적재하지 않는다. stations.lat/lng 가 NOT NULL 이기 때문이며(02 §4.2),
  // 좌표 없는 역은 지도에도 노선도에도 그릴 수 없어 반쪽 데이터로 남을 뿐이다.
  /** @type {SourceRow[]} */
  const usable = [];
  for (const r of rows) {
    if (!isPlausibleKoreanCoord(r.lat, r.lng)) {
      skipped.push(`${r.stationName}(${r.lineName}, key=${r.sourceKey}): 좌표 없음/범위 밖 lat=${r.lat} lng=${r.lng}`);
      continue;
    }
    usable.push(r);
  }

  const parent = usable.map((_, i) => i);
  const keyOf = usable.map((r) => toNameKey(r.stationName));

  // F-02: 정규화 역명이 같고 + 좌표가 500m 이내인 행들을 하나로 묶는다 (두 조건 모두).
  /** @type {Map<string, number[]>} */
  const byKey = new Map();
  usable.forEach((_, i) => {
    const list = byKey.get(keyOf[i]);
    if (list) list.push(i);
    else byKey.set(keyOf[i], [i]);
  });

  for (const [key, idxs] of byKey) {
    for (let a = 0; a < idxs.length; a += 1) {
      for (let b = a + 1; b < idxs.length; b += 1) {
        const i = idxs[a];
        const j = idxs[b];
        const d = distanceMeters(
          /** @type {number} */ (usable[i].lat), /** @type {number} */ (usable[i].lng),
          /** @type {number} */ (usable[j].lat), /** @type {number} */ (usable[j].lng),
        );
        if (d <= MERGE_RADIUS_M) union(parent, i, j);
      }
    }
    // F-05 경고 1종: 같은 이름인데 500m 를 넘어 자동 병합되지 않은 경우 (동명이역일 수도,
    // 환승 통로가 긴 역일 수도 있다 — 사람이 판단해 station_merge_overrides 에 남긴다).
    const roots = new Set(idxs.map((i) => find(parent, i)));
    if (roots.size > 1) {
      warnings.push(
        `[동명 500m 초과] "${usable[idxs[0]].stationName}"(key=${key}) 가 ${roots.size}개로 분리됨: ` +
        idxs.map((i) => `${usable[i].lineName}/${usable[i].sourceKey}`).join(', '),
      );
    }
  }

  // F-05 경고 2종: 500m 이내인데 이름이 달라 묶이지 않은 쌍.
  // 1,000행 규모라 O(n²)(약 50만 회 거리 계산)로도 1초 안에 끝난다. 공간 인덱스는 과잉이다.
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      if (keyOf[i] === keyOf[j]) continue;
      const d = distanceMeters(
        /** @type {number} */ (usable[i].lat), /** @type {number} */ (usable[i].lng),
        /** @type {number} */ (usable[j].lat), /** @type {number} */ (usable[j].lng),
      );
      if (d <= MERGE_RADIUS_M) {
        warnings.push(
          `[근접 이름불일치] "${usable[i].stationName}"(${usable[i].lineName}) ↔ ` +
          `"${usable[j].stationName}"(${usable[j].lineName}) ${Math.round(d)}m`,
        );
      }
    }
  }

  // F-04: 수동 교정이 자동 규칙보다 우선한다.
  /** @type {Map<string, number>} */
  const bySourceKey = new Map();
  usable.forEach((r, i) => bySourceKey.set(r.sourceKey, i));

  for (const keys of overrides.merge) {
    const idxs = keys.map((k) => bySourceKey.get(k)).filter((i) => i !== undefined);
    for (let a = 1; a < idxs.length; a += 1) union(parent, /** @type {number} */ (idxs[0]), /** @type {number} */ (idxs[a]));
  }
  for (const keys of overrides.split) {
    // split 은 "이미 묶인 것을 떼어낸다". union-find 에서 분리는 표현이 어려우므로,
    // 해당 원천 키들을 각자 독립 루트로 되돌린 뒤 나머지 규칙을 다시 적용하지 않는다.
    // (split 대상은 소수의 동명이역이라 이 단순한 처리로 충분하다.)
    for (const k of keys) {
      const i = bySourceKey.get(k);
      if (i !== undefined) parent[i] = i;
    }
  }

  /** @type {Map<number, number[]>} */
  const clusters = new Map();
  usable.forEach((_, i) => {
    const root = find(parent, i);
    const list = clusters.get(root);
    if (list) list.push(i);
    else clusters.set(root, [i]);
  });

  /** @type {MasterSnapshot['stations']} */
  const stations = [];
  /** @type {MasterSnapshot['station_lines']} */
  const stationLines = [];
  /**
   * stationLines 와 인덱스가 1:1 인 원천 행. PK 중복이 났을 때 "같은 역이 두 번 수록된 것"인지
   * "다른 역이 한 그룹으로 접힌 것"인지 되짚는 데만 쓴다 (아래 중복 제거 참조).
   * @type {SourceRow[]}
   */
  const stationLineOrigins = [];
  /** @type {Map<string, MasterSnapshot['lines'][number]>} */
  const lines = new Map();
  /** @type {Set<string>} */
  const usedStationCodes = new Set();

  for (const idxs of clusters.values()) {
    const members = idxs.map((i) => usable[i]);

    // F-06: 안정 키 `S-<노선번호>-<역번호>`. 근거는 buildStationCode 주석 참조.
    const code = buildStationCode(members);

    if (usedStationCodes.has(code)) {
      // 같은 code 가 두 번 나오면 서로 다른 역이 같은 키를 갖게 되어 기록이 엉킨다.
      // 자동으로 봉합하지 않고 경고로 남긴다 — 사람이 F-04 override 로 결정해야 한다.
      // (봉합하지 않는 이유: 어느 쪽에 접미사를 붙일지 자동으로 정하면 그 판단이 입력 순서에
      //  의존하게 되어, 다음 적재 때 code 가 뒤바뀌는 더 나쁜 사고가 난다.)
      warnings.push(
        `[code 충돌] ${code} 가 중복 생성됨: ` +
        members.map((m) => `"${m.stationName}"(${m.lineName}/${m.stationNo ?? '역번호없음'})`).join(', ') +
        ' — station_merge_overrides 로 병합/분리를 명시하라',
      );
    }
    usedStationCodes.add(code);

    // F-07: 대표 좌표는 그룹 내 노선별 좌표의 산술 평균. 지도 핀은 하나만 찍으면 된다.
    const lat = members.reduce((s, m) => s + /** @type {number} */ (m.lat), 0) / members.length;
    const lng = members.reduce((s, m) => s + /** @type {number} */ (m.lng), 0) / members.length;

    const primary = members[0];
    const regionCode = members.find((m) => m.regionCode)?.regionCode ?? null;

    stations.push({
      code,
      name: primary.stationName.normalize('NFC').trim(),
      name_short: toNameShort(primary.stationName),
      name_key: toNameKey(primary.stationName),
      lat,
      lng,
      region_code: regionCode ?? '00',
      // 검토가 필요한 상태로 적재한다: 시도 코드를 못 뽑았거나 그룹 내 이름이 서로 다르다.
      needs_review: regionCode === null || new Set(members.map((m) => toNameKey(m.stationName))).size > 1,
    });

    for (const m of members) {
      stationLines.push({
        station_code: code,
        line_code: m.lineCode,
        station_no: m.stationNo,
        seq: m.seqHint ?? numericPart(m.stationNo) ?? 0,
        lat: /** @type {number} */ (m.lat),
        lng: /** @type {number} */ (m.lng),
      });
      stationLineOrigins.push(m);

      if (!lines.has(m.lineCode)) {
        // 표시명과 색상 토큰은 **같은 행**에서 나와야 한다. 원천은 한 노선번호 아래 표기가
        // 여러 개인 경우가 있어(S1109 = "서울 도시철도 9호선" 25행 / "수도권  도시철도 9호선"
        // 13행, S1107 = "7호선" / "도시철도 7호선", I4101 = "1호선" / "경부선"), 이름은
        // 이 행에서 뽑고 토큰은 다른 행에서 뽑으면 "이름은 9호선인데 색은 기본 회색"이 된다.
        // 실제로 2026-08-31 이 불일치로 9호선만 회색으로 그려지고 있었다.
        const meta = lineMeta(m.lineCode, m.lineName);
        lines.set(m.lineCode, {
          code: m.lineCode,
          name: m.lineName,
          operator: m.operator,
          sort_order: meta.sortOrder,
          color_token: meta.colorToken,
          in_mvp_scope: meta.inMvpScope,
        });
      }
    }
  }

  // PK (station_id, line_id) 중복 제거. 원인이 두 가지라 구분해서 알린다 — 하나는 무해하고
  // 하나는 데이터 유실이라, 같은 문구로 뭉뚱그리면 진짜 사고가 노이즈에 묻힌다.
  //
  //  (a) [원천 중복행] 원천이 같은 역을 같은 노선번호 아래 노선명만 바꿔 두 번 실은 경우.
  //      실데이터 예: 광운대역·중랑역·상봉역이 노선번호 I4108 아래 '경의중앙선'과 '경춘선'으로
  //      각각 수록돼 있고, 주안역은 '경인선' 행이 통째로 두 번 있다. lineCode 가 같으니
  //      lines 행도 어차피 하나로 접히고, 버리는 행은 남기는 행과 값이 동일하다 → 유실 아님.
  //  (b) [노선 내 역 중복] 그 외. 서로 다른 역이 한 그룹으로 접혔다는 뜻이고, 이때는 버리는
  //      행이 진짜 데이터다. F-04 override 로 떼어내야 한다.
  /** @type {Map<string, number>} 중복 판정용: key → 채택한 stationLines 인덱스 */
  const keptAt = new Map();
  /** @type {MasterSnapshot['station_lines']} */
  const deduped = [];
  for (let i = 0; i < stationLines.length; i += 1) {
    const sl = stationLines[i];
    const k = `${sl.station_code}|${sl.line_code}`;
    const prevIdx = keptAt.get(k);
    if (prevIdx !== undefined) {
      const kept = stationLineOrigins[prevIdx];
      const dropped = stationLineOrigins[i];
      const sameSourceStation =
        toNameKey(kept.stationName) === toNameKey(dropped.stationName) &&
        normalizeStationNo(kept.stationNo) === normalizeStationNo(dropped.stationNo);
      warnings.push(sameSourceStation
        ? `[원천 중복행] ${sl.line_code} ${sl.station_no ?? ''} "${dropped.stationName}" 가 ` +
          `노선명만 다르게 2회 수록됨 (${kept.lineName} / ${dropped.lineName}) — 뒤 행을 버린다`
        : `[노선 내 역 중복] ${sl.line_code} 에 ${sl.station_code} 가 2회 — 그룹핑 과병합 의심: ` +
          `"${kept.stationName}"(${kept.stationNo ?? '-'}) vs "${dropped.stationName}"(${dropped.stationNo ?? '-'})`);
      continue;
    }
    keptAt.set(k, i);
    deduped.push(sl);
  }

  // F-11: seq 는 UNIQUE (line_id, seq) 다. 원천 역번호가 중복되거나 비어 있으면 적재가
  // 통째로 실패하므로, 중복 제거 후 노선 안에서 역번호 순으로 1..N 을 다시 매긴다.
  // (역번호가 노선상 순서와 다른 지선·연장 구간은 02 §9 의 미결 항목이며 육안 검증 대상이다.)
  /** @type {Map<string, MasterSnapshot['station_lines']>} */
  const byLine = new Map();
  for (const sl of deduped) {
    const list = byLine.get(sl.line_code);
    if (list) list.push(sl);
    else byLine.set(sl.line_code, [sl]);
  }
  for (const list of byLine.values()) {
    list.sort((a, b) => (a.seq - b.seq) || a.station_code.localeCompare(b.station_code));
    list.forEach((sl, i) => { sl.seq = i + 1; });
  }

  return { lines: [...lines.values()], stations, station_lines: deduped, warnings, skipped };
}
