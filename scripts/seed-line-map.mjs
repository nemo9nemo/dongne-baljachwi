/**
 * 노선도 도식 좌표 초기 배치 스캐폴딩 (03-line-map.md §9 "방법 D").
 *
 * DB의 실 위경도(`stations.lat/lng`)로 노선의 뼈대를 자동으로 만들고, 사람은 환승
 * 밀집부·꺾임 구간만 다듬는다. "자동 생성 결과를 검증 없이 쓰지 않는다"는 2026-08-12
 * 원결정의 원칙은 그대로 유지한다 — 이 스크립트는 최종본이 아니라 초안이고, 실행 뒤
 * 반드시 `npm run verify:line-map` + 육안 검토 + 수작업 보정을 거친다.
 *
 * 좌표 파일은 ADR-003 §5 "지금은 수도권 1개 파일"에 따라 항상
 * `src/data/line-map/metro-seoul.json` 하나를 읽고 그 자리에서 갱신한다.
 *
 * 사용법: node --env-file-if-exists=.env.local scripts/seed-line-map.mjs --line=L-I1103,L-I4106
 *   (여러 lineCode 를 한 번에 넘기면 파일 안에서 순서대로 처리되고, 먼저 처리된 노선이
 *    새로 추가한 역은 뒤 노선에서 "이미 배치된 역"으로 재사용된다 — 지축처럼 두 노선이
 *    공유하는 물리 역이 자동으로 이어 붙는 이유다.)
 *
 * service_role 키를 쓰는 이유는 verify-line-map.mjs 와 같다 — 로그인 세션 없이 CI/로컬에서
 * 돌리기 위해서다. 이 스크립트는 브라우저 번들에 들어가지 않는다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { distanceMeters } from './station-master/normalize.mjs';

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ re: number, im: number }} Complex
 * @typedef {{ a: Complex, b: Complex }} Similarity
 * @typedef {{ code: string, name_short: string, lat: number, lng: number }} GeoStation
 * @typedef {{ stationCode: string, x: number, y: number, labelAnchor: string, reused: boolean }} PlacedStation
 * @typedef {{ stationCode: string, x: number, y: number, labelAnchor: string }} StationEntry
 * @typedef {{ lineCode: string, polyline: [number, number][], stationCodes: string[] }} LineEntry
 * @typedef {{ viewBox: { width: number, height: number }, lines: LineEntry[], stations: StationEntry[] }} GeomDoc
 */

const GEOMETRY_FILE = 'src/data/line-map/metro-seoul.json';
/** viewBox 재계산 시 가장자리 역이 화면 끝에 바로 붙지 않도록 두는 여백(px). */
const MARGIN = 80;
/** 앵커(기존에 이미 배치된 역)가 하나도 없을 때 쓰는 기본 축척(px / 위도 1도). 임의값이라
 * 실제로 앵커 없는 상황(완전히 새 지역의 첫 노선)이 오면 사람이 결과를 보고 다시 조정해야 한다. */
const DEFAULT_SCALE = 6700;

// 좌표 작업에서 잠정 제외하는 역 — DB `in_mvp_scope` 는 건드리지 않는다(데이터 소유
// 경계 밖, `02-station-master.md` §9 "MVP 범위의 정확한 경계"는 여전히 미정). 이 목록은
// 좌표 정적 파일 쪽에서만 적용되는 별개의 필터다.
//
// 왜 필요한가: 1호선(L-I4101)/경원선(L-I4102) 파일럿에서 성환·직산·두정(충남)·연천(경기
// 최북단)까지 실좌표로 배치했더니, 모든 노선이 공유하는 단일 viewBox 종횡비가 1:1.1대에서
// 1:3까지 벌어졌다(2026-08-24 실측, `docs/PROGRESS.md` 표3 No.1). CLAUDE.md가 "수도권
// 지하철 기준"을 전제하는데 이 역들은 그 범위 밖이라는 게 상식적 판단이라 제외를 기본값으로
// 삼는다 — 좌표가 없는 역은 `03-line-map.md` §2.2/§5 에 따라 노선도 대신 하단 안내 목록에
// 뜨므로 기능은 깨지지 않는다. 새로 이런 사례(수도권 core를 크게 벗어나 종횡비를 심하게
// 왜곡시키는 역)를 만나면 여기 추가하고 실행 로그로 남긴다.
const EXCLUDE_STATION_CODES = new Set([
  'S-I4101-1725', // 성환역 (충남 천안)
  'S-I4101-1726', // 직산역 (충남 천안)
  'S-I4101-1727', // 두정역 (충남 천안)
  'S-I4102-1919', // 연천역 (경기 최북단, 연천군)
  'S-I4102-1918', // 전곡역 (연천역과 같은 연천군 — 연천역만 빼면 종횡비 왜곡의 원인이 그대로 남아 함께 제외)
  'S-I4102-1917', // 청산역 (위와 동일 사유)
]);

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const lineArg = process.argv.find((a) => a.startsWith('--line='));
if (!lineArg) {
  console.error('사용법: --line=<lineCode>[,<lineCode>...] (예: --line=L-I1103,L-I4106)');
  process.exit(1);
}
const targetLineCodes = lineArg.slice('--line='.length).split(',').map((s) => s.trim()).filter((s) => s.length > 0);

// ── 복소수 유사변환(회전+등배율+평행이동) 최소자승 적합 ────────────────────────────
// 왜 복소수인가: a*s+b 형태(s=원점, a=회전+배율, b=평행이동)는 a,b 에 대해 선형이라
// 일반 최소자승(정규방정식)으로 바로 풀린다. 2x2 회전행렬 + SVD를 직접 구현하는 것과
// 수학적으로 동치이면서 코드는 훨씬 짧다. 반사(reflection)는 만들지 않는다 — 위경도
// 평면을 그대로 회전·확대만 하면 되고 뒤집을 이유가 없기 때문이다.
/**
 * @param {Point[]} sourcePts
 * @param {Point[]} targetPts
 * @returns {Similarity}
 */
function fitSimilarity(sourcePts, targetPts) {
  const n = sourcePts.length;
  if (n === 0) {
    // 앵커가 전혀 없으면(이 지역의 첫 노선) 임의 기본 축척만 적용 — 사람이 결과를 보고
    // viewBox 안에 들어오는지 눈으로 확인해야 한다.
    return { a: { re: DEFAULT_SCALE, im: 0 }, b: { re: 0, im: 0 } };
  }
  let sumSx = 0, sumSy = 0, sumTx = 0, sumTy = 0, sumAbsS2 = 0, sumConjSTre = 0, sumConjSTim = 0;
  for (let i = 0; i < n; i += 1) {
    const s = sourcePts[i];
    const t = targetPts[i];
    sumSx += s.x; sumSy += s.y;
    sumTx += t.x; sumTy += t.y;
    sumAbsS2 += s.x * s.x + s.y * s.y;
    // conj(s) * t = (sx - i*sy)(tx + i*ty)
    sumConjSTre += s.x * t.x + s.y * t.y;
    sumConjSTim += s.x * t.y - s.y * t.x;
  }
  // conj(Σs) * Σt
  const conjSumSTre = sumSx * sumTx + sumSy * sumTy;
  const conjSumSTim = sumSx * sumTy - sumSy * sumTx;

  const numRe = n * sumConjSTre - conjSumSTre;
  const numIm = n * sumConjSTim - conjSumSTim;
  const den = n * sumAbsS2 - (sumSx * sumSx + sumSy * sumSy);

  if (Math.abs(den) < 1e-9) {
    // 앵커가 1개뿐이거나 전부 같은 점이면 회전/배율을 못 구한다 — 평행이동만 적용.
    return { a: { re: 1, im: 0 }, b: { re: (sumTx - sumSx) / n, im: (sumTy - sumSy) / n } };
  }
  const a = { re: numRe / den, im: numIm / den };
  // b = (Σt - a*Σs) / n
  const aSumSRe = a.re * sumSx - a.im * sumSy;
  const aSumSIm = a.im * sumSx + a.re * sumSy;
  const b = { re: (sumTx - aSumSRe) / n, im: (sumTy - aSumSIm) / n };
  return { a, b };
}

/**
 * @param {Similarity} transform
 * @param {Point} pt
 * @returns {Point}
 */
function applyTransform({ a, b }, pt) {
  return {
    x: a.re * pt.x - a.im * pt.y + b.re,
    y: a.im * pt.x + a.re * pt.y + b.im,
  };
}

// 위경도 → 평면 좌표 원값(정확한 지도 투영법 아님, 서울시청 기준 등장방형 근사).
// 기준점 자체는 임의라도 상관없다 — fitSimilarity 의 b(평행이동)가 최종 위치를 잡아준다.
const REF_LAT = 37.5665;
const REF_LNG = 126.978;
/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Point}
 */
function projectRaw(lat, lng) {
  return {
    x: (lng - REF_LNG) * Math.cos((REF_LAT * Math.PI) / 180) * DEFAULT_SCALE,
    y: -(lat - REF_LAT) * DEFAULT_SCALE, // 위도가 커질수록(북쪽) SVG y는 작아져야 함
  };
}

// ── 노선 내 역 순서를 seq가 아니라 실좌표 최근접 경로로 재구성 ──────────────────────
// 왜 seq를 안 믿는가: 파일럿 중 L-I4106(일산선) 의 station_lines.seq 가 실제 지리 순서와
// 어긋나는 것을 실측으로 확인했다(원흥(1)→지축(2)→삼송(3)... 인데 실제로는 지축이 삼송
// 다음, 즉 노선의 맨 끝 접속점이다). `02-station-master.md` §9 "seq 출처" 자체가 아직
// 미정 항목이라 근본 수정은 그 결정을 기다려야 하지만, 이 스크립트는 실좌표 최소신장트리
// (Prim) 로 순서를 직접 복원해 seq 버그를 우회한다 — 노선이 분기 없는 단순 경로라는
// 전제(3호선류 광역철도 대부분 해당)에서만 안전하다. 순환선(2호선)·분기선(성수/신정지선
// 같은 지선)에는 이 함수를 쓰면 안 된다(경로가 아니라 트리/루프라 DFS 순서가 깨진다).
//
// 알려진 한계 두 가지 (3·4호선 파일럿에서 실측):
// 1. 시작/끝 방향은 임의다 — 어느 쪽 종점에서 출발해 순서를 매기든 트리 지름 알고리즘은
//    "DB 조회 결과의 0번 인덱스에서 가장 먼 점"을 종점으로 잡으므로, 결과가 DB seq와 정반대
//    방향으로 나올 수 있다(예: 3호선이 오금→지축으로, DB는 지축→오금으로). **무해하다** —
//    `src/data/line-map/index.ts`의 소비 코드(`lineCodeByStationCode`는 역코드별 조회라
//    배열 내 순서 무관, `polyline` 렌더링은 연결된 선분이라 방향이 바뀌어도 그려지는 모양이
//    같다)를 추적 확인했다. verify-line-map.mjs 의 "역 순서가 다릅니다" 경고는 이 경우
//    그대로 나오는 게 정상이며 실패가 아니다.
// 2. 두 역이 실좌표상 서로 매우 가까우면(예: 신용산↔이촌, 약 500m) 최근접 이웃 판정이
//    둘의 앞뒤를 뒤바꿀 수 있다 — 4호선 파일럿에서 실측 확인, 수작업으로 좌표를 맞바꿔
//    보정했다. 자동 검출은 하지 않는다(사람이 육안 검토 단계에서 잡는 것을 전제).
/**
 * @param {GeoStation[]} stations
 * @returns {GeoStation[]}
 */
function reconstructPathOrder(stations) {
  const n = stations.length;
  if (n <= 2) return stations;
  /** @param {number} i @param {number} j @returns {number} */
  const dist = (i, j) =>
    distanceMeters(stations[i].lat, stations[i].lng, stations[j].lat, stations[j].lng);

  const inTree = new Array(n).fill(false);
  const parent = new Array(n).fill(-1);
  const key = new Array(n).fill(Number.POSITIVE_INFINITY);
  key[0] = 0;
  /** @type {number[][]} */
  const adj = Array.from({ length: n }, () => []);
  for (let iter = 0; iter < n; iter += 1) {
    let u = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i += 1) if (!inTree[i] && key[i] < best) { best = key[i]; u = i; }
    inTree[u] = true;
    if (parent[u] !== -1) { adj[u].push(parent[u]); adj[parent[u]].push(u); }
    for (let v = 0; v < n; v += 1) {
      if (!inTree[v]) {
        const d = dist(u, v);
        if (d < key[v]) { key[v] = d; parent[v] = u; }
      }
    }
  }

  // 트리 지름의 양 끝을 찾는 표준 기법(두 번 순회): 아무 점에서 가장 먼 점을 찾고,
  // 그 점에서 다시 순회하면 나머지 한쪽 끝이 나온다 — 경로 그래프에서는 이게 곧 시종점이다.
  /** @param {number} start @returns {{ order: number[], last: number }} */
  function traverseFrom(start) {
    const visited = new Array(n).fill(false);
    /** @type {number[]} */
    const order = [];
    const stack = [start];
    visited[start] = true;
    let last = start;
    while (stack.length > 0) {
      const u = /** @type {number} */ (stack.pop());
      order.push(u);
      last = u;
      for (const v of adj[u]) if (!visited[v]) { visited[v] = true; stack.push(v); }
    }
    return { order, last };
  }
  const { last: endpoint } = traverseFrom(0);
  const { order } = traverseFrom(endpoint);
  return order.map((i) => stations[i]);
}

// ── labelAnchor 추정: 접선 방향에 수직인 쪽으로 기본값을 잡는다 ─────────────────────
// 정밀하지 않다 — 수작업 보정 대상이라는 걸 전제로 한 최소한의 기본값이다.
/**
 * @param {Point | null} prev
 * @param {Point} cur
 * @param {Point | null} next
 * @returns {string}
 */
function pickLabelAnchor(prev, cur, next) {
  const p = prev ?? cur;
  const nx = next ?? cur;
  const dx = nx.x - p.x;
  const dy = nx.y - p.y;
  return Math.abs(dx) >= Math.abs(dy) ? 'top' : 'right';
}

/** @param {number} v @returns {number} */
function round1(v) {
  return Math.round(v * 10) / 10;
}

// ── 2호선 루프 관통 자동 회피 ──────────────────────────────────────────────────────
// 왜 넣었는가: 3호선·4호선 파일럿에서 "환승 회랑이 2호선 루프 내부를 가로지른다"는
// 문제가 2회 연속 재현됐다(같은 회랑, 방향만 반대: 3호선은 동쪽, 4호선은 서쪽). 우연이
// 아니라 이 방법(위경도 직접 투영) 자체의 구조적 특성 — 2호선 루프는 실지리가 아니라
// 예술적으로 왜곡한 도형이고, 나머지 노선은 실지리 기반이라 둘이 같은 좌표계에서 겹칠
// 이유가 없다. 패턴이 예측 가능하므로 매번 사람이 육안으로 찾아 손으로 미는 대신 규칙화한다.
//
// 왜 폴리곤이 아니라 타원인가: `src/data/line-map/index.ts` 주석에 2호선 루프 자체가
// 처음부터 "종횡비 1.35:1의 타원"으로 설계됐다고 적혀 있다 — 이 모델이 원안 설계 의도에
// 가깝고, 127점짜리 실제 폴리곤으로 레이캐스팅하는 것보다 코드가 훨씬 단순하며 경계
// 케이스(자기교차, 부동소수점) 버그가 날 여지가 적다.
//
// 두 파일럿에서 손으로 밀어냈던 18개 역 좌표를 이 모델로 역검증했더니 전부 "내부"로
// 정확히 잡혔다(오차 없음) — 회피 자체는 유효하지만, 그 결과가 사람이 만든 결과만큼
// "예쁘게" 밀리는 건 아니다(방향만 유지한 채 최단거리로 미는 것이라, 미감 있는 곡선을
// 만들지는 못한다). 그래서 이후에도 육안 검토 자체는 계속 필요하다 — 이 규칙은 "루프를
// 관통하는 명백한 오류"만 없애고, "자연스러운 곡선"까지 만들어주지는 않는다.
const LOOP_LINE_CODE = 'L-S1102';
/** 타원 경계에서 얼마나 더 바깥으로 미는가(비율). 딱 경계에 걸치면 다른 노선과 겹칠 수 있다. */
const LOOP_PUSH_MARGIN = 0.12;

/**
 * @typedef {{ cx: number, cy: number, rx: number, ry: number }} LoopEllipse
 */

/**
 * 이미 배치된 `lines[]`에서 2호선 루프를 찾아 바운딩박스 기반 타원으로 근사한다.
 * 루프가 아직 없는 파일(예: 수도권 밖 신규 권역)에서는 null — 이 경우 회피를 건너뛴다.
 * @param {LineEntry[]} lines
 * @returns {LoopEllipse | null}
 */
function findLoopEllipse(lines) {
  const loop = lines.find((l) => l.lineCode === LOOP_LINE_CODE);
  if (!loop) return null;
  let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of loop.polyline) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2 };
}

/**
 * pt가 루프 타원 내부면 중심에서 pt 방향으로 경계 밖까지 밀어낸 새 좌표를 돌려준다.
 * 이미 바깥이면 원래 좌표를 그대로 돌려준다(불필요한 이동을 만들지 않는다).
 * @param {Point} pt
 * @param {LoopEllipse} ellipse
 * @returns {Point}
 */
function pushOutsideLoop(pt, ellipse) {
  const dx = pt.x - ellipse.cx;
  const dy = pt.y - ellipse.cy;
  const r = Math.sqrt((dx / ellipse.rx) ** 2 + (dy / ellipse.ry) ** 2);
  // r>=1 은 이미 경계 위/바깥. r===0(중심과 정확히 일치)은 미는 방향 자체가 없어 포기한다
  // — 실제로는 역이 루프 중심(강남 어딘가)에 정확히 찍힐 확률은 0에 가깝다.
  if (r >= 1 || r === 0) return pt;
  const scale = (1 + LOOP_PUSH_MARGIN) / r;
  return { x: ellipse.cx + dx * scale, y: ellipse.cy + dy * scale };
}

/** @param {GeomDoc} d @returns {string} */
function formatDoc(d) {
  // 기존 metro-seoul.json은 손으로 쓰기 좋게 컴팩트 스타일(폴리라인 점 한 줄, 역 한 줄)로
  // 되어 있다. JSON.stringify(doc, null, 2) 기본 출력은 배열 원소마다 줄바꿈을 넣어 이
  // 스타일을 깨고 diff를 필요 이상으로 부풀린다 — 그래서 기존 스타일에 맞춰 직접 찍는다.
  /** @type {string[]} */
  const out = [];
  out.push('{');
  out.push(`  "viewBox": { "width": ${d.viewBox.width}, "height": ${d.viewBox.height} },`);
  out.push('  "lines": [');
  d.lines.forEach((l, li) => {
    out.push('    {');
    out.push(`      "lineCode": "${l.lineCode}",`);
    out.push('      "polyline": [');
    l.polyline.forEach((p, pi) => {
      out.push(`        [${p[0]}, ${p[1]}]${pi < l.polyline.length - 1 ? ',' : ''}`);
    });
    out.push('      ],');
    out.push(`      "stationCodes": [${l.stationCodes.map((c) => `"${c}"`).join(', ')}]`);
    out.push(li < d.lines.length - 1 ? '    },' : '    }');
  });
  out.push('  ],');
  out.push('  "stations": [');
  d.stations.forEach((s, si) => {
    out.push(
      `    { "stationCode": "${s.stationCode}", "x": ${s.x}, "y": ${s.y}, "labelAnchor": "${s.labelAnchor}" }${si < d.stations.length - 1 ? ',' : ''}`,
    );
  });
  out.push('  ]');
  out.push('}');
  return `${out.join('\n')}\n`;
}

// ── 메인 ────────────────────────────────────────────────────────────────────────
/** @type {GeomDoc} */
const doc = JSON.parse(readFileSync(GEOMETRY_FILE, 'utf8'));
/** @type {Map<string, StationEntry>} */
const existingByCode = new Map(doc.stations.map((s) => [s.stationCode, s]));

// 전역 유사변환 보정: 이미 배치된 역(현재 파일 안 전부)의 실 위경도를 DB에서 읽어와
// "이 지도가 어떤 각도·축척으로 그려졌는지"를 역산한다. 이번 실행에서 새로 추가되는
// 역과는 무관하게, 실행 시작 시점의 파일 상태 하나로 한 번만 계산한다(파일 안에서
// 노선을 여러 개 연달아 처리해도 기준이 흔들리지 않도록).
const anchorCodes = [...existingByCode.keys()];
const { data: anchorRows, error: anchorErr } = await db
  .from('stations')
  .select('code, lat, lng')
  .in('code', anchorCodes);
if (anchorErr) throw anchorErr;
/** @type {Map<string, { code: string, lat: number, lng: number }>} */
const anchorLatLngByCode = new Map((anchorRows ?? []).map((r) => [r.code, r]));

/** @type {Point[]} */
const calibSource = [];
/** @type {Point[]} */
const calibTarget = [];
for (const code of anchorCodes) {
  const geo = anchorLatLngByCode.get(code);
  const existing = existingByCode.get(code);
  if (!geo || !existing) continue; // DB에서 못 찾은 코드는 보정에서 제외(정합성 오류는 verify가 따로 잡는다)
  calibSource.push(projectRaw(geo.lat, geo.lng));
  calibTarget.push({ x: existing.x, y: existing.y });
}
const transform = fitSimilarity(calibSource, calibTarget);
console.log(
  `전역 보정: 앵커 ${calibSource.length}개 (기존 파일의 모든 역), ` +
    `a=${transform.a.re.toFixed(4)}+${transform.a.im.toFixed(4)}i, b=(${transform.b.re.toFixed(1)}, ${transform.b.im.toFixed(1)})`,
);

// 루프 관통 회피는 이번 실행 시작 시점의 2호선 루프 하나만 기준으로 삼는다(전역 보정과
// 같은 이유 — 노선을 여러 개 연달아 처리해도 기준이 흔들리지 않도록).
const loopEllipse = findLoopEllipse(doc.lines);
console.log(
  loopEllipse
    ? `루프 관통 회피 활성화: 2호선 타원 중심(${round1(loopEllipse.cx)}, ${round1(loopEllipse.cy)}), 반경(${round1(loopEllipse.rx)}, ${round1(loopEllipse.ry)})`
    : '루프 관통 회피 비활성화: 파일에 2호선(L-S1102)이 없음',
);

for (const lineCode of targetLineCodes) {
  if (doc.lines.some((l) => l.lineCode === lineCode)) {
    console.error(`이미 파일에 있음(건너뜀): ${lineCode}`);
    continue;
  }
  const { data: lineRow, error: lineErr } = await db
    .from('lines')
    .select('id, code, name')
    .eq('code', lineCode)
    .maybeSingle();
  if (lineErr) throw lineErr;
  if (!lineRow) {
    console.error(`DB에 없는 lineCode: ${lineCode}`);
    continue;
  }

  const { data: rows, error: slErr } = await db
    .from('station_lines')
    .select('seq, stations(code, name_short, lat, lng)')
    .eq('line_id', lineRow.id)
    .order('seq');
  if (slErr) throw slErr;

  // 임베드 조인 결과는 supabase-js 가 배열로 추론하지만 실제로는 1:1 이라 객체다
  // (verify-line-map.mjs 의 같은 패턴 참고).
  const fetched = /** @type {{ stations: GeoStation }[]} */ (/** @type {unknown} */ (rows)).map(
    (r) => r.stations,
  );
  const raw = fetched.filter((s) => !EXCLUDE_STATION_CODES.has(s.code));
  const excluded = fetched.length - raw.length;
  if (excluded > 0) {
    console.log(
      `${lineCode}: 원거리 역 ${excluded}개 좌표 작업에서 제외 — ` +
        fetched.filter((s) => EXCLUDE_STATION_CODES.has(s.code)).map((s) => `${s.name_short}(${s.code})`).join(', '),
    );
  }
  const ordered = reconstructPathOrder(raw);

  let pushedCount = 0;
  const placed = ordered.map((s) => {
    const existing = existingByCode.get(s.code);
    if (existing) {
      return { stationCode: s.code, x: existing.x, y: existing.y, labelAnchor: existing.labelAnchor, reused: true };
    }
    let pt = applyTransform(transform, projectRaw(s.lat, s.lng));
    // 앵커(이미 배치된 역)는 절대 밀지 않는다 — 사람이 확정한 좌표이기 때문이다.
    // 루프 자기 자신(L-S1102)을 처리 중일 때는 회피를 적용하지 않는다(자기 자신과 비교하는
    // 게 되어 의미가 없다).
    if (loopEllipse && lineCode !== LOOP_LINE_CODE) {
      const pushed = pushOutsideLoop(pt, loopEllipse);
      if (pushed.x !== pt.x || pushed.y !== pt.y) pushedCount += 1;
      pt = pushed;
    }
    return { stationCode: s.code, x: round1(pt.x), y: round1(pt.y), labelAnchor: 'top', reused: false };
  });

  placed.forEach((st, i) => {
    if (st.reused) return;
    st.labelAnchor = pickLabelAnchor(
      placed[i - 1] ? { x: placed[i - 1].x, y: placed[i - 1].y } : null,
      { x: st.x, y: st.y },
      placed[i + 1] ? { x: placed[i + 1].x, y: placed[i + 1].y } : null,
    );
  });

  let addedCount = 0;
  for (const st of placed) {
    if (!existingByCode.has(st.stationCode)) {
      const entry = { stationCode: st.stationCode, x: st.x, y: st.y, labelAnchor: st.labelAnchor };
      doc.stations.push(entry);
      existingByCode.set(st.stationCode, entry);
      addedCount += 1;
    }
  }

  doc.lines.push({
    lineCode,
    // 초기 골격은 역만 잇는 직선 구간이다 — 곡선화는 수작업 보정 대상(§9 방법 D).
    polyline: placed.map((s) => /** @type {[number, number]} */ ([s.x, s.y])),
    stationCodes: placed.map((s) => s.stationCode),
  });

  console.log(
    `${lineCode}(${lineRow.name}): 역 ${placed.length}개, 신규 배치 ${addedCount}개 ` +
      `(그중 루프 관통 회피로 자동으로 민 역 ${pushedCount}개), 기존 재사용(앵커) ${placed.length - addedCount}개`,
  );
}

// viewBox 밖(음수 좌표)으로 나간 역이 있으면 전체를 한 번에 평행이동해 원점을 되살린다.
// 개별 역만 옮기면 노선 모양이 뒤틀리므로, 반드시 모든 역 + 모든 폴리라인 점을 같은
// 오프셋으로 옮겨야 한다.
let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
for (const s of doc.stations) {
  minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
  maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y);
}
const offsetX = minX < MARGIN ? MARGIN - minX : 0;
const offsetY = minY < MARGIN ? MARGIN - minY : 0;
if (offsetX !== 0 || offsetY !== 0) {
  console.log(`viewBox 보정: 전체를 (${round1(offsetX)}, ${round1(offsetY)}) 만큼 평행이동`);
  for (const s of doc.stations) { s.x = round1(s.x + offsetX); s.y = round1(s.y + offsetY); }
  for (const l of doc.lines) {
    l.polyline = l.polyline.map(([x, y]) => [round1(x + offsetX), round1(y + offsetY)]);
  }
}
doc.viewBox = {
  width: round1(maxX + offsetX + MARGIN),
  height: round1(maxY + offsetY + MARGIN),
};

writeFileSync(GEOMETRY_FILE, formatDoc(doc));
console.log(`저장 완료: ${GEOMETRY_FILE} (viewBox ${doc.viewBox.width}x${doc.viewBox.height})`);
