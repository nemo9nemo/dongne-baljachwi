import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { validateGeometry } from '../../scripts/line-map/validate.mjs'

// 순수 UI 계산을 실제 TS 소스로 검사한다. 테스트용 복제 구현은 만들지 않는다.
async function loadTs(path) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { maxZoom, clampTransform, stationCandidates, placeLabels } = await loadTs('../../src/screens/lines/line-map-layout.ts')
const { searchStations } = await loadTs('../../src/lib/station-search.ts')
const doc = JSON.parse(readFileSync(new URL('../../src/data/line-map/metro-seoul.json', import.meta.url), 'utf8'))
const source = JSON.parse(readFileSync(new URL('../../scripts/line-map/metro-seoul-source.json', import.meta.url), 'utf8'))
const code = name => source.stations.find(s => s.name === name).stationCode
function hasEdge(lineCode, a, b) {
  return doc.lines.filter(l => l.lineCode === lineCode).some(l => {
    const seq = l.closed ? [...l.stationCodes, l.stationCodes[0]] : l.stationCodes
    return seq.some((c, i) => c === code(a) && seq[i + 1] === code(b) || c === code(b) && seq[i + 1] === code(a))
  })
}

test('전체 도식 계약과 기존 역 코드 보존', () => {
  assert.deepEqual(validateGeometry(doc), [])
  assert.deepEqual(new Set(doc.stations.map(s => s.stationCode)), new Set(source.stations.map(s => s.stationCode)))
  assert.equal(doc.stations.length, source.stations.length)
  assert.ok(doc.lines.length > source.lines.length, '본선과 지선이 별도 경로여야 함')
})
test('분기·순환의 실제 접점과 잘못된 직결 회귀', () => {
  for (const [line, a, b] of [
    ['L-S1121', '성수', '용답'], ['L-S1122', '신도림', '도림천'], ['L-S1122', '신정네거리', '까치산'],
    ['L-I4101', '금천구청역', '광명역'], ['L-I4101', '병점역', '서동탄역'],
    ['L-S1105', '강동', '둔촌동'], ['L-S1105', '강동', '길동'], ['L-S1106', '구산', '응암'],
    ['L-I4108', '가좌역', '신촌역'], ['L-I4108', '신촌역', '서울'],
  ]) assert.ok(hasEdge(line, a, b), `${a} → ${b}`)
  for (const [line, a, b] of [['L-I4101', '광명역', '관악역'], ['L-I4101', '서동탄역', '세마역'], ['L-S1105', '마천', '천호']]) {
    assert.equal(hasEdge(line, a, b), false, `${a} → ${b} 허위 직결`)
  }
  assert.equal(doc.lines.find(l => l.lineCode === 'L-S1102').closed, true)
})
test('환승역의 모든 노선 소속을 유지', () => {
  const hongdae = doc.lines.filter(l => l.stationCodes.includes(code('홍대입구'))).map(l => l.lineCode)
  for (const line of ['L-S1102', 'L-I28A1', 'L-I4108']) assert.ok(hongdae.includes(line))
})
test('잘못된 좌표·경로·코드·순환은 정합성 실패', () => {
  for (const change of [
    d => { d.stations[0].x = NaN },
    d => { d.lines[0].stationCodes[0] = 'missing' },
    d => { d.lines[1].id = d.lines[0].id },
    d => { d.lines[0].polyline.at(-1)[0] += 20 },
    d => { d.stations[0].labelOffset = { x: Infinity, y: 0 } },
  ]) { const broken = structuredClone(doc); change(broken); assert.ok(validateGeometry(broken).length) }
})
test('360/390/480/1280px에서 상세 역명 배율까지 확대 가능', () => {
  for (const width of [360, 390, 480, 1280]) {
    const base = Math.min(width / doc.viewBox.width, 500 / doc.viewBox.height)
    assert.ok(Math.abs(base * maxZoom(base) - 3) < 1e-9)
    const transform = { k: 1000, tx: -1e9, ty: 1e9 }
    clampTransform(transform, doc.viewBox.width, doc.viewBox.height, maxZoom(base))
    assert.equal(transform.k, maxZoom(base))
    assert.ok(transform.tx > -1e9 && transform.ty < 1e9)
  }
})
test('터치 후보는 화면의 22px 기준이며 밀집 역을 모두 반환', () => {
  const stations = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 30, y: 0 }]
  assert.deepEqual(stationCandidates(stations, 0, 0, 1).map(c => c.station.id), ['a', 'b'])
  assert.deepEqual(stationCandidates(stations, 0, 0, 3).map(c => c.station.id), ['a'])
  assert.equal(stationCandidates(stations, 100, 100, 1).length, 0)
})
test('초성·혼합 입력·공백·역 접미사 및 비활성 역 검색', () => {
  const stations = ['홍대입구', '홍제', '서울', '역삼', '강남'].map(name => ({ name, name_short: name, is_active: name !== '홍제' }))
  for (const query of ['ㅎㄷ', '홍ㄷ', ' 홍 대 ', '홍대입구역']) assert.equal(searchStations(stations, query)[0].name, '홍대입구')
  assert.equal(searchStations(stations, '서울역')[0].name, '서울')
  assert.equal(searchStations(stations, '역삼')[0].name, '역삼')
  assert.equal(searchStations(stations, '홍제').length, 0)
  assert.equal(searchStations(stations, ' ').length, 0)
})
test('전체 보기 주요 역·선택 역, 상세 보기 일반 역 라벨과 충돌 처리', () => {
  const stations = ['주요', '일반', '선택'].map((name, i) => ({ code: name, name, x: 100 + i * 160, y: 150,
    labelLines: [name], labelAnchor: 'right', dimmed: false, labelPriority: i === 0 ? 2 : 0, isTransfer: false }))
  const viewport = { width: 600, height: 400, offsetX: 0, offsetY: 0 }
  const transform = { k: 1, tx: 0, ty: 0 }
  assert.deepEqual(placeLabels(stations, transform, .5, viewport, null).map(l => l.code), ['주요'])
  assert.ok(placeLabels(stations, transform, .5, viewport, '선택').some(l => l.code === '선택'))
  assert.equal(placeLabels(stations, transform, 1, viewport, null).length, 3)
  const overlap = [...stations, { ...stations[0], code: '겹침', labelLines: ['겹침'] }]
  const labels = placeLabels(overlap, transform, 1, viewport, null)
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j], sa = overlap.find(s => s.code === a.code), sb = overlap.find(s => s.code === b.code)
    assert.ok(sa.x + a.x + a.width <= sb.x + b.x || sb.x + b.x + b.width <= sa.x + a.x || sa.y + a.y + 5 <= sb.y + b.y - 13 || sb.y + b.y + 5 <= sa.y + a.y - 13)
  }
})
