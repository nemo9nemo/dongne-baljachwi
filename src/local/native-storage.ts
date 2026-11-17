import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection
} from '@capacitor-community/sqlite'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { initialState, photoIds, safeId, type LocalState, type StoredPhoto } from './model'

const sqlite = new SQLiteConnection(CapacitorSQLite)
let connection: Promise<SQLiteDBConnection> | null = null
let pending: Promise<unknown> = Promise.resolve()

async function database(): Promise<SQLiteDBConnection> {
  connection ??= (async () => {
    const consistent = await sqlite.checkConnectionsConsistency()
    const existing = await sqlite.isConnection('baljachwi_device', false)
    const db =
      consistent.result && existing.result
        ? await sqlite.retrieveConnection('baljachwi_device', false)
        : await sqlite.createConnection('baljachwi_device', false, 'no-encryption', 1, false)
    await db.open()
    await db.execute(
      'CREATE TABLE IF NOT EXISTS device_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS device_photos (id TEXT PRIMARY KEY, path TEXT NOT NULL, thumbnail TEXT);',
      false
    )
    const columns = await db.query('PRAGMA table_info(device_photos);')
    if (!columns.values?.some((column: { name: string }) => column.name === 'thumbnail'))
      await db.execute('ALTER TABLE device_photos ADD COLUMN thumbnail TEXT;', false)
    return db
  })().catch((error) => {
    connection = null
    throw error
  })
  return connection
}
function serial<T>(action: () => Promise<T>): Promise<T> {
  const result = pending.then(action, action)
  pending = result.catch(() => {})
  return result
}
async function read(db: SQLiteDBConnection): Promise<LocalState> {
  const rows = await db.query('SELECT value FROM device_state WHERE id=1;')
  const row = rows.values?.[0] as { value: string } | undefined
  if (!row) {
    const state = initialState()
    await db.run('INSERT INTO device_state(id,value) VALUES(1,?);', [JSON.stringify(state)])
    return state
  }
  const state = JSON.parse(row.value) as LocalState
  if (state.schema !== 1 || !Array.isArray(state.maps) || !state.maps.length)
    throw new Error('기기 DB의 버전을 확인해주세요. 기존 데이터를 삭제하지 마세요.')
  return state
}
export function nativeReadState(): Promise<LocalState> {
  return serial(async () => read(await database()))
}
async function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1]!)
    reader.onerror = () => reject(new Error('사진 파일을 준비하지 못했어요.'))
    reader.readAsDataURL(blob)
  })
}
async function remove(path: string): Promise<void> {
  if (/^photos\/[a-f0-9-]{36}\.jpg$/.test(path))
    await Filesystem.deleteFile({ directory: Directory.Library, path }).catch(() => {})
}
/** 사진을 새 경로에 먼저 쓴 뒤 DB 참조를 확정한다. 롤백하면 새 파일만 정리한다. */
export function nativeMutate(
  change: (state: LocalState) => void,
  photos: StoredPhoto[]
): Promise<LocalState> {
  return serial(async () => {
    const db = await database(),
      state = await read(db),
      oldIds = photoIds(state)
    change(state)
    state.version++
    const keep = photoIds(state),
      created: { id: string; path: string; thumbnail: string | null }[] = [],
      garbage: string[] = []
    let transaction = false
    try {
      for (const photo of photos)
        if (keep.has(photo.id)) {
          safeId(photo.id)
          const path = 'photos/' + crypto.randomUUID() + '.jpg'
          await Filesystem.writeFile({
            directory: Directory.Library,
            path,
            data: await base64(photo.blob),
            recursive: true
          })
          const saved = { id: photo.id, path, thumbnail: null as string | null }
          created.push(saved)
          if (photo.thumbnail) {
            saved.thumbnail = 'photos/' + crypto.randomUUID() + '.jpg'
            await Filesystem.writeFile({
              directory: Directory.Library,
              path: saved.thumbnail,
              data: await base64(photo.thumbnail),
              recursive: true
            })
          }
        }
      await db.beginTransaction()
      transaction = true
      for (const photo of created) {
        const existing = await db.query('SELECT path,thumbnail FROM device_photos WHERE id=?;', [
          photo.id
        ])
        const row = existing.values?.[0] as { path: string; thumbnail: string | null } | undefined
        if (row) {
          garbage.push(row.path)
          if (row.thumbnail) garbage.push(row.thumbnail)
        }
        await db.run(
          'INSERT OR REPLACE INTO device_photos(id,path,thumbnail) VALUES(?,?,?);',
          [photo.id, photo.path, photo.thumbnail],
          false
        )
      }
      for (const id of oldIds)
        if (!keep.has(id)) {
          const existing = await db.query('SELECT path,thumbnail FROM device_photos WHERE id=?;', [
            id
          ])
          const row = existing.values?.[0] as { path: string; thumbnail: string | null } | undefined
          if (row) {
            garbage.push(row.path)
            if (row.thumbnail) garbage.push(row.thumbnail)
          }
          await db.run('DELETE FROM device_photos WHERE id=?;', [id], false)
        }
      await db.run('UPDATE device_state SET value=? WHERE id=1;', [JSON.stringify(state)], false)
      await db.commitTransaction()
      transaction = false
    } catch (error) {
      if (transaction) await db.rollbackTransaction().catch(() => {})
      for (const item of created) {
        await remove(item.path)
        if (item.thumbnail) await remove(item.thumbnail)
      }
      throw error
    }
    for (const path of garbage) await remove(path)
    return state
  })
}
export async function nativeGetPhoto(id: string, thumbnail = false): Promise<Blob | null> {
  safeId(id)
  const db = await database(),
    rows = await db.query('SELECT path,thumbnail FROM device_photos WHERE id=?;', [id])
  const row = rows.values?.[0] as { path: string; thumbnail: string | null } | undefined
  const path = thumbnail ? (row?.thumbnail ?? row?.path) : row?.path
  if (!path || !/^photos\/[a-f0-9-]{36}\.jpg$/.test(path)) return null
  try {
    const file = await Filesystem.readFile({ directory: Directory.Library, path })
    if (typeof file.data !== 'string') return file.data
    const value = atob(file.data),
      bytes = new Uint8Array(value.length)
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i)
    return new Blob([bytes], { type: 'image/jpeg' })
  } catch {
    return null
  }
}
