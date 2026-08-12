// ============================================================================
// DB 검증 러너
//
//   npm run test:db              전체 실행
//   npm run test:db -- records   파일명에 'records' 가 들어간 테스트만
//
// 하는 일: 인메모리 Postgres(PGlite)를 띄우고
//   support/*.sql  → 플랫폼 스텁 + 테스트 키트
//   ../migrations/*.sql → 실제 마이그레이션을 이름순으로 **그대로**
//   *.test.sql     → 테스트
// 를 순서대로 적용한 뒤 test.results 를 집계한다.
//
// 왜 Docker(supabase start)가 아니라 PGlite 인가: 검증을 재현하는 데 데몬·이미지·포트가
// 필요 없어야 QA 나 다른 개발자가 실제로 돌려 본다. `npm i` 만으로 끝난다.
// 대신 Auth/Storage 서비스 자체는 검증할 수 없다 — 그 부분은 support/00-supabase-stub.sql
// 이 흉내내는 범위까지만 신뢰할 수 있다.
// ============================================================================

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const here = path.dirname(fileURLToPath(import.meta.url))
const filter = process.argv[2] ?? ''

async function sqlFiles(dir) {
  const entries = await readdir(dir)
  return entries.filter((f) => f.endsWith('.sql')).sort()
}

const db = await PGlite.create()

// ── 1. 플랫폼 스텁 + 테스트 키트 ────────────────────────────────────────────
for (const file of await sqlFiles(path.join(here, 'support'))) {
  const sql = await readFile(path.join(here, 'support', file), 'utf8')
  try {
    await db.exec(sql)
  } catch (error) {
    console.error(`[support] ${file} 적용 실패:\n${error.message}`)
    process.exit(1)
  }
}

// ── 2. 마이그레이션 ─────────────────────────────────────────────────────────
const migrationsDir = path.join(here, '..', 'migrations')
for (const file of await sqlFiles(migrationsDir)) {
  const sql = await readFile(path.join(migrationsDir, file), 'utf8')
  try {
    await db.exec(sql)
    console.log(`  applied  ${file}`)
  } catch (error) {
    console.error(`\n[migration] ${file} 적용 실패:\n${error.message}`)
    process.exit(1)
  }
}

// ── 3. 테스트 ───────────────────────────────────────────────────────────────
const testFiles = (await sqlFiles(here)).filter((f) => f.endsWith('.test.sql') && f.includes(filter))

for (const file of testFiles) {
  const sql = await readFile(path.join(here, file), 'utf8')
  // 실행 중 파일 이름을 GUC 로 넘긴다 (test.record 가 읽는다).
  await db.exec(`reset role; select set_config('test.file', ${literal(file)}, false);`)
  try {
    await db.exec(sql)
  } catch (error) {
    // 파일이 중간에 터지면 그 파일의 결과는 롤백되어 사라진다. 러너가 별도로 기록한다.
    await db.exec('reset role;')
    await db.query('insert into test.results (file, name, passed, detail) values ($1, $2, false, $3)', [
      file,
      '(파일 실행 중 예외 — 이후 어서션은 실행되지 않았고 앞선 결과도 롤백됨)',
      error.message,
    ])
  }
}

await db.exec('reset role;')

// ── 4. 집계 ─────────────────────────────────────────────────────────────────
const { rows } = await db.query(
  'select file, name, passed, detail from test.results order by id',
)

let failed = 0
let currentFile = null
for (const row of rows) {
  if (row.file !== currentFile) {
    currentFile = row.file
    console.log(`\n${currentFile}`)
  }
  if (row.passed) {
    console.log(`  ok    ${row.name}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${row.name}\n        ${row.detail ?? ''}`)
  }
}

console.log(`\n${rows.length - failed}/${rows.length} passed`)
if (testFiles.length === 0) {
  console.log('실행된 테스트 파일이 없다 (필터 확인)')
  process.exit(1)
}
process.exit(failed > 0 ? 1 : 0)

/** SQL 문자열 리터럴. 파일명만 들어오지만 문자열 조립은 예외 없이 이스케이프한다. */
function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}
