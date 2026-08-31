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
 * 사용법 2: node scripts/seed-line-map.mjs --resolve-crowding
 *   `pushOutsideLoop`가 반경(법선)만 맞추고 접선(둘레) 방향은 그대로 둬서 생기는 2호선
 *   루프 경계 밀집(디자이너 진단: `docs/design/line-map-boundary-review.md`)을 2차 패스로
 *   해소한다. DB 접속이 필요 없다 — 이미 있는 파일의 좌표만 읽고 다시 쓴다.
 *
 * 사용법 3: node scripts/seed-line-map.mjs --octolinear=<lineCode>[,...] --out=<경로>
 *   선분 각도를 45도 배수로 스냅하는 3차 패스(03-line-map.md §9, 2026-08-31 B안).
 *   여러 노선을 넘기면 **하나씩 순서대로 처리하는 게 아니라** 전역 완화 → 확정 두 단계로
 *   한꺼번에 푼다(`octolinearizeAll` 주석 참고) — 환승역 좌표가 "누가 마지막에 만졌는가"로
 *   결정되지 않게 하기 위해서다.
 *   `--rounds=<n>`(1단계 완화 상한, 기본 60), `--min-seg=<px>`(선분 길이 하한, 기본 26)로
 *   튜닝한다. **`--out` 이 필수다** — fixture 를 사고로 덮어쓰지 않고 먼저 비교하기 위해서다
 *   (반영할 때는 `--out=src/data/line-map/metro-seoul.json`). DB 접속이 필요 없다.
 *
 * service_role 키를 쓰는 이유는 verify-line-map.mjs 와 같다 — 로그인 세션 없이 CI/로컬에서
 * 돌리기 위해서다(단, `--resolve-crowding`/`--octolinear` 모드는 DB를 쓰지 않아 키가 없어도
 * 동작한다). 이 스크립트는 브라우저 번들에 들어가지 않는다.
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
  // 양원역(S-I4108-1204)은 한때 여기 있었다 — DB lat/lng이 경상북도 포항/영덕 인근으로
  // 잘못 적재된 데이터 버그였다(경의중앙선 소속, 정상 위치는 경기 구리 인근). 백엔드가
  // 원본 표준데이터 오류를 찾아 실 DB에 (37.606582, 127.107935)로 정정했다(2026-08-25,
  // 커밋 58b5f84) — 제외 사유가 사라져 목록에서 뺐다. 이 줄은 "버그로 제외했다가 원인이
  // 해소되면 뺀다"는 이 목록의 용도를 보여주는 사례로 주석만 남겨둔다.
]);

// `--resolve-crowding` / `--octolinear` 모드는 DB가 필요 없다 — 아래 Supabase 필수 체크보다
// 먼저 갈라진다.
const resolveCrowdingMode = process.argv.includes('--resolve-crowding');
const octolinearArg = process.argv.find((a) => a.startsWith('--octolinear='));
const octolinearLineCodes = octolinearArg
  ? octolinearArg.slice('--octolinear='.length).split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  : [];
const outArg = process.argv.find((a) => a.startsWith('--out='));
const roundsArg = process.argv.find((a) => a.startsWith('--rounds='));
const minSegArg = process.argv.find((a) => a.startsWith('--min-seg='));
const octoRounds = roundsArg ? Number(roundsArg.slice('--rounds='.length)) : 60;
const offlineMode = resolveCrowdingMode || octolinearLineCodes.length > 0;

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!offlineMode && (!url || !serviceKey)) {
  console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  process.exit(1);
}
const db = offlineMode ? null : createClient(/** @type {string} */ (url), /** @type {string} */ (serviceKey), { auth: { persistSession: false } });

const lineArg = process.argv.find((a) => a.startsWith('--line='));
if (!offlineMode && !lineArg) {
  console.error(
    '사용법: --line=<lineCode>[,<lineCode>...] (예: --line=L-I1103,L-I4106)\n' +
      '     또는 --resolve-crowding\n' +
      '     또는 --octolinear=<lineCode>[,...] --out=<경로>',
  );
  process.exit(1);
}
if (octolinearLineCodes.length > 0 && !outArg) {
  // fixture 덮어쓰기를 사고로 하지 않도록 출력 경로를 반드시 명시하게 한다(§9 2026-08-31).
  console.error('--octolinear 는 --out=<경로> 가 필수입니다 (실험 산출물을 fixture와 분리하기 위함).');
  process.exit(1);
}
const targetLineCodes = lineArg ? lineArg.slice('--line='.length).split(',').map((s) => s.trim()).filter((s) => s.length > 0) : [];

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

// ── 2차 패스: 루프 경계 밀집 해소 ─────────────────────────────────────────────────
// 왜 필요한가: `pushOutsideLoop`는 반경(법선) 방향만 맞추고 접선(둘레) 방향은 그대로
// 둔다. 그 결과 루프 안쪽에서 서로 가까웠던 여러 노선의 역들이 같은 목표 반경으로
// 방사형으로만 밀려나면서, 스케일만 커진 채 원래의 상대적 근접함이 그대로 남는다.
// 디자이너가 독립 SVG 하니스로 루프 경계 전체를 진단해 밀집 지점 18곳을 찾았다
// (`docs/design/line-map-boundary-review.md`) — 국지적 문제가 아니라 구조적 결과라
// 18곳을 손으로 옮기는 대신 규칙화한다(다음 노선이 추가돼 새 밀집이 생겨도 재실행 대응).
//
// 알고리즘(문서 §3 그대로): ① 밀린 역(r≈1+LOOP_PUSH_MARGIN)을 추려 서로 다른 노선 +
// 거리 40 미만인 쌍을 연결 성분(union-find)으로 묶는다 → 지점(클러스터). ② 지점마다
// 대표 접선 방향을 구해 각 역을 접선(u)/법선(v) 좌표로 투영, 소속 노선별로 묶어 u
// 평균으로 정렬한다. ③ 인접한 두 노선 그룹의 u 간격이 목표(30 = 역 지름 22 + 여유 8)
// 미만이면 부족분을 계산해 접선 방향으로 나눠 미는데, **환승역은 절대 옮기지 않는다**
// (그 그룹의 "이동 가능 역"이 0개면 반대쪽이 부족분 전량을 흡수). ④ 한 그룹이 양쪽
// 모두 부족한 상태로 끼어 있으면(앞뒤로 낀 역) 그 그룹은 고정하고 바깥쪽 이웃들이
// 각자의 부족분을 전량 흡수한다 — 낀 역까지 옮기면 좌우로 반씩 상쇄되어 순이동이
// 거의 0이 되기 때문이다(문서 §2 지점#1 사례). 그래도 막히면(양쪽 다 못 옮기는 상태)
// 낀 역 자체를 두 부족분의 평균 방향으로 편도 이동하는 최후 수단을 쓴다.
const CROWD_MIN_GAP = 30;
const CROWD_CLUSTER_DIST = 40;
const CROWD_PUSHED_TOL = 0.03;

/**
 * @typedef {{ code: string, x: number, y: number, r: number, angle: number, primaryLine: string }} PushedStation
 */

/**
 * 현재 `doc` 상태에서 "밀린 역"과 그 연결 성분(밀집 지점)을 찾는다. 순수 조회 함수라
 * 해소 전/후 양쪽에 재사용해 몇 곳이 실제로 풀렸는지 검증하는 데 쓴다.
 * @param {GeomDoc} doc
 * @param {LoopEllipse} ellipse
 * @returns {{ pushed: PushedStation[], clusters: PushedStation[][] }}
 */
function detectCrowding(doc, ellipse) {
  /** @type {Map<string, string[]>} */
  const linesByCode = new Map();
  for (const line of doc.lines) {
    for (const code of line.stationCodes) {
      if (!linesByCode.has(code)) linesByCode.set(code, []);
      /** @type {string[]} */ (linesByCode.get(code)).push(line.lineCode);
    }
  }
  /** @type {Map<string, string>} */
  const primaryLineByCode = new Map();
  for (const line of doc.lines) {
    for (const code of line.stationCodes) {
      if (!primaryLineByCode.has(code)) primaryLineByCode.set(code, line.lineCode);
    }
  }

  const target = 1 + LOOP_PUSH_MARGIN;
  /** @type {PushedStation[]} */
  const pushed = [];
  for (const s of doc.stations) {
    const lines = linesByCode.get(s.stationCode) ?? [];
    if (lines.length === 1 && lines[0] === LOOP_LINE_CODE) continue; // 루프에만 속한 역은 대상 아님
    const dx = s.x - ellipse.cx;
    const dy = s.y - ellipse.cy;
    const r = Math.sqrt((dx / ellipse.rx) ** 2 + (dy / ellipse.ry) ** 2);
    if (Math.abs(r - target) > CROWD_PUSHED_TOL) continue;
    const line = primaryLineByCode.get(s.stationCode);
    if (line === undefined) continue;
    pushed.push({ code: s.stationCode, x: s.x, y: s.y, r, angle: Math.atan2(dy, dx), primaryLine: line });
  }

  /** @type {Map<string, string>} */
  const parent = new Map(pushed.map((p) => [p.code, p.code]));
  /** @param {string} x @returns {string} */
  function find(x) {
    let r = x;
    while (parent.get(r) !== r) r = /** @type {string} */ (parent.get(r));
    parent.set(x, r);
    return r;
  }
  /** @param {string} a @param {string} b */
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (let i = 0; i < pushed.length; i += 1) {
    for (let j = i + 1; j < pushed.length; j += 1) {
      const a = pushed[i], b = pushed[j];
      if (a.primaryLine === b.primaryLine) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < CROWD_CLUSTER_DIST) union(a.code, b.code);
    }
  }
  /** @type {Map<string, PushedStation[]>} */
  const byRoot = new Map();
  for (const p of pushed) {
    const root = find(p.code);
    if (!byRoot.has(root)) byRoot.set(root, []);
    /** @type {PushedStation[]} */ (byRoot.get(root)).push(p);
  }
  const clusters = [...byRoot.values()].filter((g) => g.length >= 2);
  return { pushed, clusters };
}

/**
 * `detectCrowding`이 찾은 지점 하나(연결 성분)를 실제로 해소한다. 호출자가 클러스터
 * 단위로 반복 호출한다 — 왜 단일 패스로 안 끝나는지는 `resolveCrowding` 주석 참고.
 * @param {GeomDoc} doc
 * @param {LoopEllipse} ellipse
 * @param {PushedStation[]} members
 * @param {(t: number) => Point} tangentAt
 * @param {(code: string) => boolean} isTransferCode
 * @param {Map<string, string>} primaryLineByCode
 * @param {Map<string, StationEntry>} stationByCode
 * @returns {{ movedCount: number, unresolvedCount: number }}
 */
function resolveCluster(doc, ellipse, members, tangentAt, isTransferCode, primaryLineByCode, stationByCode) {
  let movedCount = 0;
  let unresolvedCount = 0;

  const meanAngle = members.reduce((s, m) => s + m.angle, 0) / members.length;
  const tangent = tangentAt(meanAngle);
  const centroid = {
    x: members.reduce((s, m) => s + m.x, 0) / members.length,
    y: members.reduce((s, m) => s + m.y, 0) / members.length,
  };

  /** @type {Map<string, { code: string, u: number }[]>} */
  const byLine = new Map();
  for (const m of members) {
    const u = (m.x - centroid.x) * tangent.x + (m.y - centroid.y) * tangent.y;
    if (!byLine.has(m.primaryLine)) byLine.set(m.primaryLine, []);
    /** @type {{ code: string, u: number }[]} */ (byLine.get(m.primaryLine)).push({ code: m.code, u });
  }
  const groups = [...byLine.entries()]
    .map(([lineCode, ms]) => ({
      lineCode,
      codes: ms.map((m) => m.code),
      meanU: ms.reduce((s, m) => s + m.u, 0) / ms.length,
      movable: ms.map((m) => m.code).filter((c) => !isTransferCode(c)),
    }))
    .sort((a, b) => a.meanU - b.meanU);
  if (groups.length < 2) return { movedCount, unresolvedCount };

  const deficits = [];
  for (let i = 0; i < groups.length - 1; i += 1) {
    const gap = groups[i + 1].meanU - groups[i].meanU;
    if (gap < CROWD_MIN_GAP) deficits.push({ i, deficit: CROWD_MIN_GAP - gap });
  }
  if (deficits.length === 0) return { movedCount, unresolvedCount };

  const deficientLeft = new Array(groups.length).fill(false);
  const deficientRight = new Array(groups.length).fill(false);
  for (const d of deficits) { deficientRight[d.i] = true; deficientLeft[d.i + 1] = true; }
  // "앞뒤로 낀 역": 이동 가능한 역이 있어도 양쪽 모두 부족하면 일단 고정해 상쇄를 피한다.
  const pinned = groups.map((g, i) => g.movable.length === 0 || (deficientLeft[i] && deficientRight[i]));

  const deltaU = new Array(groups.length).fill(0);
  /** @type {{ i: number, deficit: number }[]} */
  const unresolved = [];
  for (const { i, deficit } of deficits) {
    const aMovable = !pinned[i];
    const bMovable = !pinned[i + 1];
    if (aMovable && bMovable) { deltaU[i] -= deficit / 2; deltaU[i + 1] += deficit / 2; }
    else if (aMovable && !bMovable) { deltaU[i] -= deficit; }
    else if (!aMovable && bMovable) { deltaU[i + 1] += deficit; }
    else unresolved.push({ i, deficit });
  }
  // 최후 수단: 양쪽 다 "고정"으로 판정돼 못 푼 쌍 — 진짜 환승역(이동 불가)이 아니라
  // 낀 것 때문에 고정됐던 쪽이 있으면 그 역만 편도로 민다(두 부족분이 겹치면 자연히
  // 합산돼 "평균 방향"에 가까워진다).
  for (const { i, deficit } of unresolved) {
    const candidates = [i, i + 1].filter((idx) => groups[idx].movable.length > 0);
    if (candidates.length === 0) {
      unresolvedCount += 1;
      console.warn(
        `  해소 못 함: ${groups[i].lineCode} ↔ ${groups[i + 1].lineCode} (부족 ${deficit.toFixed(1)}u, 양쪽 다 환승역뿐) — 이 클러스터 밖의 인접 구간을 사람이 봐야 함`,
      );
      continue;
    }
    const share = deficit / candidates.length;
    for (const idx of candidates) deltaU[idx] += (idx === i ? -1 : 1) * share;
  }

  for (let i = 0; i < groups.length; i += 1) {
    const du = deltaU[i];
    if (Math.abs(du) < 0.05) continue;
    const dx = tangent.x * du;
    const dy = tangent.y * du;
    for (const code of groups[i].movable) {
      const st = stationByCode.get(code);
      if (!st) continue;
      let nx = st.x + dx;
      let ny = st.y + dy;
      // 접선 방향 이동은 타원 위 한 점에서의 선형 근사라, 큰 델타가 누적되면 역이
      // 살짝 타원 안쪽으로 파고들 수 있다 — 매 이동 뒤 pushOutsideLoop로 반경을
      // 다시 확인해 루프 관통 회피 효과 자체는 절대 깨지지 않게 한다.
      const pushedBack = pushOutsideLoop({ x: nx, y: ny }, ellipse);
      nx = pushedBack.x; ny = pushedBack.y;
      st.x = round1(nx);
      st.y = round1(ny);
      // 이 역은 단일 노선에만 속한다(환승역이면 애초에 movable에서 제외됨) — 그
      // 노선의 polyline 한 곳만 동기화하면 된다.
      const owningLine = doc.lines.find((l) => l.lineCode === primaryLineByCode.get(code));
      const idx = owningLine?.stationCodes.indexOf(code) ?? -1;
      if (owningLine && idx !== -1) owningLine.polyline[idx] = [st.x, st.y];
      movedCount += 1;
    }
  }
  return { movedCount, unresolvedCount };
}

/**
 * 루프 경계 밀집을 해소한다. **여러 노선이 겹치는 구간에서는 한 번의 접선 이동으로
 * 안 끝난다** — 인접 쌍 하나를 벌리면 그 그룹이 이번엔 반대쪽의 "이전엔 멀쩡했던"
 * 다른 노선과 새로 붙는 경우가 실측으로 확인됐다(2026-08-25, 첫 구현 때 1회 패스로
 * 43→33쌍으로만 줄고 새 근접 쌍이 생기는 것을 발견). 그래서 지점을 다시 찾고 다시
 * 미는 과정을 **더 풀 지점이 없어질 때까지, 또는 최대 횟수까지** 반복한다 — 힘-완화
 * (force relaxation) 레이아웃과 같은 방식이다. 매 라운드 새 지점이 아예 안 나오면
 * (`clusters.length===0`) 그 즉시 멈춘다.
 * @param {GeomDoc} doc
 * @returns {{ clusterCount: number, movedCount: number, unresolvedCount: number, rounds: number }}
 */
function resolveCrowding(doc) {
  const ellipseOrNull = findLoopEllipse(doc.lines);
  if (!ellipseOrNull) {
    console.log('2호선 루프가 없어 밀집 해소를 건너뜁니다.');
    return { clusterCount: 0, movedCount: 0, unresolvedCount: 0, rounds: 0 };
  }
  // 클로저(tangentAt)에서도 non-null로 보이도록 좁혀진 참조를 별도 상수로 둔다 — TS는
  // 중첩 함수 안에서까지 바깥 스코프의 null 체크를 역추적해주지 않는다.
  const ellipse = ellipseOrNull;
  const MAX_ROUNDS = 12;

  let totalMoved = 0;
  let totalUnresolved = 0;
  let lastClusterCount = 0;
  let round = 0;

  for (; round < MAX_ROUNDS; round += 1) {
    /** @type {Map<string, string[]>} */
    const linesByCode = new Map();
    for (const line of doc.lines) {
      for (const code of line.stationCodes) {
        if (!linesByCode.has(code)) linesByCode.set(code, []);
        /** @type {string[]} */ (linesByCode.get(code)).push(line.lineCode);
      }
    }
    const isTransferCode = (/** @type {string} */ code) => (linesByCode.get(code) ?? []).length > 1;
    /** @type {Map<string, string>} */
    const primaryLineByCode = new Map();
    for (const line of doc.lines) {
      for (const code of line.stationCodes) {
        if (!primaryLineByCode.has(code)) primaryLineByCode.set(code, line.lineCode);
      }
    }
    /** @param {number} t @returns {Point} 타원 매개변수 t 에서의 접선 단위벡터 */
    function tangentAt(t) {
      const dx = -ellipse.rx * Math.sin(t);
      const dy = ellipse.ry * Math.cos(t);
      const len = Math.hypot(dx, dy);
      return { x: dx / len, y: dy / len };
    }

    const { clusters } = detectCrowding(doc, ellipse);
    lastClusterCount = clusters.length;
    if (clusters.length === 0) break;

    const stationByCode = new Map(doc.stations.map((s) => [s.stationCode, s]));
    let roundMoved = 0;
    for (const members of clusters) {
      const { movedCount, unresolvedCount } = resolveCluster(
        doc, ellipse, members, tangentAt, isTransferCode, primaryLineByCode, stationByCode,
      );
      roundMoved += movedCount;
      totalMoved += movedCount;
      totalUnresolved += unresolvedCount;
    }
    console.log(`  라운드 ${round + 1}: 지점 ${clusters.length}개, 역 ${roundMoved}개 이동`);
    if (roundMoved === 0) break; // 더 밀 수 있는 게 없는데 지점만 남으면(전부 unresolved) 무한루프 방지
  }

  return { clusterCount: lastClusterCount, movedCount: totalMoved, unresolvedCount: totalUnresolved, rounds: round + 1 };
}

// ── 3차 패스: 옥토리니어(0°/45°/90°) 스냅 ──────────────────────────────────────────
// 왜 넣었는가: 서울시 공식 노선도를 비롯한 대부분의 도시철도 노선도는 옥토리니어 도식이다
// (선이 45도 배수로만 꺾인다). 지금 우리 좌표는 실 위경도를 유사변환한 것이라 선분 각도가
// 제각각이고, 그래서 "지도를 축소한 그림"으로 보이지 "노선도"로 보이지 않는다.
// 03-line-map.md §9 (2026-08-31, B안) — 이미 확보한 실좌표 배치를 버리지 않고 각도만
// 스냅하는 후처리 패스로 접근한다. `pushOutsideLoop`·`--resolve-crowding`과 같은 급의
// 실용적 휴리스틱이지 전역 최적해가 아니다(그건 LOOM 같은 전용 도구의 영역이다).
//
// 위상 보존: 역의 인접 관계와 순서는 `stationCodes` 배열 그대로 유지하고 좌표만 옮긴다 —
// 순서를 바꾸거나 역을 빼는 일이 없으므로 위상은 정의상 깨지지 않는다.
//
// **이 패스 뒤에 `--resolve-crowding`을 이어 돌리지 마라.** 그 패스는 2호선 루프 타원의
// 특정 반경(r≈1.12)에 놓인 역만 접선 방향으로 미는 것이라, 옥토리니어 결과 위에서는 각도만
// 망가뜨린다 — 실측(2026-08-31)으로 겹침 쌍 11 → 13, 격자 이탈 선분 56 → 63, 2호선 8각형이
// 13선분 어긋남으로 무너졌다. 겹침 해소는 아래 1단계 완화 안의 반발항이 대신 맡는다.

// 역 지름(2×STATION_R=22) + 여유 4. 이보다 짧은 선분은 만들지 않는다. `--min-seg=` 로 올릴 수
// 있게 해 둔 이유는 33개 노선 전체 확대 때 "선분 하한을 올리면 노선 간 겹침이 줄어드는가"를
// 실측으로 비교해야 했기 때문이다(2026-08-31 확대 라운드).
let octoMinSeg = 26;
if (minSegArg) octoMinSeg = Number(minSegArg.slice('--min-seg='.length));
const SQRT1_2 = Math.SQRT1_2;
/** 45도 배수 단위벡터 8개. `Math.cos(Math.PI/2)`가 6.1e-17을 돌려주는 부동소수점 찌꺼기를
 * 좌표에 누적시키지 않으려고 표로 박아둔다 — 찌꺼기가 쌓이면 "수직인데 x가 조금씩 밀리는"
 * 선분이 생겨 스냅한 의미가 없어진다. 인덱스는 atan2 기준 0°,45°,…,315°(SVG는 y축이 아래로
 * 향하므로 화면상으로는 시계방향). */
const OCTO_UNITS = /** @type {Point[]} */ ([
  { x: 1, y: 0 }, { x: SQRT1_2, y: SQRT1_2 }, { x: 0, y: 1 }, { x: -SQRT1_2, y: SQRT1_2 },
  { x: -1, y: 0 }, { x: -SQRT1_2, y: -SQRT1_2 }, { x: 0, y: -1 }, { x: SQRT1_2, y: -SQRT1_2 },
]);

/** @param {number} dx @param {number} dy @returns {Point} 가장 가까운 45도 배수 단위벡터 */
function snapUnit(dx, dy) {
  const k = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return OCTO_UNITS[((k % 8) + 8) % 8];
}

/**
 * 방향(`dirs`)을 고정한 채 선분 길이만 다시 정한다.
 *
 * 자유 체인(양 끝이 아무 데도 안 묶인 노선)은 원래 길이를 그대로 쓰면 되지만, 두 경우는
 * 체인의 시작→끝 변위가 **미리 정해져 있다**: ① 순환선(2호선)은 마지막 선분이 첫 역으로
 * 정확히 돌아와야 하고(변위 0), ② 이미 확정된 환승역 두 개 사이에 낀 구간은 그 두 점을
 * 정확히 이어야 한다(변위 = 끝점 − 시작점). 방향을 스냅한 순간 Σ(L_i·u_i) ≠ 변위가 되어
 * 그냥 이어 붙이면 루프가 벌어지거나 구간이 환승역에서 떨어져 나간다.
 *
 * 그래서 "원래 길이에서 가장 덜 벗어나면서 제약을 만족하는 길이 조합"을 라그랑주 승수로
 * 푼다: min Σ(L'_i−L_i)² s.t. Σ L'_i·u_i = T → L'_i = L_i + λ·u_i,
 * λ = M⁻¹·(T − Σ(L_i·u_i)), M = Σ u_i u_iᵀ. 오차를 방향별로 "덜 저항하는 선분"에 자동
 * 배분하는 효과가 있어, 한 선분에 몰아서 보정할 때 생기는 뒤틀림이 없다.
 *
 * 길이가 음수/과소로 떨어지는 선분은 `octoMinSeg`로 고정하고 나머지만 다시 푼다(능동
 * 제약 집합법). 반복 상한은 선분 수 — 매 반복마다 최소 1개가 고정되므로 반드시 끝난다.
 * @param {number[]} baseLengths
 * @param {Point[]} dirs
 * @param {Point | null} target 체인의 시작→끝 변위 제약. null 이면 제약 없음.
 * @returns {{ lengths: number[], clampedCount: number, closureError: number }}
 */
function solveOctolinearLengths(baseLengths, dirs, target) {
  const n = baseLengths.length;
  const lengths = baseLengths.map((l) => Math.max(l, octoMinSeg));
  if (!target) return { lengths, clampedCount: 0, closureError: 0 };

  const clamped = new Array(n).fill(false);
  for (let iter = 0; iter <= n; iter += 1) {
    let m00 = 0, m01 = 0, m11 = 0, freeSumX = 0, freeSumY = 0, fixedSumX = 0, fixedSumY = 0;
    for (let i = 0; i < n; i += 1) {
      const u = dirs[i];
      if (clamped[i]) { fixedSumX += octoMinSeg * u.x; fixedSumY += octoMinSeg * u.y; continue; }
      m00 += u.x * u.x; m01 += u.x * u.y; m11 += u.y * u.y;
      freeSumX += baseLengths[i] * u.x; freeSumY += baseLengths[i] * u.y;
    }
    const rx = target.x - fixedSumX - freeSumX;
    const ry = target.y - fixedSumY - freeSumY;
    const det = m00 * m11 - m01 * m01;
    if (Math.abs(det) < 1e-9) {
      // 자유 선분의 방향이 한 직선에 몰린 퇴화 케이스 — 제약을 만족시킬 자유도가 없다.
      // 남은 오차는 호출자(snapChain)가 구간 전체에 선형 분배해 접합만은 살린다.
      break;
    }
    const lx = (m11 * rx - m01 * ry) / det;
    const ly = (-m01 * rx + m00 * ry) / det;
    let worst = -1;
    for (let i = 0; i < n; i += 1) {
      if (clamped[i]) { lengths[i] = octoMinSeg; continue; }
      lengths[i] = baseLengths[i] + lx * dirs[i].x + ly * dirs[i].y;
      if (lengths[i] < octoMinSeg && (worst === -1 || lengths[i] < lengths[worst])) worst = i;
    }
    if (worst === -1) break;
    clamped[worst] = true;
    lengths[worst] = octoMinSeg;
  }

  let ex = 0, ey = 0;
  for (let i = 0; i < n; i += 1) { ex += lengths[i] * dirs[i].x; ey += lengths[i] * dirs[i].y; }
  return {
    lengths,
    clampedCount: clamped.filter(Boolean).length,
    closureError: Math.hypot(ex - target.x, ey - target.y),
  };
}

/**
 * 좌표열 하나를 옥토리니어 체인으로 재구성한다. **파일을 건드리지 않는 순수 함수**라
 * 완화 반복(제안만 계산)과 확정 패스가 같은 코드를 공유한다.
 *
 * 기준점 정렬 규칙: 시작이 고정이면 시작점을, 끝만 고정이면 끝점을, 아무것도 고정이 아니면
 * **무게중심**을 원래 위치에 맞춘다. 자유 체인에서 첫 역을 기준으로 잡으면 스냅 오차가 전부
 * 반대쪽 끝에 쌓여 노선 전체가 한쪽으로 밀린 것처럼 보이는데, 무게중심이면 양쪽으로 갈린다.
 * @param {Point[]} pts
 * @param {{ closed?: boolean, startFixed?: boolean, endFixed?: boolean }} opts
 * @returns {{ pts: Point[], residual: number, clampedCount: number }}
 */
function snapChain(pts, opts) {
  const closed = opts.closed === true;
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  if (segCount < 1) return { pts: pts.map((p) => ({ ...p })), residual: 0, clampedCount: 0 };

  /** @type {number[]} */
  const baseLengths = [];
  /** @type {Point[]} */
  const dirs = [];
  for (let i = 0; i < segCount; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    baseLengths.push(Math.hypot(b.x - a.x, b.y - a.y));
    dirs.push(snapUnit(b.x - a.x, b.y - a.y));
  }

  const bothFixed = opts.startFixed === true && opts.endFixed === true;
  const target = closed
    ? { x: 0, y: 0 }
    : bothFixed
      ? { x: pts[n - 1].x - pts[0].x, y: pts[n - 1].y - pts[0].y }
      : null;
  const { lengths, clampedCount } = solveOctolinearLengths(baseLengths, dirs, target);

  /** @type {Point[]} */
  const rebuilt = [{ x: 0, y: 0 }];
  for (let i = 0; i < n - 1; i += 1) {
    const prev = rebuilt[i];
    rebuilt.push({ x: prev.x + lengths[i] * dirs[i].x, y: prev.y + lengths[i] * dirs[i].y });
  }

  let ox;
  let oy;
  if (opts.startFixed) { ox = pts[0].x; oy = pts[0].y; }
  else if (opts.endFixed) { ox = pts[n - 1].x - rebuilt[n - 1].x; oy = pts[n - 1].y - rebuilt[n - 1].y; }
  else {
    const oldC = { x: pts.reduce((s, q) => s + q.x, 0) / n, y: pts.reduce((s, q) => s + q.y, 0) / n };
    const newC = { x: rebuilt.reduce((s, q) => s + q.x, 0) / n, y: rebuilt.reduce((s, q) => s + q.y, 0) / n };
    ox = oldC.x - newC.x; oy = oldC.y - newC.y;
  }
  for (const q of rebuilt) { q.x += ox; q.y += oy; }

  let residual = closed ? Math.hypot(
    rebuilt[n - 1].x + lengths[n - 1] * dirs[n - 1].x - rebuilt[0].x,
    rebuilt[n - 1].y + lengths[n - 1] * dirs[n - 1].y - rebuilt[0].y,
  ) : 0;
  if (bothFixed) {
    // 방향 집합이 퇴화해 제약을 정확히 못 맞춘 경우(예: 자유 선분이 전부 같은 방향)
    // 남은 오차를 구간 전체에 선형 분배한다. **각도가 조금 틀어지더라도 환승역에서
    // 선이 끊어지는 것만은 절대 만들지 않는다** — 끊긴 선은 명백한 렌더 버그로 보인다.
    const ex = rebuilt[n - 1].x - pts[n - 1].x;
    const ey = rebuilt[n - 1].y - pts[n - 1].y;
    residual = Math.hypot(ex, ey);
    if (residual > 1e-6) {
      for (let i = 1; i < n; i += 1) {
        rebuilt[i].x -= (ex * i) / (n - 1);
        rebuilt[i].y -= (ey * i) / (n - 1);
      }
    }
  }
  return { pts: rebuilt, residual, clampedCount };
}

/**
 * 역 하나의 좌표를 옮기고, **그 역을 지나는 모든 노선의 polyline을 함께 갱신한다.**
 * 환승역은 여러 노선이 같은 좌표를 참조하므로 이걸 빼먹으면 다른 노선이 그 역에서 떨어져
 * 나간다(`docs/design/line-map-boundary-review.md` §3-5의 지시 사항).
 *
 * polyline이 stationCodes와 인덱스가 일치하지 않는 노선이 있다(예: 2호선 루프는 역 사이에
 * 보간점이 3개씩 들어간 130점 곡선, 성수/신정지선은 손으로 넣은 접속점이 1개 더 있다).
 * 그래서 인덱스가 아니라 **옛 좌표와 가장 가까운 polyline 점**을 찾아 바꾼다.
 * @param {GeomDoc} d
 * @param {string} code
 * @param {Point} oldPt
 * @param {Point} newPt
 * @param {Set<string>} skipLineCodes polyline을 통째로 다시 만들 노선(중복 갱신 방지)
 * @returns {string[]} 실제로 polyline을 고친 다른 노선의 lineCode 목록
 */
function moveStationWithPolylines(d, code, oldPt, newPt, skipLineCodes) {
  /** @type {string[]} */
  const touched = [];
  for (const line of d.lines) {
    if (skipLineCodes.has(line.lineCode)) continue;
    if (!line.stationCodes.includes(code)) continue;
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < line.polyline.length; i += 1) {
      const dd = Math.hypot(line.polyline[i][0] - oldPt.x, line.polyline[i][1] - oldPt.y);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    // 0.6 = round1(소수 1자리 반올림)로 생길 수 있는 최대 오차보다 약간 큰 값. 이보다 멀면
    // 그 노선의 polyline에는 애초에 이 역에 해당하는 꼭짓점이 없다는 뜻이라 건드리지 않는다.
    if (best === -1 || bestD > 0.6) continue;
    line.polyline[best] = [round1(newPt.x), round1(newPt.y)];
    touched.push(line.lineCode);
  }
  const st = d.stations.find((s) => s.stationCode === code);
  if (st) { st.x = round1(newPt.x); st.y = round1(newPt.y); }
  return touched;
}

/**
 * 노선 하나가 순환선인가. polyline의 첫/끝점이 같은지로 판정한다 — 실 데이터에서 이 형태인
 * 것은 2호선 본선(L-S1102) 하나뿐이다. **스냅으로 polyline을 다시 만들기 전에** 한 번만
 * 계산해 둬야 한다(다시 만든 뒤에도 닫힘 점을 붙여주긴 하지만, 판정 기준이 산출물에
 * 의존하게 두면 재실행 시 조용히 깨질 여지가 생긴다).
 * @param {LineEntry} line
 * @returns {boolean}
 */
function isClosedLine(line) {
  const first = line.polyline[0];
  const last = line.polyline[line.polyline.length - 1];
  return line.polyline.length > 2 && first[0] === last[0] && first[1] === last[1];
}

// ── 33개 노선 전역 스냅: 환승역이 노선마다 다른 좌표를 갖지 않게 하는 두 단계 ──────────
//
// 파일럿(2호선 단독)은 "한 노선을 스냅하고 환승역이 움직이면 다른 노선의 polyline을 따라
// 움직이게 한다"는 방식이었다. 33개를 그 방식으로 연달아 돌리면 **나중에 처리한 노선이
// 앞 노선의 각도를 되돌려놓는다** — 환승역 좌표는 파일 구조상 언제나 1개지만(`stations[]`가
// 역당 한 행이라 물리적으로 갈라질 수 없다), "누가 마지막에 만졌는가"가 결과를 지배해
// 노선 절반이 옥토리니어가 아니게 된다.
//
// 그래서 두 단계로 나눈다.
//   1단계(전역 완화): 모든 노선이 **동시에** 자기 이상적 옥토리니어 배치를 제안하고, 환승역은
//     그 제안들의 평균으로 이동한다(Jacobi 반복 + 감쇠). 어느 노선도 특권을 갖지 않으므로
//     "처리 순서에 따라 결과가 달라지는" 문제 자체가 사라진다. 여러 라운드를 돌리면 전역적으로
//     거의 옥토리니어인 상태로 수렴한다 — 다만 "거의"라서 각도가 미세하게 틀어져 있다.
//   2단계(확정): 그 상태를 출발점으로, 노선을 **환승역 많은 순서**로 처리하며 각 노선을 정확한
//     45° 배수로 확정하고 그 역들을 얼린다. 뒤에 오는 노선은 이미 얼린 환승역 사이 구간을
//     `solveOctolinearLengths`의 변위 제약으로 정확히 이어붙인다. 환승역 많은 노선을 먼저
//     두는 이유는, 그런 노선일수록 나중에 처리되면 제약이 많아 형태가 망가지기 때문이다.
//
// 남는 한계: **이미 얼린 환승역 두 개가 노선상 바로 이웃한 구간**(예: 시청↔서울역)은 자유도가
// 0이라 45°로 만들 방법이 없다. 1단계가 그 구간까지 거의 옥토리니어로 만들어 두므로 실제
// 잔차는 작지만 0은 아니다. 이 잔차 구간 수는 실행 로그에 그대로 찍어 사람이 보게 한다.
/** 완화 감쇠 계수. 1.0(제안 전체 반영)이면 환승역이 노선 사이를 왕복하며 진동한다 — 실측으로
 * 0.6~0.7 부근이 라운드당 이동량이 단조 감소했다. */
const OCTO_DAMPING = 0.65;
/** 서로 다른 역이 이만큼보다 가까워지면 완화 중에 밀어낸다. 역 원 지름 22 + 여유 4.
 * 이게 없으면 45° 스냅이 도심부를 압축하면서 서로 다른 노선의 역이 **정확히 같은 점**에
 * 겹친다(2026-08-31 실측: 겹침 쌍 39 → 57, 그중 7쌍이 거리 0.5 미만). 밀집 해소를 별도
 * 3차 패스로 두지 않고 완화 안에 넣은 이유는, 스냅이 끝난 뒤에 역을 옮기면 그 순간 각도가
 * 격자에서 벗어나기 때문이다 — 같은 반복 안에서 두 요구를 함께 타협시켜야 한다. */
const OCTO_MIN_GAP = 26;
/** 2단계가 역 사이 거리를 이 값 아래로 좁히면 그 구간의 확정을 포기한다. 역 원 지름(22)이
 * 아니라 그보다 2px 낮은 값인 이유: 22를 그대로 쓰면 "22.1 → 20.3"처럼 사실상 안 보이는
 * 2px 접근 때문에 2호선 루프 전체(43선분)의 확정이 통째로 날아갔다(2026-08-31 실측).
 * 20이면 원이 1px씩 겹치는 정도라 육안으로 구분되지 않는다. */
const OCTO_OVERLAP_FLOOR = 20;

/**
 * @param {GeomDoc} d
 * @param {string[]} lineCodes 스냅 대상 노선
 * @param {number} rounds 1단계 완화 최대 라운드
 * @returns {{ frozenResiduals: { lineCode: string, index: number, residual: number }[],
 *   pinnedPairs: number, clampedCount: number, maxShift: number, rejectedRuns: number }}
 */
function octolinearizeAll(d, lineCodes, rounds) {
  const targets = lineCodes
    .map((c) => d.lines.find((l) => l.lineCode === c))
    .filter((l) => l !== undefined);
  /** @type {Map<string, boolean>} */
  const closedBy = new Map(d.lines.map((l) => [l.lineCode, isClosedLine(l)]));
  /** @type {Map<string, Point>} 실행 시작 시점 좌표 — 비대상 노선 polyline 동기화의 기준점 */
  const origPos = new Map(d.stations.map((s) => [s.stationCode, { x: s.x, y: s.y }]));
  /** @type {Map<string, Point>} */
  const pos = new Map(d.stations.map((s) => [s.stationCode, { x: s.x, y: s.y }]));

  // ── 1단계: 전역 완화 ──
  // **선분 단위 국소 완화**다. 처음에는 "노선마다 이상적 옥토리니어 체인을 통째로 만들어
  // 평균낸다"로 짰는데 발산했다(라운드당 최대 이동이 42 → 133으로 오히려 커졌다, 2026-08-31
  // 실측). 이유: 체인을 첫 역부터 누적해 다시 그리면 앞쪽 선분의 미세한 각도 오차가 뒤로 갈수록
  // 증폭돼, 56역짜리 5호선 같은 긴 노선의 끝이 수백 px씩 휘둘린다. 그 값이 환승역을 통해 다른
  // 노선으로 전파되면서 되먹임 발진이 됐다.
  //
  // 지금 방식은 누적이 없다. 선분 하나하나를 독립적으로 보고 "이 선분이 45° 방향 u에 놓이려면
  // 양 끝이 각각 어디로 가야 하는가"를 구해, 역마다 자기에게 걸린 모든 선분의 요구를 평균내
  // 조금씩(감쇠) 움직인다. 선분 하나의 보정은 양 끝에 크기가 같고 부호가 반대라 **전체 무게중심이
  // 보존되고**, 오차가 확산(diffusion)될 뿐 증폭되지 않는다. 순환선의 닫힘도 별도 제약 없이
  // 자동으로 지켜진다 — 루프는 그래프상 하나의 사이클이라 완화가 최소자승 타협점을 찾는다.
  let rounds1 = 0;
  /** @type {[string, string][]} 겹침 후보 쌍. 수천 라운드를 도는 루프라 매 라운드 새 배열을
   * 만들지 않고 하나를 비워 재사용한다. */
  const pairs = [];
  for (let r = 0; r < rounds; r += 1) {
    rounds1 = r + 1;
    /** @type {Map<string, { x: number, y: number, n: number }>} */
    const corr = new Map();
    /** @param {string} code @param {number} dx @param {number} dy */
    const add = (code, dx, dy) => {
      const c = corr.get(code) ?? { x: 0, y: 0, n: 0 };
      c.x += dx; c.y += dy; c.n += 1;
      corr.set(code, c);
    };
    for (const line of targets) {
      const codes = line.stationCodes;
      const n = codes.length;
      if (n < 2) continue;
      const segCount = closedBy.get(line.lineCode) ? n : n - 1;
      for (let i = 0; i < segCount; i += 1) {
        const ca = codes[i];
        const cb = codes[(i + 1) % n];
        const a = /** @type {Point} */ (pos.get(ca));
        const b = /** @type {Point} */ (pos.get(cb));
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const u = snapUnit(dx, dy);
        const len = Math.max(Math.hypot(dx, dy), octoMinSeg);
        const ex = dx - len * u.x;
        const ey = dy - len * u.y;
        add(ca, ex / 2, ey / 2);
        add(cb, -ex / 2, -ey / 2);
      }
    }

    // 겹침 반발. 646역을 전수 비교하면 라운드당 20만 쌍이라 수천 라운드를 못 돌린다 —
    // OCTO_MIN_GAP 크기의 격자에 역을 담고 자기 칸 + 이웃 8칸만 본다(그보다 먼 쌍은 정의상
    // 임계 거리 밖이다).
    /** @type {Map<string, string[]>} */
    const buckets = new Map();
    for (const [code, p] of pos) {
      const key = `${Math.floor(p.x / OCTO_MIN_GAP)},${Math.floor(p.y / OCTO_MIN_GAP)}`;
      const b = buckets.get(key);
      if (b) b.push(code); else buckets.set(key, [code]);
    }
    for (const [key, members] of buckets) {
      const [bx, by] = key.split(',').map(Number);
      /** @type {string[]} */
      const near = [];
      for (let ox = 0; ox <= 1; ox += 1) {
        for (let oy = ox === 0 ? 0 : -1; oy <= 1; oy += 1) {
          if (ox === 0 && oy === 0) continue;
          near.push(...(buckets.get(`${bx + ox},${by + oy}`) ?? []));
        }
      }
      // 같은 칸 안의 쌍(i<j)만 자기 자신과 비교하고, 이웃 칸은 절반 방향(오른쪽·아래)만 봐서
      // 같은 쌍을 두 번 세지 않는다.
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) pairs.push([members[i], members[j]]);
        for (const other of near) pairs.push([members[i], other]);
      }
    }
    for (const [ca, cb] of pairs) {
      const a = /** @type {Point} */ (pos.get(ca));
      const b = /** @type {Point} */ (pos.get(cb));
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= OCTO_MIN_GAP) continue;
      if (dist < 1e-6) { dx = 1; dy = 0; } // 완전히 겹친 상태에선 밀 방향이 없다 — 임의로 x축
      const need = OCTO_MIN_GAP - Math.max(dist, 1e-6);
      const ux = dx / Math.max(dist, 1e-6);
      const uy = dy / Math.max(dist, 1e-6);
      add(ca, (-ux * need) / 2, (-uy * need) / 2);
      add(cb, (ux * need) / 2, (uy * need) / 2);
    }
    pairs.length = 0;

    let maxMove = 0;
    for (const [code, c] of corr) {
      const cur = /** @type {Point} */ (pos.get(code));
      const mx = (OCTO_DAMPING * c.x) / c.n;
      const my = (OCTO_DAMPING * c.y) / c.n;
      maxMove = Math.max(maxMove, Math.hypot(mx, my));
      pos.set(code, { x: cur.x + mx, y: cur.y + my });
    }
    if (maxMove < 0.02) break; // 0.02 = 저장 해상도(0.1)의 1/5. 그 아래는 파일에 남지도 않는다
  }
  console.log(`  1단계 전역 완화: ${rounds1}라운드`);

  // ── 2단계: 확정 ──
  /** @type {Map<string, number>} */
  const lineCountByStation = new Map();
  for (const line of d.lines) {
    for (const c of line.stationCodes) lineCountByStation.set(c, (lineCountByStation.get(c) ?? 0) + 1);
  }
  const order = [...targets].sort((a, b) => {
    const ta = a.stationCodes.filter((c) => (lineCountByStation.get(c) ?? 1) > 1).length;
    const tb = b.stationCodes.filter((c) => (lineCountByStation.get(c) ?? 1) > 1).length;
    return tb - ta || b.stationCodes.length - a.stationCodes.length;
  });

  /** @type {Set<string>} */
  const frozen = new Set();
  /** @type {{ lineCode: string, index: number, residual: number }[]} */
  const frozenResiduals = [];
  let pinnedPairs = 0;
  let clampedCount = 0;
  let rejectedRuns = 0;

  for (const line of order) {
    const codes = line.stationCodes;
    const n = codes.length;
    const pts = codes.map((c) => ({ .../** @type {Point} */ (pos.get(c)) }));
    // 확정 결과를 그대로 받으면 **1단계가 벌려놓은 역이 다시 겹친다** — 첫 구현에서 겹침 쌍이
    // 1단계 직후 3건에서 25건으로(그중 1건은 거리 0으로 완전히 포개짐) 늘어나는 것을 실측했다.
    // 각도를 0.4°에서 0.2°로 다듬는 대가로 역 원이 포개지는 건 명백히 손해라(1° 어긋난 선은
    // 아무도 못 알아보지만 겹친 역 원은 바로 보인다), 겹침을 새로 만드는 구간은 통째로 버리고
    // 1단계 좌표를 그대로 쓴다.
    /** @param {Point[]} next @param {number} from @returns {boolean} */
    const createsOverlap = (next, from) => {
      for (let i = 0; i < next.length; i += 1) {
        const code = codes[from + i];
        for (const [other, op] of pos) {
          if (other === code) continue;
          const oi = codes.indexOf(other);
          const q = oi >= from && oi < from + next.length ? next[oi - from] : op;
          const nd = Math.hypot(next[i].x - q.x, next[i].y - q.y);
          if (nd >= OCTO_OVERLAP_FLOOR) continue;
          const cur = /** @type {Point} */ (pos.get(code));
          if (nd < Math.hypot(cur.x - q.x, cur.y - q.y)) return true;
        }
      }
      return false;
    };

    // 통째로 버리는 대신 "1단계 좌표 ↔ 정확한 격자 좌표" 사이를 선형 보간해 겹침이 생기지 않는
    // 가장 큰 비율을 쓴다. 전부 아니면 전무로 하면 2호선 루프처럼 역이 많은 노선이 딱 한 쌍의
    // 겹침 때문에 개선을 통째로 잃는다(실측: 루프 43선분 중 14개가 격자에서 벗어난 채 남았다).
    /** @type {number[]} */
    const BLEND_STEPS = [1, 0.75, 0.5, 0.25];
    /** @param {Point[]} exact @param {Point[]} base @param {number} from @returns {Point[] | null} */
    const bestBlend = (exact, base, from) => {
      for (const t of BLEND_STEPS) {
        const blended = exact.map((q, i) => ({
          x: base[i].x + (q.x - base[i].x) * t,
          y: base[i].y + (q.y - base[i].y) * t,
        }));
        if (!createsOverlap(blended, from)) return t === 1 ? exact : blended;
      }
      return null;
    };

    /** @param {number} from @param {number} to @param {{ startFixed?: boolean, endFixed?: boolean }} o */
    const applyRun = (from, to, o) => {
      const sub = pts.slice(from, to + 1);
      if (sub.length < 2) return;
      const res = snapChain(sub, o);
      const accepted = bestBlend(res.pts, sub, from);
      if (!accepted) { rejectedRuns += 1; return; }
      clampedCount += res.clampedCount;
      if (res.residual > 0.5) frozenResiduals.push({ lineCode: line.lineCode, index: from, residual: res.residual });
      for (let i = 0; i < sub.length; i += 1) pts[from + i] = accepted[i];
    };

    if (n < 2) { /* 역 1개짜리 노선은 스냅할 선분이 없다 */ }
    else if (closedBy.get(line.lineCode)) {
      // 순환선은 구간 분할이 불가능하다(어디를 잘라도 닫힘 제약이 깨진다) — 통째로 스냅한다.
      // 환승역 많은 순 정렬 덕에 2호선이 첫 번째라 얼린 역이 아직 없다.
      const res = snapChain(pts, { closed: true });
      const accepted = bestBlend(res.pts, pts.map((p) => ({ ...p })), 0);
      if (!accepted) rejectedRuns += 1;
      else {
        clampedCount += res.clampedCount;
        if (res.residual > 0.5) frozenResiduals.push({ lineCode: line.lineCode, index: 0, residual: res.residual });
        for (let i = 0; i < n; i += 1) pts[i] = accepted[i];
      }
    } else {
      const fixed = codes.map((c, i) => (frozen.has(c) ? i : -1)).filter((i) => i >= 0);
      if (fixed.length === 0) applyRun(0, n - 1, {});
      else {
        if (fixed[0] > 0) applyRun(0, fixed[0], { endFixed: true });
        for (let k = 0; k < fixed.length - 1; k += 1) {
          if (fixed[k + 1] === fixed[k] + 1) { pinnedPairs += 1; continue; } // 자유도 0 — 손댈 수 없다
          applyRun(fixed[k], fixed[k + 1], { startFixed: true, endFixed: true });
        }
        if (fixed[fixed.length - 1] < n - 1) applyRun(fixed[fixed.length - 1], n - 1, { startFixed: true });
      }
    }

    for (let i = 0; i < n; i += 1) { pos.set(codes[i], pts[i]); frozen.add(codes[i]); }
  }

  // ── 반영: 좌표 → stations[] / 대상 노선 polyline 재생성 / 비대상 노선 polyline 동기화 ──
  let maxShift = 0;
  for (const s of d.stations) {
    const p = /** @type {Point} */ (pos.get(s.stationCode));
    const o = /** @type {Point} */ (origPos.get(s.stationCode));
    maxShift = Math.max(maxShift, Math.hypot(p.x - o.x, p.y - o.y));
  }
  const targetCodes = new Set(targets.map((l) => l.lineCode));
  for (const s of d.stations) {
    const p = /** @type {Point} */ (pos.get(s.stationCode));
    const o = /** @type {Point} */ (origPos.get(s.stationCode));
    if (Math.abs(p.x - o.x) < 0.05 && Math.abs(p.y - o.y) < 0.05) continue;
    moveStationWithPolylines(d, s.stationCode, o, p, targetCodes);
  }
  for (const line of targets) {
    // 옥토리니어에서 역 사이는 직선이므로 곡선 보간점(2호선 루프의 역당 3점)과 손으로 넣은
    // 접속점(성수/신정지선의 1점)을 버리고 역 좌표만으로 polyline을 다시 만든다. 결과적으로
    // 33개 노선 전부가 "polyline 길이 == 역 수(+순환선 닫힘 점 1)"라는 단순한 형태가 된다.
    line.polyline = line.stationCodes.map((c) => {
      const p = /** @type {Point} */ (pos.get(c));
      return /** @type {[number, number]} */ ([round1(p.x), round1(p.y)]);
    });
    if (closedBy.get(line.lineCode)) line.polyline.push([...line.polyline[0]]);
  }
  for (const s of d.stations) {
    const p = /** @type {Point} */ (pos.get(s.stationCode));
    s.x = round1(p.x); s.y = round1(p.y);
  }

  return { frozenResiduals, pinnedPairs, clampedCount, maxShift, rejectedRuns };
}

/**
 * 결과 품질 지표. "각도가 실제로 45° 배수인가"와 "역 원이 얼마나 겹치는가" 두 가지를
 * 같은 기준으로 스냅 전/후에 각각 재서 비교한다.
 * @param {GeomDoc} d
 * @returns {{ segments: number, offGrid: number, meanDev: number, maxDev: number,
 *   minSeg: number, overlapPairs: number }}
 */
function octolinearStats(d) {
  const byCode = new Map(d.stations.map((s) => [s.stationCode, s]));
  let segments = 0, offGrid = 0, sumDev = 0, maxDev = 0;
  let minSeg = Number.POSITIVE_INFINITY;
  for (const line of d.lines) {
    const closed = isClosedLine(line);
    const n = line.stationCodes.length;
    for (let i = 0; i < (closed ? n : n - 1); i += 1) {
      const a = byCode.get(line.stationCodes[i]);
      const b = byCode.get(line.stationCodes[(i + 1) % n]);
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-6) continue;
      minSeg = Math.min(minSeg, len);
      const raw = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const dev = Math.abs(raw - Math.round(raw / 45) * 45);
      segments += 1; sumDev += dev; maxDev = Math.max(maxDev, dev);
      // 1° = 길이 26 선분에서 0.45px. round1(0.1 단위)만으로도 0.2° 안팎이 생기므로
      // 그보다 넉넉한 1°를 "격자에서 벗어남"의 기준으로 잡는다.
      if (dev > 1) offGrid += 1;
    }
  }
  let overlapPairs = 0;
  for (let i = 0; i < d.stations.length; i += 1) {
    for (let j = i + 1; j < d.stations.length; j += 1) {
      if (Math.hypot(d.stations[i].x - d.stations[j].x, d.stations[i].y - d.stations[j].y) < 22) overlapPairs += 1;
    }
  }
  return { segments, offGrid, meanDev: segments ? sumDev / segments : 0, maxDev, minSeg, overlapPairs };
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

/**
 * viewBox 밖(음수 좌표)으로 나간 역이 있으면 전체를 한 번에 평행이동해 원점을 되살린다.
 * 개별 역만 옮기면 노선 모양이 뒤틀리므로, 반드시 모든 역 + 모든 폴리라인 점을 같은
 * 오프셋으로 옮겨야 한다. `--line`/`--resolve-crowding` 양쪽 흐름이 공유한다.
 * @param {GeomDoc} d
 */
function normalizeViewBox(d) {
  let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
  for (const s of d.stations) {
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y);
  }
  const offsetX = minX < MARGIN ? MARGIN - minX : 0;
  const offsetY = minY < MARGIN ? MARGIN - minY : 0;
  if (offsetX !== 0 || offsetY !== 0) {
    console.log(`viewBox 보정: 전체를 (${round1(offsetX)}, ${round1(offsetY)}) 만큼 평행이동`);
    for (const s of d.stations) { s.x = round1(s.x + offsetX); s.y = round1(s.y + offsetY); }
    for (const l of d.lines) {
      l.polyline = l.polyline.map(([x, y]) => [round1(x + offsetX), round1(y + offsetY)]);
    }
  }
  d.viewBox = {
    width: round1(maxX + offsetX + MARGIN),
    height: round1(maxY + offsetY + MARGIN),
  };
}

// ── 메인 ────────────────────────────────────────────────────────────────────────
/** @type {GeomDoc} */
const doc = JSON.parse(readFileSync(GEOMETRY_FILE, 'utf8'));

if (resolveCrowdingMode) {
  const result = resolveCrowding(doc);
  normalizeViewBox(doc);
  writeFileSync(GEOMETRY_FILE, formatDoc(doc));
  console.log(
    `밀집 해소 완료: ${result.rounds}라운드 만에 역 ${result.movedCount}개 이동, ` +
      `잔여 지점 ${result.clusterCount}개, 미해결 ${result.unresolvedCount}건. ` +
      `저장 완료: ${GEOMETRY_FILE} (viewBox ${doc.viewBox.width}x${doc.viewBox.height})`,
  );
  process.exit(0);
}

if (octolinearLineCodes.length > 0) {
  const before = octolinearStats(doc);
  const result = octolinearizeAll(doc, octolinearLineCodes, octoRounds);
  normalizeViewBox(doc);
  const after = octolinearStats(doc);

  console.log(
    `대상 노선 ${octolinearLineCodes.length}개 / 최대 이동 ${round1(result.maxShift)} / ` +
      `선분 하한(${octoMinSeg})에 걸린 선분 ${result.clampedCount}개`,
  );
  console.log(
    `격자 이탈(45°에서 1° 초과) 선분: ${before.offGrid}/${before.segments} → ${after.offGrid}/${after.segments}, ` +
      `평균 편차 ${before.meanDev.toFixed(2)}° → ${after.meanDev.toFixed(2)}°, 최대 ${before.maxDev.toFixed(2)}° → ${after.maxDev.toFixed(2)}°`,
  );
  console.log(
    `역 원(반지름 11) 겹침 쌍: ${before.overlapPairs} → ${after.overlapPairs}, ` +
      `최단 선분 ${round1(before.minSeg)} → ${round1(after.minSeg)}`,
  );
  console.log(
    `2단계에서 손대지 않은 구간: 자유도 0(확정된 환승역이 노선상 바로 이웃) ${result.pinnedPairs}개, ` +
      `겹침을 새로 만들어 되돌린 구간 ${result.rejectedRuns}개 — 둘 다 1단계 결과를 그대로 쓴다`,
  );
  if (result.frozenResiduals.length > 0) {
    console.log(`제약을 정확히 못 맞춰 오차를 선형 분배한 구간 ${result.frozenResiduals.length}개:`);
    for (const r of result.frozenResiduals.sort((a, b) => b.residual - a.residual).slice(0, 10)) {
      console.log(`    ${r.lineCode} idx ${r.index}: 잔차 ${round1(r.residual)}`);
    }
  }

  const outPath = /** @type {string} */ (outArg).slice('--out='.length);
  writeFileSync(outPath, formatDoc(doc));
  console.log(`저장 완료: ${outPath} (viewBox ${doc.viewBox.width}x${doc.viewBox.height})`);
  process.exit(0);
}

// 위에서 exit 하지 않았다면 offlineMode 는 false 였고, 그때만 db 가 만들어졌다.
const dbClient = /** @type {NonNullable<typeof db>} */ (db);

/** @type {Map<string, StationEntry>} */
const existingByCode = new Map(doc.stations.map((s) => [s.stationCode, s]));

// 전역 유사변환 보정: 이미 배치된 역(현재 파일 안 전부)의 실 위경도를 DB에서 읽어와
// "이 지도가 어떤 각도·축척으로 그려졌는지"를 역산한다. 이번 실행에서 새로 추가되는
// 역과는 무관하게, 실행 시작 시점의 파일 상태 하나로 한 번만 계산한다(파일 안에서
// 노선을 여러 개 연달아 처리해도 기준이 흔들리지 않도록).
const anchorCodes = [...existingByCode.keys()];
const { data: anchorRows, error: anchorErr } = await dbClient
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
  const { data: lineRow, error: lineErr } = await dbClient
    .from('lines')
    .select('id, code, name')
    .eq('code', lineCode)
    .maybeSingle();
  if (lineErr) throw lineErr;
  if (!lineRow) {
    console.error(`DB에 없는 lineCode: ${lineCode}`);
    continue;
  }

  const { data: rows, error: slErr } = await dbClient
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

normalizeViewBox(doc);

writeFileSync(GEOMETRY_FILE, formatDoc(doc));
console.log(`저장 완료: ${GEOMETRY_FILE} (viewBox ${doc.viewBox.width}x${doc.viewBox.height})`);
