#!/usr/bin/env node
/**
 * 역 마스터 데이터 적재 배치 (docs/specs/02-station-master.md).
 *
 *   npm run stations:load -- --file=./data/railway.csv           # 기본값 = dry-run
 *   npm run stations:load -- --file=./data/railway.csv --apply
 *   npm run stations:load -- --source=tago                       # 폐기된 경로. 명시해야만 돈다
 *
 * 원칙
 *  - F-12: 기본은 dry-run. 실수로 프로덕션을 덮어쓰는 사고를 막는다.
 *  - F-13: service_role 키로만 동작한다. 브라우저에서 실행되지 않는다.
 *  - 02 §2.3: 수집 실패 시 아무것도 쓰지 않는다. 적재는 apply_station_master() RPC 한 번 =
 *    트랜잭션 한 건이라 부분 적재가 생길 수 없다.
 *  - 02 §9 (2026-08-12 확정): 원천 기본값은 전국도시철도역사정보표준데이터(standard-file)다.
 *    TAGO 는 --source=tago 로 명시할 때만 쓴다.
 *  - 사용자 요청 경로에서는 어떤 외부 API 도 호출하지 않는다. 앱은 항상 Supabase 만 조회한다.
 */

import { createClient } from '@supabase/supabase-js';
import { createTagoSource } from './station-master/sources/tago.mjs';
import { createStandardFileSource } from './station-master/sources/standard-file.mjs';
import { groupStations } from './station-master/grouping.mjs';
import { applyLineOrdering, applyMvpScope, lineDisplayMeta } from './station-master/line-policy.mjs';
import { applyKnownCorrections } from './station-master/known-corrections.mjs';

/** @typedef {import('./station-master/types.mjs').MasterSnapshot} MasterSnapshot */

/** @param {string} msg */
const log = (msg) => process.stdout.write(`${msg}\n`);

/**
 * @param {string[]} argv
 * @returns {{ apply: boolean, source: 'tago'|'standard-file'|null, file: string|null, endpoint: string|null, keyword: string|null }}
 */
function parseArgs(argv) {
  const get = (/** @type {string} */ name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const source = get('source');
  if (source !== null && source !== 'tago' && source !== 'standard-file') {
    throw new Error(`--source 는 tago | standard-file 만 가능하다 (받은 값: ${source})`);
  }
  return {
    apply: argv.includes('--apply'),
    source,
    file: get('file'),
    endpoint: get('endpoint'),
    keyword: get('keyword'),
  };
}

/**
 * 현재 DB 상태와 비교해 변경 요약을 만든다 (02 §5 "차이 요약").
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {MasterSnapshot} snapshot
 */
async function diffAgainstDb(db, snapshot) {
  /** @param {string} table @param {string} cols */
  const fetchAll = async (table, cols) => {
    const { data, error } = await db.from(table).select(cols).range(0, 49999);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    // supabase-js 는 컬럼 문자열이 동적이면 행 타입을 추론하지 못한다. 여기서만 unknown 을
    // 거쳐 좁힌다 — 값의 실제 형태는 위 select 목록이 보장한다.
    return /** @type {Record<string, unknown>[]} */ (/** @type {unknown} */ (data ?? []));
  };

  const existingStations = await fetchAll('stations', 'code,name,name_short,name_key,lat,lng,region_code,needs_review,is_active');
  const existingLines = await fetchAll('lines', 'code,name,operator,sort_order,color_token,in_mvp_scope,is_active');

  const byCode = new Map(existingStations.map((s) => [String(s.code), s]));
  const lineByCode = new Map(existingLines.map((l) => [String(l.code), l]));

  /** @type {string[]} */
  const details = [];
  let added = 0;
  let changed = 0;

  for (const s of snapshot.stations) {
    const prev = byCode.get(s.code);
    if (!prev) { added += 1; details.push(`+ 역 ${s.code} ${s.name}`); continue; }
    /** @type {string[]} */
    const fields = [];
    if (prev.name !== s.name) fields.push(`name ${prev.name}→${s.name}`);
    if (prev.name_short !== s.name_short) fields.push('name_short');
    if (prev.name_key !== s.name_key) fields.push('name_key');
    if (prev.region_code !== s.region_code) fields.push(`region ${prev.region_code}→${s.region_code}`);
    // 좌표는 부동소수라 1m(≈1e-5도) 미만 차이는 변경으로 세지 않는다. 안 그러면 매 실행이
    // "전량 변경"으로 보여 AC-02(멱등성) 확인이 불가능해진다.
    if (Math.abs(Number(prev.lat) - s.lat) > 1e-5 || Math.abs(Number(prev.lng) - s.lng) > 1e-5) fields.push('좌표');
    if (prev.is_active === false) fields.push('재활성화');
    if (fields.length > 0) { changed += 1; details.push(`~ 역 ${s.code} ${s.name}: ${fields.join(', ')}`); }
  }

  const incoming = new Set(snapshot.stations.map((s) => s.code));
  const deactivated = existingStations.filter((s) => s.is_active !== false && !incoming.has(String(s.code)));
  for (const s of deactivated) details.push(`- 역 ${s.code} ${s.name} → is_active=false`);

  const incomingLines = new Set(snapshot.lines.map((l) => l.code));
  const linesAdded = snapshot.lines.filter((l) => !lineByCode.has(l.code)).length;
  const linesOff = existingLines.filter((l) => l.is_active !== false && !incomingLines.has(String(l.code))).length;

  return { added, changed, deactivated: deactivated.length, linesAdded, linesOff, details };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.apply ? 'apply' : 'dry-run';

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  const tagoKey = process.env.TAGO_SERVICE_KEY?.trim() || null;

  // ── 원천 선택 ────────────────────────────────────────────────────────────
  // 02 §9 / ADR-001: 2026-08-12 실 호출 결과 TAGO 엔드포인트가 유효하지 않은 것으로 진단되어
  // **전국도시철도역사정보표준데이터를 공식 원천으로 확정**했다. 그래서 자동 선택은 항상
  // standard-file 이다 — TAGO_SERVICE_KEY 가 .env.local 에 남아 있어도 자동으로 고르지 않는다.
  // 키 존재 여부로 원천이 바뀌면 "어제와 같은 명령인데 다른 데이터가 적재되는" 사고가 난다.
  // TAGO 로 돌아가려면 --source=tago 로 명시해야 한다 (엔드포인트 재확인 후 재시도용).
  // 어느 쪽을 왜 골랐는지는 반드시 로그로 남긴다 — 나중에 "무슨 데이터로 적재했지?"를
  // 되짚을 수 있어야 한다.
  /** @type {'tago'|'standard-file'} */
  let sourceId;
  if (args.source) {
    sourceId = args.source;
    log(`원천: ${sourceId} (--source 로 명시됨)`);
  } else {
    sourceId = 'standard-file';
    log('원천: standard-file (기본값 — 02 §9 에 따라 표준데이터가 공식 원천으로 확정됨)');
    if (tagoKey) {
      // 키가 남아 있는 걸 사용자가 "그래서 TAGO 로 도는 중"이라고 오해하지 않도록 명시한다.
      log('  (TAGO_SERVICE_KEY 가 설정돼 있지만 자동 선택하지 않는다. 쓰려면 --source=tago)');
    }
  }

  /** @type {import('./station-master/types.mjs').StationSource} */
  let source;
  if (sourceId === 'tago') {
    if (!tagoKey) throw new Error('TAGO_SERVICE_KEY 가 없다. .env.local 을 확인하거나 --source=standard-file 로 실행하라.');
    log('  주의: TAGO 어댑터는 2026-08-12 실 호출에서 NO_OPENAPI_SERVICE_ERROR 로 실패했다.');
    log('  엔드포인트가 확인되지 않았다면 --endpoint=<URL> 로 덮어써서 시도하라 (02 §9).');
    source = createTagoSource({ serviceKey: tagoKey, endpoint: args.endpoint ?? undefined, keyword: args.keyword ?? undefined, log });
  } else {
    // standard-file 은 로컬 파일이 필수다. 인자 없이 실행한 사용자가 여기 걸리는 게 가장 흔한
    // 경로이므로, "무엇을 어디서 받아 어떻게 넘겨야 하는지"까지 한 번에 알려준다.
    if (!args.file) {
      throw new Error(
        '표준데이터 파일 경로가 없다. --file=<.csv|.xlsx> 가 필요하다.\n' +
        '  1) data.go.kr 에서 "전국도시철도역사정보표준데이터"(15013205) 파일을 내려받는다\n' +
        '     (CSV 권장. XLSX 는 xlsx 패키지가 설치돼 있어야 읽는다)\n' +
        '  2) npm run stations:load -- --file=./data/railway.csv        # dry-run\n' +
        '  3) npm run stations:load -- --file=./data/railway.csv --apply\n' +
        '  ※ TAGO 로 시도하려면 --source=tago 를 명시하라. 다만 2026-08-12 실 호출에서\n' +
        '     엔드포인트가 유효하지 않은 것으로 확인됐다 (02 §9).',
      );
    }
    source = createStandardFileSource({ filePath: args.file, log });
  }

  log(`모드: ${mode}`);
  log(`대상: ${supabaseUrl ?? '(Supabase 미설정)'}`);
  log(`어댑터: ${source.describe}`);
  log('');

  // ── 수집 ────────────────────────────────────────────────────────────────
  const { rows: fetchedRows, sourceUpdatedOn, raw } = await source.fetchRows();
  log(`수집 완료: 원천 ${fetchedRows.length}행 (기준일 ${sourceUpdatedOn ?? '미상'})`);

  // 02 §9(2026-08-24 발견, 2026-08-25 원인 규명): 원본 표준데이터 자체에 잘못된 좌표가
  // 있는 행이 있다(예: 양원역이 경북 좌표를 가리킴). 원본 파일을 고칠 방법이 없으므로
  // (매년 새로 받는 외부 파일, 저장소에 체크인하지 않음) 그룹핑 전에 알려진 오류를 정정한다.
  // TAGO 원천으로 바뀌어도 같은 물리 역이면 같은 교정이 필요할 수 있어 어댑터가 아니라
  // 여기(공통 파이프라인)에서 적용한다.
  const rows = applyKnownCorrections(fetchedRows, log);

  // ── 정규화 · 그룹핑 ─────────────────────────────────────────────────────
  // F-04: 수동 교정은 DB 에 있다. Supabase 미설정(로컬 검증)에서는 빈 규칙으로 돈다.
  /** @type {{ merge: string[][], split: string[][] }} */
  let overrides = { merge: [], split: [] };

  /** @type {import('@supabase/supabase-js').SupabaseClient|null} */
  let db = null;
  if (supabaseUrl && serviceRoleKey) {
    db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from('station_merge_overrides').select('kind,source_keys');
    if (error) throw new Error(`station_merge_overrides 조회 실패: ${error.message}`);
    overrides = {
      merge: (data ?? []).filter((o) => o.kind === 'merge').map((o) => /** @type {string[]} */ (o.source_keys)),
      split: (data ?? []).filter((o) => o.kind === 'split').map((o) => /** @type {string[]} */ (o.source_keys)),
    };
    log(`수동 교정 규칙: merge ${overrides.merge.length} / split ${overrides.split.length}`);
  } else if (args.apply) {
    throw new Error('--apply 에는 SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 반드시 필요하다 (F-13).');
  } else {
    log('Supabase 미설정 — 그룹핑까지만 수행하고 차이 요약은 건너뛴다.');
  }

  // 노선명은 그룹핑이 lines.name 으로 채택한 그 문자열을 그대로 받는다. 예전에는 여기서
  // rows.find() 로 "그 노선의 아무 행"을 다시 찾아 이름을 뽑았는데, 원천이 한 노선번호 아래
  // 표기를 여러 개 싣는 탓에 채택된 이름과 다른 행이 잡혀 토큰이 어긋났다 (grouping.mjs 주석).
  const snapshot = groupStations(rows, overrides, (_lineCode, lineName) => ({
    ...lineDisplayMeta(lineName),
    inMvpScope: true,
  }));
  applyLineOrdering(snapshot);
  applyMvpScope(snapshot);

  log('');
  log(`그룹핑 완료: 노선 ${snapshot.lines.length} / 역 ${snapshot.stations.length} / 역-노선 ${snapshot.station_lines.length}`);
  log(`  MVP 범위 노선 ${snapshot.lines.filter((l) => l.in_mvp_scope).length}개`);
  log(`  환승역(2개 노선 이상) ${countTransfers(snapshot)}개`);

  if (snapshot.skipped.length > 0) {
    log(`  적재 제외 ${snapshot.skipped.length}건 (좌표 미확보 — 02 §4.2):`);
    for (const s of snapshot.skipped.slice(0, 20)) log(`    ${s}`);
    if (snapshot.skipped.length > 20) log(`    ... 외 ${snapshot.skipped.length - 20}건`);
  }

  // F-05: 그룹핑 경고는 사람이 검토할 목록이다. 전체를 나열한다 (02 §5).
  log('');
  log(`그룹핑 경고 ${snapshot.warnings.length}건${snapshot.warnings.length > 0 ? ':' : ''}`);
  for (const w of snapshot.warnings) log(`  ${w}`);

  // ── 차이 요약 ───────────────────────────────────────────────────────────
  if (db) {
    const diff = await diffAgainstDb(db, snapshot);
    log('');
    log(`차이 요약: 신규 역 ${diff.added} / 변경 ${diff.changed} / 비활성화 ${diff.deactivated}` +
        ` / 신규 노선 ${diff.linesAdded} / 비활성화 노선 ${diff.linesOff}`);
    for (const d of diff.details.slice(0, 50)) log(`  ${d}`);
    if (diff.details.length > 50) log(`  ... 외 ${diff.details.length - 50}건`);
  }

  if (!args.apply) {
    log('');
    log('dry-run 종료. 적용하려면 --apply');
    return;
  }

  // ── 적용 ────────────────────────────────────────────────────────────────
  const client = /** @type {import('@supabase/supabase-js').SupabaseClient} */ (db);

  // F-15: 원문 보관. 그룹핑 규칙을 바꿔 재계산할 때 원천을 다시 때리지 않기 위해서다.
  // 적재 트랜잭션 밖이다 — 보관 실패가 적재를 막을 이유는 없고, 반대로 적재가 롤백돼도
  // 원문이 남아 있는 편이 디버깅에 유리하다.
  const { error: rawError } = await client.from('station_source_raw').insert({
    source: sourceId,
    payload: /** @type {never} */ (raw),
  });
  if (rawError) log(`  경고: 원문 보관 실패 (적재는 계속한다): ${rawError.message}`);

  const { data, error } = await client.rpc('apply_station_master', {
    p_payload: {
      source: sourceId,
      source_updated_on: sourceUpdatedOn,
      lines: snapshot.lines,
      stations: snapshot.stations,
      station_lines: snapshot.station_lines,
    },
  });

  if (error) {
    // 02 §5 "apply 실패": 트랜잭션이 롤백됐고 master_version 은 그대로다.
    throw new Error(`적재 실패 (롤백됨, master_version 불변): ${error.message}`);
  }

  log('');
  log(`적재 성공: ${JSON.stringify(data)}`);
}

/**
 * @param {MasterSnapshot} snapshot
 * @returns {number}
 */
function countTransfers(snapshot) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const sl of snapshot.station_lines) counts.set(sl.station_code, (counts.get(sl.station_code) ?? 0) + 1);
  return [...counts.values()].filter((n) => n >= 2).length;
}

main().catch((err) => {
  process.stderr.write(`\n실패: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
