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
  const raw = /** @type {{ stations: GeoStation }[]} */ (/** @type {unknown} */ (rows)).map(
    (r) => r.stations,
  );
  const ordered = reconstructPathOrder(raw);

  const placed = ordered.map((s) => {
    const existing = existingByCode.get(s.code);
    if (existing) {
      return { stationCode: s.code, x: existing.x, y: existing.y, labelAnchor: existing.labelAnchor, reused: true };
    }
    const { x, y } = applyTransform(transform, projectRaw(s.lat, s.lng));
    return { stationCode: s.code, x: round1(x), y: round1(y), labelAnchor: 'top', reused: false };
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
    `${lineCode}(${lineRow.name}): 역 ${placed.length}개, 신규 배치 ${addedCount}개, ` +
      `기존 재사용(앵커) ${placed.length - addedCount}개`,
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
