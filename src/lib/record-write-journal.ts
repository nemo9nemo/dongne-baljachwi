import { STORAGE_PREFIX } from './app-storage'
import { isMood, isWeather } from './mood-weather'
import type { Mood, Weather, RecordPhotoInput, SaveRecordArgs, SyncRecordPhotosArgs } from './database.types'

export type RecordForm = {
  placeName?: string
  stationId: string | null
  visitedOn: string
  mood: Mood | null
  weather: Weather | null
  note: string
  tags: string[]
}
export type PendingRecordWrite =
  | { kind: 'body'; args: SaveRecordArgs; form: RecordForm; newPhotoCount: number; photoPlan: RecordPhotoInput[] }
  | { kind: 'photos'; args: SyncRecordPhotosArgs; form: RecordForm }

export function recordWriteKey(userId: string, coupleId: string, routeId: string | null): string {
  return `${STORAGE_PREFIX}record-write.${userId}.${coupleId}.${routeId ?? 'new'}`
}

/** D04: Blob은 넣지 않는다. 같은 요청의 불변 값과 ID만 계정/공간별로 복구한다. */
export function readPendingWrite(key: string): PendingRecordWrite | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return null
    const value = raw as Record<string, unknown>
    if (value.kind !== 'body' && value.kind !== 'photos') return null
    if (typeof value.args !== 'object' || value.args === null || typeof value.form !== 'object' || value.form === null) return null
    const args = value.args as Record<string, unknown>
    const form = value.form as Record<string, unknown>
    if (form.placeName !== undefined && typeof form.placeName !== 'string') return null
    if (args.p_place_name !== undefined && args.p_place_name !== null && typeof args.p_place_name !== 'string') return null
    if (typeof args.p_record_id !== 'string' || typeof args.p_operation_id !== 'string'
      || typeof form.note !== 'string' || typeof form.visitedOn !== 'string' || !Array.isArray(form.tags)
      || !form.tags.every(tag => typeof tag === 'string')
      || (form.stationId !== null && typeof form.stationId !== 'string')
      || (form.mood !== null && !isMood(form.mood)) || (form.weather !== null && !isWeather(form.weather))) return null
    if (value.kind === 'body' && (typeof args.p_create !== 'boolean' || typeof args.p_station_id !== 'string'
      || typeof args.p_visited_on !== 'string' || !Array.isArray(args.p_tags) || !Number.isInteger(value.newPhotoCount) || !Array.isArray(value.photoPlan))) return null
    if (value.kind === 'photos' && (!Array.isArray(args.p_photos) || !Number.isInteger(args.p_expected_revision))) return null
    // 서버도 요청 전체를 재검증한다. 이 캐스팅은 복구 UI의 최소 구조 검사 뒤에만 허용한다.
    return value as PendingRecordWrite
  } catch { return null }
}

export function persistPendingWrite(key: string, value: PendingRecordWrite | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch { return false }
}
