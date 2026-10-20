import { stationByCode } from './catalog'
import { todayKst } from '../lib/format-date'

export const SCHEMA = 1
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
export const MAX_TRANSFER_BYTES = 256 * 1024 * 1024
export type LocalPhoto = {
  id: string
  bytes: number
  width: number
  height: number
  hash: string
  type: 'image/jpeg'
}
export type LocalRecord = {
  id: string
  stationCode: string
  date: string
  place: string
  note: string
  tags: string[]
  mood: string
  weather: string
  photos: LocalPhoto[]
  revision: number
  createdAt: string
  updatedAt: string
  author: string
  originId?: string
}
export type ShareLink = {
  roomId: string
  token: string
  role: 'host' | 'guest'
  code: string
  server: string
  remoteMapId: string | null
  sourceRevision: number
  lastSync: string | null
}
export type LocalMap = {
  id: string
  title: string
  records: LocalRecord[]
  revision: number
  share: ShareLink | null
  source?: {
    mapId: string
    disconnectedAt: string
    lastSync: string | null
    kind?: 'share' | 'backup'
  }
}
export type PendingRevocation = { server: string; roomId: string; token: string }
export type LocalState = {
  schema: 1
  version: number
  deviceId: string
  name: string
  selectedMapId: string
  maps: LocalMap[]
  revocations: PendingRevocation[]
  lastBackup: string | null
  backupVersion: number | null
}
export type StoredPhoto = { id: string; blob: Blob; thumbnail?: Blob }
export type SharedSnapshot = {
  schema: 1
  title: string
  mapId: string
  revision: number
  records: LocalRecord[]
}

export function newMap(title = '내 발자취'): LocalMap {
  return { id: crypto.randomUUID(), title, records: [], revision: 0, share: null }
}
export function initialState(): LocalState {
  const map = newMap()
  return {
    schema: 1,
    version: 0,
    deviceId: crypto.randomUUID(),
    name: '나',
    selectedMapId: map.id,
    maps: [map],
    revocations: [],
    lastBackup: null,
    backupVersion: null
  }
}
export function currentMap(state: LocalState): LocalMap {
  const map = state.maps.find((item) => item.id === state.selectedMapId)
  if (!map) throw new Error('선택한 맵을 찾을 수 없어요.')
  return map
}
export function isReadOnly(map: LocalMap): boolean {
  return map.share?.role === 'guest'
}
export function photoIds(state: LocalState): Set<string> {
  return new Set(
    state.maps.flatMap((map) =>
      map.records.flatMap((record) => record.photos.map((photo) => photo.id))
    )
  )
}
export function disconnectMap(map: LocalMap): void {
  if (!map.share) return
  map.source = {
    mapId: map.share.remoteMapId ?? map.id,
    disconnectedAt: new Date().toISOString(),
    lastSync: map.share.lastSync,
    kind: 'share'
  }
  map.share = null
  map.revision++
}

const idPattern = /^[a-zA-Z0-9_-]{1,100}$/
const hashPattern = /^[a-f0-9]{64}$/
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('기록 형식이 올바르지 않아요.')
  return value as Record<string, unknown>
}
export function safeId(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value))
    throw new Error('기록 식별자가 올바르지 않아요.')
  return value
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || [...value].length > max)
    throw new Error('기록의 글자 수나 형식이 올바르지 않아요.')
  return value.normalize('NFC')
}
function integer(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max)
    throw new Error('기록의 크기나 버전이 올바르지 않아요.')
  return value as number
}
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
export function validateRecord(value: unknown, imported = false): LocalRecord {
  const item = object(value)
  const date = string(item.date, 10)
  if (!validDate(date) || (!imported && date > todayKst()))
    throw new Error('방문 날짜는 오늘까지 선택할 수 있어요.')
  const stationCode = string(item.stationCode, 100)
  if (!stationByCode.has(stationCode))
    throw new Error('지원하지 않는 역이에요. 앱을 업데이트하고 다시 시도해주세요.')
  if (
    !Array.isArray(item.tags) ||
    item.tags.length > 20 ||
    !Array.isArray(item.photos) ||
    item.photos.length > 10
  )
    throw new Error('태그나 사진 개수가 너무 많아요.')
  const photos = item.photos.map((value) => {
    const photo = object(value)
    if (
      photo.type !== 'image/jpeg' ||
      typeof photo.hash !== 'string' ||
      !hashPattern.test(photo.hash)
    )
      throw new Error('사진 정보가 올바르지 않아요.')
    return {
      id: safeId(photo.id),
      bytes: integer(photo.bytes, MAX_PHOTO_BYTES),
      width: integer(photo.width, 20000),
      height: integer(photo.height, 20000),
      hash: photo.hash,
      type: 'image/jpeg' as const
    }
  })
  if (
    new Set(photos.map((photo) => photo.id)).size !== photos.length ||
    photos.some((photo) => !photo.bytes || !photo.width || !photo.height)
  )
    throw new Error('사진 정보가 중복되거나 비어 있어요.')
  const createdAt = string(item.createdAt, 32),
    updatedAt = string(item.updatedAt, 32)
  if (Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt)))
    throw new Error('기록 시각이 올바르지 않아요.')
  return {
    id: safeId(item.id),
    stationCode,
    date,
    place: string(item.place, 80).trim(),
    note: string(item.note, 1000),
    tags: [...new Set(item.tags.map((tag) => string(tag, 30).trim()).filter(Boolean))],
    mood: string(item.mood, 20),
    weather: string(item.weather, 20),
    photos,
    revision: integer(item.revision, Number.MAX_SAFE_INTEGER),
    createdAt,
    updatedAt,
    author: string(item.author, 40),
    ...(item.originId === undefined ? {} : { originId: safeId(item.originId) })
  }
}
export function validateSnapshot(value: unknown): SharedSnapshot {
  const snapshot = object(value)
  if (
    snapshot.schema !== SCHEMA ||
    !Array.isArray(snapshot.records) ||
    snapshot.records.length > 5000
  )
    throw new Error('맵 형식이나 기록 수를 확인해주세요.')
  const records = snapshot.records.map((item) => validateRecord(item, true))
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw new Error('중복된 기록이 있어요.')
  const photos = new Map<string, LocalPhoto>()
  for (const record of records)
    for (const photo of record.photos) {
      const previous = photos.get(photo.id)
      if (previous && (previous.hash !== photo.hash || previous.bytes !== photo.bytes))
        throw new Error('사진 정보가 충돌해요.')
      photos.set(photo.id, photo)
    }
  if ([...photos.values()].reduce((sum, photo) => sum + photo.bytes, 0) > MAX_TRANSFER_BYTES)
    throw new Error('맵은 사진 포함 256MB까지 한 번에 전달할 수 있어요.')
  return {
    schema: 1,
    title: string(snapshot.title, 60).trim() || '받은 발자취',
    mapId: safeId(snapshot.mapId),
    revision: integer(snapshot.revision, Number.MAX_SAFE_INTEGER),
    records
  }
}
export async function digest(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
