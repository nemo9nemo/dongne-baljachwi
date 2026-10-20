import source from '../../scripts/line-map/metro-seoul-source.json'
import { lineMap, lineCodesByStationCode } from '../data/line-map'

const names = new Map(source.stations.map((station) => [station.stationCode, station]))
export const localLines = source.lines.map((line) => ({
  code: line.lineCode,
  name: line.name,
  color: `var(--${line.colorToken})`
}))
export const catalog = lineMap.stations.map((station) => {
  const info = names.get(station.stationCode)
  return {
    ...station,
    code: station.stationCode,
    name: info?.name ?? station.stationCode,
    lat: info?.lat ?? null,
    lng: info?.lng ?? null,
    lineCodes: [...(lineCodesByStationCode.get(station.stationCode) ?? [])]
  }
})
export const stationByCode = new Map(catalog.map((station) => [station.code, station]))

export function searchStations(query: string) {
  const normalized = query.trim().replace(/역$/, '').normalize('NFC').toLocaleLowerCase('ko')
  return normalized
    ? catalog
        .filter((station) => station.name.toLocaleLowerCase('ko').includes(normalized))
        .slice(0, 12)
    : []
}
