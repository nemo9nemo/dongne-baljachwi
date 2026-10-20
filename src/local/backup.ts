import {
  digest,
  MAX_TRANSFER_BYTES,
  newMap,
  validateSnapshot,
  type LocalMap,
  type LocalState,
  type SharedSnapshot,
  type StoredPhoto
} from './model'
import { getPhoto, mutate } from './storage'
import { prepareThumbnail } from '../lib/image-preparation'

const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true })
const plainMagic = encoder.encode('BALJ0001'),
  encryptedMagic = encoder.encode('BALJENC1')
const ITERATIONS = 310_000
const MAX_MANIFEST = 12 * 1024 * 1024
type BackupManifest = {
  schema: 1
  createdAt: string
  name: string
  maps: SharedSnapshot[]
  files: { id: string; bytes: number; hash: string }[]
}

async function keyFor(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (password.length < 8) throw new Error('백업 암호를 8자 이상 입력해주세요.')
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey'
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}
export async function createBackup(state: LocalState, password: string): Promise<Blob> {
  const files = new Map(
    state.maps.flatMap((map) =>
      map.records.flatMap((record) => record.photos.map((photo) => [photo.id, photo] as const))
    )
  )
  const blobs: Blob[] = []
  let bytes = 0
  for (const photo of files.values()) {
    bytes += photo.bytes
    if (bytes > MAX_TRANSFER_BYTES) throw new Error('백업 한 번의 사진 합계는 256MB까지 지원해요.')
    const blob = await getPhoto(photo.id)
    if (!blob || blob.size !== photo.bytes || (await digest(blob)) !== photo.hash)
      throw new Error('일부 사진을 찾지 못했어요. 기록을 확인한 뒤 다시 백업해주세요.')
    blobs.push(blob)
  }
  const manifest: BackupManifest = {
    schema: 1,
    createdAt: new Date().toISOString(),
    name: state.name,
    maps: state.maps.map((map) => validateSnapshot({
      schema: 1,
      title: map.title,
      mapId: map.id,
      revision: map.revision,
      records: map.records
    })),
    files: [...files.values()].map((photo) => ({
      id: photo.id,
      bytes: photo.bytes,
      hash: photo.hash
    }))
  }
  const json = encoder.encode(JSON.stringify(manifest))
  if (json.length > MAX_MANIFEST) throw new Error('백업의 기록 정보가 너무 커요.')
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, json.length)
  const plain = new Blob([plainMagic, length, json, ...blobs])
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12))
  const header = new Uint8Array([...encryptedMagic, ...salt, ...iv])
  const key = await keyFor(password, salt)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: header },
    key,
    await plain.arrayBuffer()
  )
  return new Blob([header, encrypted], { type: 'application/octet-stream' })
}
export async function readBackup(
  file: Blob,
  password: string
): Promise<{ maps: LocalMap[]; photos: StoredPhoto[] }> {
  if (file.size < 56 || file.size > MAX_TRANSFER_BYTES + MAX_MANIFEST + 56)
    throw new Error('백업 파일 크기를 확인해주세요.')
  const header = new Uint8Array(await file.slice(0, 36).arrayBuffer())
  if (decoder.decode(header.slice(0, 8)) !== 'BALJENC1')
    throw new Error('동네 발자취 백업 파일이 아니거나 지원하지 않는 버전이에요.')
  let decrypted: ArrayBuffer
  try {
    const key = await keyFor(password, header.slice(8, 24))
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: header.slice(24, 36), additionalData: header },
      key,
      await file.slice(36).arrayBuffer()
    )
  } catch {
    throw new Error('백업 암호가 다르거나 파일이 손상됐어요. 기존 기록은 그대로 있어요.')
  }
  const plain = new Blob([decrypted])
  if (decoder.decode(await plain.slice(0, 8).arrayBuffer()) !== 'BALJ0001')
    throw new Error('백업 형식이 올바르지 않아요.')
  const length = new DataView(await plain.slice(8, 12).arrayBuffer()).getUint32(0)
  if (!length || length > MAX_MANIFEST || length + 12 > plain.size)
    throw new Error('백업 목록이 손상됐어요.')
  const value: unknown = JSON.parse(
    decoder.decode(await plain.slice(12, 12 + length).arrayBuffer())
  )
  if (!value || typeof value !== 'object') throw new Error('백업 목록이 올바르지 않아요.')
  const manifest = value as Partial<BackupManifest>
  if (
    manifest.schema !== 1 ||
    !Array.isArray(manifest.maps) ||
    !manifest.maps.length ||
    manifest.maps.length > 30 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 50000
  )
    throw new Error('지원하지 않는 백업이에요.')
  const snapshots = manifest.maps.map(validateSnapshot)
  const expected = new Map<
    string,
    (typeof snapshots)[number]['records'][number]['photos'][number]
  >()
  for (const map of snapshots)
    for (const record of map.records)
      for (const photo of record.photos) {
        const previous = expected.get(photo.id)
        if (previous && (previous.hash !== photo.hash || previous.bytes !== photo.bytes))
          throw new Error('백업의 맵 사이에서 사진 정보가 충돌해요.')
        expected.set(photo.id, photo)
      }
  if (manifest.files.length !== expected.size)
    throw new Error('백업의 사진 목록이 일치하지 않아요.')
  const seen = new Set<string>(),
    replacements = new Map<string, string>(),
    photos: StoredPhoto[] = []
  let offset = 12 + length
  for (const item of manifest.files) {
    if (!item || typeof item !== 'object') throw new Error('백업의 사진 목록이 올바르지 않아요.')
    const metadata = expected.get(item.id)
    if (
      !metadata ||
      seen.has(item.id) ||
      metadata.bytes !== item.bytes ||
      metadata.hash !== item.hash ||
      offset + item.bytes > plain.size
    )
      throw new Error('백업의 사진 크기나 목록이 일치하지 않아요.')
    seen.add(item.id)
    const blob = plain.slice(offset, offset + item.bytes, 'image/jpeg')
    if ((await digest(blob)) !== metadata.hash)
      throw new Error('손상된 사진이 있어 복원을 중단했어요.')
    offset += item.bytes
    const id = crypto.randomUUID()
    replacements.set(item.id, id)
    photos.push({ id, blob, thumbnail: await prepareThumbnail(blob) })
  }
  if (offset !== plain.size) throw new Error('백업에 알 수 없는 데이터가 있어요.')
  const maps = snapshots.map((snapshot) => {
    const map = newMap([...snapshot.title].slice(0, 54).join('') + ' · 복원')
    map.source = {
      mapId: snapshot.mapId,
      disconnectedAt: new Date().toISOString(),
      lastSync: null,
      kind: 'backup'
    }
    map.records = snapshot.records.map((record) => ({
      ...record,
      id: crypto.randomUUID(),
      originId: record.originId ?? record.id,
      photos: record.photos.map((photo) => ({ ...photo, id: replacements.get(photo.id)! }))
    }))
    return map
  })
  return { maps, photos }
}
export async function restoreBackup(file: Blob, password: string): Promise<void> {
  const imported = await readBackup(file, password)
  await mutate((state) => {
    if (state.maps.length + imported.maps.length > 30)
      throw new Error('맵은 최대 30개까지 보관할 수 있어요.')
    state.maps.push(...imported.maps)
    state.selectedMapId = imported.maps[0]!.id
  }, imported.photos)
}
