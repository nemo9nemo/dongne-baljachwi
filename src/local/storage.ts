import { initialState, photoIds, type LocalState, type StoredPhoto } from './model'
import { isNativeDevice } from './platform'

const DB_NAME = 'dongne-baljachwi-device-v1'
let database: Promise<IDBDatabase> | null = null
let cached: LocalState | null = null
const listeners = new Set<() => void>()
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(DB_NAME)

function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state')
      request.result.createObjectStore('photos', { keyPath: 'id' })
    }
    request.onerror = () => {
      database = null
      reject(new Error('기기 저장소를 열지 못했어요. 브라우저의 저장 공간 허용을 확인해주세요.'))
    }
    request.onblocked = () => reject(new Error('다른 탭을 닫고 다시 시도해주세요.'))
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        database = null
      }
      resolve(request.result)
    }
  })
  return database
}
function notify(state: LocalState, broadcast: boolean): void {
  if (cached && state.version < cached.version) return
  cached = state
  for (const listener of listeners) listener()
  if (broadcast) channel?.postMessage(state.version)
}
channel?.addEventListener('message', () => {
  void loadState().catch(() => {
    /* 기존 화면 데이터를 보존한다. */
  })
})

export async function loadState(): Promise<LocalState> {
  if (isNativeDevice) {
    const state = await (await import('./native-storage')).nativeReadState()
    notify(state, false)
    return state
  }
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readwrite')
    const store = transaction.objectStore('state')
    const request = store.get('current')
    let state: LocalState
    request.onsuccess = () => {
      state = request.result ?? initialState()
      if (!request.result) store.put(state, 'current')
    }
    transaction.oncomplete = () => {
      notify(state, false)
      resolve(state)
    }
    transaction.onabort = () =>
      reject(new Error('저장소를 읽지 못했어요. 데이터를 삭제하지 말고 다시 시도해주세요.'))
  })
}
export function getState(): LocalState {
  if (!cached) throw new Error('저장소를 준비하고 있어요.')
  return cached
}
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 상태·사진은 한 IDB 트랜잭션으로 확정된다. 다른 탭도 읽은 버전이 아닌 최신 상태에 작업한다. */
export async function mutate(
  change: (state: LocalState) => void,
  photos: StoredPhoto[] = []
): Promise<LocalState> {
  if (isNativeDevice) {
    const state = await (await import('./native-storage')).nativeMutate(change, photos)
    notify(state, true)
    return state
  }
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['state', 'photos'], 'readwrite')
    const store = transaction.objectStore('state')
    const request = store.get('current')
    let state: LocalState, failure: unknown
    request.onsuccess = () => {
      try {
        state = request.result ?? initialState()
        const oldPhotos = photoIds(state)
        change(state)
        state.version++
        const keep = photoIds(state),
          blobs = transaction.objectStore('photos')
        for (const photo of photos) if (keep.has(photo.id)) blobs.put(photo)
        for (const id of oldPhotos) if (!keep.has(id)) blobs.delete(id)
        store.put(state, 'current')
      } catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => {
      notify(state, true)
      resolve(state)
    }
    transaction.onabort = () =>
      reject(
        failure ??
          new Error('저장하지 못했어요. 기기 저장 공간을 확인해주세요. 기존 기록은 그대로 있어요.')
      )
  })
}
export async function getPhoto(id: string, thumbnail = false): Promise<Blob | null> {
  if (isNativeDevice) return (await import('./native-storage')).nativeGetPhoto(id, thumbnail)
  const db = await open()
  return new Promise((resolve, reject) => {
    const request = db.transaction('photos').objectStore('photos').get(id)
    request.onsuccess = () =>
      resolve(
        (thumbnail ? (request.result?.thumbnail ?? request.result?.blob) : request.result?.blob) ??
          null
      )
    request.onerror = () => reject(new Error('사진을 읽지 못했어요.'))
  })
}
export async function requestPersistence(): Promise<boolean> {
  if (isNativeDevice) return true
  return navigator.storage?.persist ? navigator.storage.persist() : false
}
