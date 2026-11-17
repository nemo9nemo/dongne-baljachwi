/**
 * v2 도식 계약 + 운영 DB의 공개 역/노선 코드 정합성 검사. DB 쓰기 없음.
 * node scripts/verify-line-map.mjs --offline: 자격 증명 없는 로컬 검사
 * npm run verify:line-map: .env.local의 서비스 키로 마스터 코드·누락 범위도 검사
 * station_lines.seq는 분기 순서를 나타내지 못하므로 실제 경로 검증의 근거로 쓰지 않는다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { validateGeometry } from './line-map/validate.mjs'

const directory = 'src/data/line-map'
const errors = [], warnings = [], geometryStations = new Set(), geometryLines = new Set(), pathIds = new Set()
const files = readdirSync(directory).filter(f => f.endsWith('.json'))
if (!files.length) errors.push('좌표 파일이 없습니다.')
for (const file of files) {
  const doc = JSON.parse(readFileSync(join(directory, file), 'utf8'))
  errors.push(...validateGeometry(doc).map(e => `${file}: ${e}`))
  for (const s of doc.stations ?? []) {
    if (geometryStations.has(s.stationCode)) errors.push(`파일 간 역 중복: ${s.stationCode}`)
    geometryStations.add(s.stationCode)
  }
  for (const l of doc.lines ?? []) {
    if (pathIds.has(l.id)) errors.push(`파일 간 경로 ID 중복: ${l.id}`)
    pathIds.add(l.id); geometryLines.add(l.lineCode)
  }
}
if (!process.argv.includes('--offline')) {
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('DB 검증에 VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다. 로컬 검사는 --offline을 쓰세요.'); process.exit(1) }
  const db = createClient(url, key, { auth: { persistSession: false } })
  /** @template T @param {string} table @param {string} columns @param {string} order @returns {Promise<T[]>} */
  async function readAll(table, columns, order) {
    /** @type {T[]} */
    const rows = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(columns).order(order).range(from, from + 999)
      if (error) throw new Error(`${table} 조회 실패: ${error.message}`)
      rows.push(.../** @type {T[]} */ (/** @type {unknown} */ (data)))
      if (data.length < 1000) return rows
    }
  }
  /** @type {[import('./line-map/types.js').DbLine[], import('./line-map/types.js').DbStation[], import('./line-map/types.js').DbMembership[]]} */
  const [lines, stations, memberships] = await Promise.all([
    readAll('lines', 'id,code,name,in_mvp_scope,is_active', 'code'),
    readAll('stations', 'id,code,name_short,is_active', 'code'),
    readAll('station_lines', 'station_id,line_id', 'station_id'),
  ])
  const dbCodes = new Set(stations.map(s => s.code)), lineCodes = new Set(lines.map(l => l.code))
  for (const code of geometryStations) if (!dbCodes.has(code)) errors.push(`DB에 없는 역: ${code}`)
  for (const code of geometryLines) if (!lineCodes.has(code)) errors.push(`DB에 없는 노선: ${code}`)
  const mvpLines = new Set(lines.filter(l => l.in_mvp_scope && l.is_active).map(l => l.id))
  const mvpStations = new Set(memberships.filter(m => mvpLines.has(m.line_id)).map(m => m.station_id))
  const uncovered = stations.filter(s => s.is_active && mvpStations.has(s.id) && !geometryStations.has(s.code))
  if (uncovered.length) warnings.push(`MVP 범위 ${uncovered.length}역에 도식 좌표가 없습니다: ${uncovered.slice(0, 8).map(s => s.name_short).join(', ')}`)
}
console.log(`좌표 파일 ${files.length}개 / 노선 항목 ${geometryLines.size}개 / 경로 ${pathIds.size}개 / 역 ${geometryStations.size}개`)
for (const warning of warnings) console.warn(`경고: ${warning}`)
for (const error of errors) console.error(`실패: ${error}`)
if (errors.length) process.exit(1)
console.log(`정합성 검증 통과 (경고 ${warnings.length}건). 운행 연결 전체의 정확성을 보증하는 검사는 아닙니다.`)
