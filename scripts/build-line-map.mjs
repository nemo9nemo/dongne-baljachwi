/**
 * 스펙 15: 도식 제작 원본과 산출물을 분리한다. DB에 쓰지 않는 재현 가능한 빌드다.
 * 원본의 지리 추정 순서를 그대로 잇지 않고, 분기·순환은 명시한 경로로 교정한다.
 * 실행: node scripts/build-line-map.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** @type {import('./line-map/types.js').Source} */
const source = JSON.parse(readFileSync(new URL('./line-map/metro-seoul-source.json', import.meta.url), 'utf8'))
const output = new URL('../src/data/line-map/metro-seoul.json', import.meta.url)
const byName = new Map(source.stations.map(s => [s.name, s.stationCode]))
const byCode = new Map(source.stations.map(s => [s.stationCode, s]))
if (byName.size !== source.stations.length) throw new Error('제작 원본에 동명역이 있습니다. 이름 대신 역 코드를 지정해야 합니다.')
/** @param {string} code */
const line = code => { const found = source.lines.find(l => l.lineCode === code); if (!found) throw new Error(`Unknown line ${code}`); return found }
/** @param {string} code */
const station = code => { const found = byCode.get(code); if (!found) throw new Error(`Unknown station ${code}`); return found }
/** @param {string} code */
const names = code => line(code).stationCodes.map(c => station(c).name)
/** @type {import('./line-map/types.js').Route[]} */
const routes = source.lines.map(l => ({ id: l.lineCode, lineCode: l.lineCode, names: names(l.lineCode), closed: l.lineCode === 'L-S1102' }))
/** @param {string} code @param {{ names: string[], closed?: boolean }[]} paths */
function replace(code, paths) {
  const index = routes.findIndex(r => r.lineCode === code)
  routes.splice(index, routes.filter(r => r.lineCode === code).length,
    ...paths.map((p, i) => ({ id: `${code}-${i}`, lineCode: code, ...p })))
}
/** @param {string[]} list @param {string} start @param {string} end */
const between = (list, start, end) => {
  const a = list.indexOf(start), b = list.indexOf(end)
  if (a < 0 || b < a) throw new Error(`잘못된 노선 구간: ${start} → ${end}`)
  return list.slice(a, b + 1)
}

replace('L-S1121', [{ names: ['성수', ...names('L-S1121')] }])
replace('L-S1122', [{ names: ['신도림', ...names('L-S1122'), '까치산'] }])

// 지선은 별도 경로다. 광명→관악, 서동탄→세마, 마천→천호처럼 없는 직결을 만들지 않는다.
replace('L-I4101', [
  { names: '청량리 제기동 신설동 동묘앞 동대문 종로5가 종로3가 종각 시청 서울 남영역 용산역 노량진 대방 신길 영등포역 신도림 구로역 가산디지털단지 독산역 금천구청역 석수역 관악역 안양역 명학역 금정역 군포역 당정역 의왕역 성균관대역 화서역 수원역 세류역 병점역 세마역 오산대역 오산역 진위역 송탄역 서정리역 평택지제역 평택역'.split(' ') },
  { names: ['금천구청역', '광명역'] },
  { names: ['병점역', '서동탄역'] },
])
replace('L-I1101', [{ names: ['구로역', ...names('L-I1101')] }])
replace('L-I4102', [{ names: between(names('L-I4102'), '소요산역', '청량리') }])

const five = names('L-S1105')
const fiveWest = between(five, '천호', '방화').reverse()
// 초기 시드의 인접역 추정으로 뒤바뀌었던 마곡·발산 순서를 되돌린다.
const magok = fiveWest.indexOf('마곡'), balsan = fiveWest.indexOf('발산')
if (magok > balsan) [fiveWest[magok], fiveWest[balsan]] = [fiveWest[balsan], fiveWest[magok]]
replace('L-S1105', [
  { names: [...fiveWest, ...between(five, '하남검단산', '강동').reverse()] },
  { names: ['강동', ...between(five, '둔촌동', '마천')] },
])
replace('L-S1106', [
  { names: between(names('L-S1106'), '신내', '응암') },
  { names: ['응암', '역촌', '불광', '독바위', '연신내', '구산'], closed: true },
])
// 경원선의 용산~청량리 구간은 경의중앙선 운행 표시로 연결한다.
const centralEast = between(names('L-I4108'), '지평역', '청량리').filter(n => n !== '광운대역')
const centralWest = between(names('L-I4108'), '효창공원앞', '임진강역').filter(n => n !== '신촌역')
replace('L-I4108', [
  { names: [...centralEast, ...between(names('L-I4102'), '왕십리', '용산역'), ...centralWest] },
  { names: ['가좌역', '신촌역', '서울'] },
])
const four = names('L-I1104')
const yongsan = four.indexOf('신용산'), ichon = four.indexOf('이촌')
if (yongsan < ichon) [four[yongsan], four[ichon]] = [four[ichon], four[yongsan]]
replace('L-I1104', [{ names: four }])
replace('L-I4103', [{ names: [...names('L-I4103'), '남태령'] }])
replace('L-I4104', [{ names: ['불암산', ...names('L-I4104')] }])
replace('L-S4108', [{ names: [...names('L-S4108'), '동구릉'] }])
replace('L-I28K1', [{ names: [...names('L-I28K1'), '수원역'] }])
replace('L-L41U1', [{ names: '발곡 회룡 범골 경전철의정부 의정부시청 흥선 의정부중앙 동오 새말 경기도청북부청사 효자 곤제 어룡 송산 탑석'.split(' ') }])

// 전체 윤곽은 유지하면서 도심을 상대적으로 넓힌다. 원본 좌표는 별도 파일에 보존된다.
/** @param {number} v @param {number} lo @param {number} hi */
const compress = (v, lo, hi) => v < lo ? v * 0.22 : v <= hi ? lo * 0.22 + v - lo : lo * 0.22 + hi - lo + (v - hi) * 0.22
/** @type {import('./line-map/types.js').Station[]} */
const stations = source.stations.map(s => ({ stationCode: s.stationCode,
  x: Math.round(compress(s.x, 2950, 4320) * 10) / 10,
  y: Math.round(compress(s.y, 2850, 3890) * 10) / 10,
  labelAnchor: s.labelAnchor,
}))

// 구 초기 배치는 루프 관통을 피하려고 도심 역까지 바깥으로 밀었다.
// 2호선 내부 역은 공개 역 좌표를 순환부에 투영해 도심의 공간 관계를 복원한다.
// 기본 위경도 비율에 가까운 4개 순환역의 도식 변위를 보간한다. 운행 순서는 바꾸지 않는다.
const loopCodes = line('L-S1102').stationCodes
const loopGeo = loopCodes.map(station)
const loopPositions = stations.filter(s => loopCodes.includes(s.stationCode))
const loopLeft = Math.min(...loopPositions.map(s => s.x)), loopRight = Math.max(...loopPositions.map(s => s.x))
const loopTop = Math.min(...loopPositions.map(s => s.y)), loopBottom = Math.max(...loopPositions.map(s => s.y))
const minLng = Math.min(...loopGeo.map(s => s.lng)), maxLng = Math.max(...loopGeo.map(s => s.lng))
const minLat = Math.min(...loopGeo.map(s => s.lat)), maxLat = Math.max(...loopGeo.map(s => s.lat))
/** @param {{ lat: number, lng: number }} s */
const project = s => ({ x: loopLeft + (s.lng - minLng) / (maxLng - minLng) * (loopRight - loopLeft),
  y: loopBottom - (s.lat - minLat) / (maxLat - minLat) * (loopBottom - loopTop) })
/** @param {{ lat: number, lng: number }} s */
function insideLoop(s) {
  let inside = false
  for (let i = 0, j = loopGeo.length - 1; i < loopGeo.length; j = i++) {
    const a = loopGeo[i], b = loopGeo[j]
    if ((a.lat > s.lat) !== (b.lat > s.lat) && s.lng < (b.lng - a.lng) * (s.lat - a.lat) / (b.lat - a.lat) + a.lng) inside = !inside
  }
  return inside
}
for (const s of stations) {
  const geo = station(s.stationCode)
  if (loopCodes.includes(s.stationCode) || !insideLoop(geo)) continue
  const p = project(geo)
  const anchors = loopPositions.map(a => ({ a, geo: station(a.stationCode), p: project(station(a.stationCode)) }))
    .map(a => ({ ...a, distance: Math.hypot((geo.lng - a.geo.lng) * .8, geo.lat - a.geo.lat) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 4)
  const weight = anchors.reduce((sum, a) => sum + 1 / Math.max(1e-8, a.distance ** 2), 0)
  s.x = p.x + anchors.reduce((sum, a) => sum + (a.a.x - a.p.x) / Math.max(1e-8, a.distance ** 2), 0) / weight
  s.y = p.y + anchors.reduce((sum, a) => sum + (a.a.y - a.p.y) / Math.max(1e-8, a.distance ** 2), 0) / weight
}

// 바깥 구간 압축으로 심볼이 포개지는 것을 풀되 원본 위치에서 무한히 표류하지 않게 한다.
const origin = stations.map(s => ({ x: s.x, y: s.y }))
for (let pass = 0; pass < 180; pass++) {
  let overlap = false
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const a = stations[i], b = stations[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      if (d >= 22) continue
      overlap = true
      const theta = d < .01 ? (i + j) * 2.399963 : Math.atan2(dy, dx)
      const push = (22 - d) * .51
      a.x -= Math.cos(theta) * push; a.y -= Math.sin(theta) * push
      b.x += Math.cos(theta) * push; b.y += Math.sin(theta) * push
    }
  }
  if (!overlap) break
  if (pass < 100) stations.forEach((s, i) => { s.x += (origin[i].x - s.x) * .01; s.y += (origin[i].y - s.y) * .01 })
}
const left = Math.min(...stations.map(s => s.x)) - 100
const top = Math.min(...stations.map(s => s.y)) - 100
for (const s of stations) { s.x = Math.round((s.x - left) * 10) / 10; s.y = Math.round((s.y - top) * 10) / 10 }
const positions = new Map(stations.map(s => [s.stationCode, s]))
/** @param {string} code @returns {import('./line-map/types.js').Point} */
const point = code => { const s = positions.get(code); if (!s) throw new Error(`Missing position ${code}`); return [s.x, s.y] }

// 꺾임점은 역이 아니다. 공유 역을 옮기지 않고 수평·수직·45도 경로를 만든다.
/** @param {import('./line-map/types.js').Point} a @param {import('./line-map/types.js').Point} b @returns {import('./line-map/types.js').Point[]} */
function connect(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const diagonal = Math.min(Math.abs(dx), Math.abs(dy))
  /** @type {import('./line-map/types.js').Point} */
  const bend = [a[0] + Math.sign(dx) * diagonal, a[1] + Math.sign(dy) * diagonal]
  return diagonal < .1 || Math.abs(Math.abs(dx) - Math.abs(dy)) < .1 ? [b] : [bend, b]
}
const paths = routes.map(r => {
  const stationCodes = r.names.map(name => {
    const code = byName.get(name)
    if (!code) throw new Error(`Unknown station ${name} in ${r.id}`)
    return code
  })
  const seq = r.closed ? [...stationCodes, stationCodes[0]] : stationCodes
  const polyline = [point(seq[0])]
  for (let i = 1; i < seq.length; i++) polyline.push(...connect(point(seq[i - 1]), point(seq[i])))
  return { id: r.id, lineCode: r.lineCode, stationCodes, closed: Boolean(r.closed), polyline }
})
const overviewNames = new Set(['서울','시청','홍대입구','왕십리','청량리','고속터미널','강남','잠실','사당','신도림','김포공항','인천역','인천공항1터미널','수원역','부평','상봉','노원','디지털미디어시티','여의도','금정역','정자','판교'])
for (const item of stations) {
  if (overviewNames.has(station(item.stationCode).name)) item.labelPriority = 2
}
const doc = {
  schemaVersion: 2,
  revision: '2026-10-06',
  source: { type: 'authored-geometry', description: '기존 자체 도식의 도심 확대·분기 교정. 공식 노선도 이미지는 포함하지 않음.', topologyReference: 'https://data.seoul.go.kr/dataList/OA-22535/F/1/datasetView.do', topologyReferenceDate: '2025-09-29' },
  viewBox: { width: Math.ceil(Math.max(...stations.map(s => s.x)) + 120), height: Math.ceil(Math.max(...stations.map(s => s.y)) + 100) },
  lines: paths,
  stations,
}
const json = JSON.stringify(doc, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8').replaceAll('\r\n', '\n') !== json) throw new Error('노선도 산출물이 원본과 다릅니다. node scripts/build-line-map.mjs 실행 필요')
} else writeFileSync(output, json)
console.log(`노선도 ${stations.length}역 / ${paths.length}경로 / ${new Set(paths.map(p => p.lineCode)).size}노선 항목, ${doc.viewBox.width}×${doc.viewBox.height}`)
