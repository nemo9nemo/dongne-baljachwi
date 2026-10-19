export type Point = [number, number]
export type Station = {
  stationCode: string
  x: number
  y: number
  labelAnchor: 'top' | 'bottom' | 'left' | 'right'
  labelPriority?: number
  labelOffset?: { x: number; y: number }
  labelLines?: string[]
}
export type Geometry = {
  schemaVersion: number
  revision: string
  viewBox: { width: number; height: number }
  stations: Station[]
  lines: { id: string; lineCode: string; stationCodes: string[]; closed: boolean; polyline: Point[] }[]
}
export type Source = {
  stations: (Station & { name: string; lat: number; lng: number })[]
  lines: { lineCode: string; stationCodes: string[]; name: string; colorToken: string }[]
}
export type Route = { id: string; lineCode: string; names: string[]; closed?: boolean }
export type DbLine = { id: string; code: string; name: string; in_mvp_scope: boolean; is_active: boolean }
export type DbStation = { id: string; code: string; name_short: string; is_active: boolean }
export type DbMembership = { station_id: string; line_id: string }
