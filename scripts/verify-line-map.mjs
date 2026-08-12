/**
 * 노선도 도식 좌표 ↔ DB 정합성 검증 (03 §4.2, AC-14 / ADR-003 §3).
 *
 * 좌표는 리포지토리(정적 파일), 역/노선 마스터는 DB에 있다. 두 곳에 나뉜 데이터를
 * 이 스크립트가 붙들고 있다. **검증을 만들지 않으면 ADR-003 은 나쁜 결정이 된다.**
 *
 *   실패(exit 1) — 좌표 파일의 stationCode / lineCode 가 DB 에 없음
 *   실패(exit 1) — 파일 내부 불일치 (lines[].stationCodes 에 있는데 stations[] 에 없음, 좌표 중복)
 *   경고(exit 0) — DB 의 MVP 범위 역 중 좌표 파일에 없는 것
 *                   (신규 개통역이 좌표 작업 전이라는 이유로 배포를 막으면 안 된다)
 *   경고(exit 0) — 좌표 파일의 역 순서가 station_lines.seq 와 다름
 *
 * 실행: npm run verify:line-map   (.env.local 의 VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 * service_role 을 쓰는 이유: 마스터 조회에 로그인 세션이 필요한데 CI 에 사용자 계정을
 * 두고 싶지 않기 때문이다. 이 스크립트는 브라우저 번들에 들어가지 않는다.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const GEOMETRY_DIR = 'src/data/line-map'
const PAGE = 1000

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

/**
 * @typedef {{ stationCode: string, x: unknown, y: unknown, labelAnchor: unknown }} GeomStation
 * @typedef {{ lineCode: string, polyline: unknown, stationCodes: string[] }} GeomLine
 * @typedef {{ viewBox?: { width?: unknown, height?: unknown }, lines?: GeomLine[], stations?: GeomStation[] }} GeomDoc
 */

/** @type {string[]} */
const errors = []
/** @type {string[]} */
const warnings = []

// ── 좌표 파일 읽기 ──────────────────────────────────────────────────────────
const files = readdirSync(GEOMETRY_DIR).filter((f) => f.endsWith('.json'))
if (files.length === 0) errors.push(`${GEOMETRY_DIR} 에 좌표 파일이 없습니다.`)

/** stationCode -> 그 역을 담고 있는 파일 이름  @type {Map<string, string>} */
const geometryStations = new Map()
/** lineCode -> 파일 이름 + 역 순서  @type {Map<string, { file: string, stationCodes: string[] }>} */
const geometryLines = new Map()

for (const file of files) {
  /** @type {GeomDoc} */
  const doc = JSON.parse(readFileSync(join(GEOMETRY_DIR, file), 'utf8'))

  if (!doc.viewBox || typeof doc.viewBox.width !== 'number' || typeof doc.viewBox.height !== 'number') {
    errors.push(`${file}: viewBox 가 없거나 형식이 틀립니다.`)
  }

  for (const s of doc.stations ?? []) {
    if (typeof s.x !== 'number' || typeof s.y !== 'number') {
      errors.push(`${file}: ${s.stationCode} 의 x/y 가 숫자가 아닙니다.`)
    }
    if (typeof s.labelAnchor !== 'string' || !['top', 'bottom', 'left', 'right'].includes(s.labelAnchor)) {
      errors.push(`${file}: ${s.stationCode} 의 labelAnchor 가 잘못됐습니다 (${s.labelAnchor}).`)
    }
    if (geometryStations.has(s.stationCode)) {
      errors.push(`${file}: stationCode 중복 — ${s.stationCode} (${geometryStations.get(s.stationCode)} 에도 있음)`)
    }
    geometryStations.set(s.stationCode, file)
  }

  for (const l of doc.lines ?? []) {
    if (geometryLines.has(l.lineCode)) {
      errors.push(`${file}: lineCode 중복 — ${l.lineCode}`)
    }
    geometryLines.set(l.lineCode, { file, stationCodes: l.stationCodes ?? [] })
    if (!Array.isArray(l.polyline) || l.polyline.length < 2) {
      errors.push(`${file}: ${l.lineCode} 의 polyline 이 비었습니다.`)
    }
    for (const code of l.stationCodes ?? []) {
      if (!geometryStations.has(code) && !(doc.stations ?? []).some((s) => s.stationCode === code)) {
        errors.push(`${file}: ${l.lineCode}.stationCodes 의 ${code} 에 좌표(stations[])가 없습니다.`)
      }
    }
  }
}

// ── DB ─────────────────────────────────────────────────────────────────────
const { data: dbLines, error: lineErr } = await db
  .from('lines')
  .select('id, code, name, in_mvp_scope, is_active')
if (lineErr) throw lineErr

const dbStations = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from('stations')
    .select('id, code, name_short, is_active')
    .order('code')
    .range(from, from + PAGE - 1)
  if (error) throw error
  dbStations.push(...data)
  if (data.length < PAGE) break
}

const dbLineByCode = new Map(dbLines.map((l) => [l.code, l]))
const dbStationCodes = new Set(dbStations.map((s) => s.code))

// AC-14: 파일에 있는데 DB 에 없는 코드는 실패다.
for (const [code, file] of geometryStations) {
  if (!dbStationCodes.has(code)) errors.push(`${file}: DB 에 없는 stationCode — ${code}`)
}
for (const [code, { file }] of geometryLines) {
  if (!dbLineByCode.has(code)) errors.push(`${file}: DB 에 없는 lineCode — ${code}`)
}

// 좌표 파일의 역 순서가 station_lines.seq 와 어긋나면 선이 엉킨다. 경고로만 알린다
// (도식은 저작물이라 의도적으로 다르게 놓을 여지를 남긴다).
for (const [lineCode, geom] of geometryLines) {
  const dbLine = dbLineByCode.get(lineCode)
  if (dbLine === undefined) continue
  const { data, error } = await db
    .from('station_lines')
    .select('seq, stations(code)')
    .eq('line_id', dbLine.id)
    .order('seq')
  if (error) throw error
  // 임베드 조인 결과는 supabase-js 가 배열로 추론하지만 실제로는 1:1 이라 객체다.
  const expected = data.map((r) => /** @type {{ code: string }} */ (/** @type {unknown} */ (r.stations)).code)
  if (expected.join('>') !== geom.stationCodes.join('>')) {
    warnings.push(
      `${geom.file}: ${lineCode}(${dbLine.name}) 의 역 순서가 station_lines.seq 와 다릅니다.\n` +
        `    file: ${geom.stationCodes.join(' > ')}\n` +
        `    db  : ${expected.join(' > ')}`,
    )
  }
}

// MVP 범위인데 좌표가 없는 역 → 경고. 지금은 2호선 파일럿이라 대부분이 여기 잡힌다.
const mvpLineIds = new Set(dbLines.filter((l) => l.in_mvp_scope && l.is_active).map((l) => l.id))
const mvpStationIds = new Set()
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from('station_lines')
    .select('station_id, line_id')
    .range(from, from + PAGE - 1)
  if (error) throw error
  for (const r of data) if (mvpLineIds.has(r.line_id)) mvpStationIds.add(r.station_id)
  if (data.length < PAGE) break
}
const uncovered = dbStations.filter(
  (s) => s.is_active && mvpStationIds.has(s.id) && !geometryStations.has(s.code),
)
if (uncovered.length > 0) {
  warnings.push(
    `MVP 범위 역 ${uncovered.length}개에 도식 좌표가 없습니다 (노선도에 그려지지 않음).\n` +
      `    예: ${uncovered.slice(0, 8).map((s) => `${s.name_short}(${s.code})`).join(', ')}${uncovered.length > 8 ? ' …' : ''}`,
  )
}

// ── 결과 ───────────────────────────────────────────────────────────────────
console.log(
  `좌표 파일 ${files.length}개 / 노선 ${geometryLines.size}개 / 역 ${geometryStations.size}개 검사`,
)
for (const w of warnings) console.warn(`경고: ${w}`)
for (const e of errors) console.error(`실패: ${e}`)

if (errors.length > 0) {
  console.error(`\n정합성 검증 실패 ${errors.length}건.`)
  process.exit(1)
}
console.log(`정합성 검증 통과 (경고 ${warnings.length}건).`)
