/** v2 도식의 로컬 계약. 실제 운행 연결·운영 마스터 검증과 구분한다. */
/** @param {import('./types.js').Geometry} doc */
export function validateGeometry(doc) {
  /** @type {string[]} */
  const errors = []
  /** @param {string} message */
  const fail = message => errors.push(message)
  if (doc.schemaVersion !== 2) fail('schemaVersion은 2여야 합니다.')
  if (!doc.revision) fail('revision이 필요합니다.')
  const { width, height } = doc.viewBox ?? {}
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) fail('잘못된 viewBox')
  const stations = new Map(), positions = new Set(), ids = new Set(), members = new Set()
  for (const s of doc.stations ?? []) {
    if (!s.stationCode || stations.has(s.stationCode)) fail(`중복/누락 stationCode: ${s.stationCode}`)
    if (![s.x, s.y].every(Number.isFinite) || s.x < 0 || s.y < 0 || s.x > width || s.y > height) fail(`좌표 범위: ${s.stationCode}`)
    if (!['top', 'bottom', 'left', 'right'].includes(s.labelAnchor)) fail(`labelAnchor: ${s.stationCode}`)
    if (positions.has(`${s.x},${s.y}`)) fail(`역 위치 중복: ${s.stationCode}`)
    if (s.labelLines && (!s.labelLines.length || s.labelLines.some(l => typeof l !== 'string' || !l.trim()))) fail(`labelLines: ${s.stationCode}`)
    if (s.labelOffset && ![s.labelOffset.x, s.labelOffset.y].every(Number.isFinite)) fail(`labelOffset: ${s.stationCode}`)
    stations.set(s.stationCode, s); positions.add(`${s.x},${s.y}`)
  }
  if (!stations.size) fail('역이 없습니다.')
  if (!doc.lines?.length) fail('경로가 없습니다.')
  for (const line of doc.lines ?? []) {
    if (!line.id || ids.has(line.id)) fail(`중복/누락 경로 id: ${line.id}`)
    ids.add(line.id)
    if (!line.lineCode) fail(`노선 코드 누락: ${line.id}`)
    if (!Array.isArray(line.polyline) || line.polyline.length < 2) { fail(`빈 경로: ${line.id}`); continue }
    if (line.polyline.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) { fail(`꺾임점 형식: ${line.id}`); continue }
    for (let i = 1; i < line.polyline.length; i++) {
      const a = line.polyline[i - 1], b = line.polyline[i]
      const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1])
      if (dx > .11 && dy > .11 && Math.abs(dx - dy) > .11) fail(`8방향이 아닌 선분: ${line.id}/${i}`)
    }
    if (!line.stationCodes?.length || new Set(line.stationCodes).size !== line.stationCodes.length) fail(`역 목록 누락/중복: ${line.id}`)
    let cursor = 0
    for (const code of line.stationCodes ?? []) {
      members.add(code)
      const station = stations.get(code)
      if (!station) { fail(`좌표 없는 역: ${line.id}/${code}`); continue }
      const found = line.polyline.findIndex((p, i) => i >= cursor && Math.hypot(p[0] - station.x, p[1] - station.y) < .11)
      if (found < 0) fail(`역 순서와 선이 다름: ${line.id}/${code}`)
      else cursor = found + 1
    }
    const last = line.polyline[line.polyline.length - 1]
    if (line.closed && Math.hypot(line.polyline[0][0] - last[0], line.polyline[0][1] - last[1]) > .11) fail(`닫히지 않은 순환선: ${line.id}`)
  }
  for (const code of stations.keys()) if (!members.has(code)) fail(`어느 경로에도 속하지 않는 역: ${code}`)
  return errors
}
