import doc from './metro-seoul.json'

/** 스펙 15: DB 자연키와 도식 좌표를 연결하며 꺾임점은 역 목록과 별도로 관리한다. */
export type LabelAnchor = 'top' | 'bottom' | 'left' | 'right'
export type LineMapStation = {
  stationCode: string
  x: number
  y: number
  labelAnchor: LabelAnchor
  labelPriority?: number
  labelOffset?: { x: number; y: number }
  labelLines?: string[]
}
export type LineMapLine = {
  id: string
  lineCode: string
  polyline: [number, number][]
  stationCodes: string[]
  closed: boolean
}
export type LineMapDocument = {
  schemaVersion: number
  revision: string
  viewBox: { width: number; height: number }
  lines: LineMapLine[]
  stations: LineMapStation[]
}
export const lineMap: LineMapDocument = {
  ...doc,
  lines: doc.lines.map(line => ({ ...line, polyline: line.polyline.map(([x, y]): [number, number] => [x, y]) })),
  stations: doc.stations.map(station => ({ ...station, labelAnchor: station.labelAnchor as LabelAnchor })),
}
export const stationGeometryByCode = new Map(lineMap.stations.map(s => [s.stationCode, s]))

/** 대표색과 소속을 분리한다. 환승 필터는 이 집합 전체를 검사해야 한다. */
export const lineCodesByStationCode: ReadonlyMap<string, readonly string[]> = (() => {
  const result = new Map<string, string[]>()
  for (const path of lineMap.lines) {
    for (const code of path.stationCodes) {
      const codes = result.get(code) ?? []
      if (!codes.includes(path.lineCode)) codes.push(path.lineCode)
      result.set(code, codes)
    }
  }
  return result
})()
