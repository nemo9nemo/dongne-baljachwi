import {
  disconnectMap,
  digest,
  newMap,
  safeId,
  validateSnapshot,
  type LocalPhoto,
  type ShareLink,
  type SharedSnapshot,
  type StoredPhoto
} from './model'
import { getPhoto, getState, mutate, subscribe } from './storage'
import { prepareThumbnail } from '../lib/image-preparation'

export type ShareStatus = {
  stage: 'waiting' | 'approval' | 'connecting' | 'connected' | 'syncing' | 'offline' | 'error'
  message: string
  phrase?: string
  guestName?: string
}
type SignalEvent = {
  sequence: number
  kind: 'join' | 'approved' | 'offer' | 'answer' | 'request'
  description?: RTCSessionDescriptionInit
  sessionId?: string
}
type PollResult = {
  instance: string
  status: 'waiting' | 'pending' | 'paired'
  phrase: string
  guestName: string
  events: SignalEvent[]
}
type Outgoing = { id: string; snapshot: SharedSnapshot; photos: Map<string, LocalPhoto> }
type Incoming = {
  id: string
  snapshot: SharedSnapshot
  idMap: Map<string, string>
  needed: Set<string>
  photos: StoredPhoto[]
  file: { id: string; size: number; parts: ArrayBuffer[]; received: number } | null
}

class SignalError extends Error {
  code: string
  constructor(code: string) {
    super(signalMessage(code))
    this.code = code
  }
}
function signalMessage(code: string): string {
  return (
    (
      {
        INVALID_CODE: '코드가 만료됐거나 사용할 수 없어요. 새 코드를 확인해주세요.',
        ROOM_CLOSED: '공유 연결이 해제됐어요.',
        CODE_EXPIRED: '연결 코드가 만료됐어요.',
        UNAUTHORIZED: '연결 권한이 유효하지 않아요.',
        TRY_LATER: '요청이 많아요. 잠시 후 다시 시도해주세요.',
        ORIGIN_NOT_ALLOWED: '이 앱 주소의 공유 연결을 서버에서 허용해야 해요.'
      } as Record<string, string>
    )[code] ?? '공유 연결 서버에 접속하지 못했어요. 주소와 네트워크를 확인해주세요.'
  )
}
export function signalingServer(value = ''): string {
  const url = new URL(value || import.meta.env.VITE_SHARE_SERVER || location.origin)
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('공유 연결 서버는 HTTPS 주소를 사용해주세요.')
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('공유 서버의 도메인 주소만 입력해주세요.')
  return url.origin
}
async function request<T>(
  server: string,
  path: string,
  method = 'GET',
  token?: string,
  data?: unknown,
  signal?: AbortSignal
): Promise<T> {
  let response: Response
  try {
    response = await fetch(signalingServer(server) + '/api/device-share' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
      credentials: 'omit'
    })
  } catch {
    throw new Error('공유 연결 서버에 접속하지 못했어요. 기존 기록은 기기에 남아 있어요.')
  }
  const result = (await response.json().catch(() => {
    throw new Error('공유 연결 서버 주소를 확인해주세요.')
  })) as { error?: string }
  if (!response.ok) throw new SignalError(result.error ?? 'CONNECTION_FAILED')
  return result as T
}
export async function createShare(mapId: string, server: string): Promise<void> {
  if (!('RTCPeerConnection' in window))
    throw new Error('이 환경은 기기 간 직접 연결을 지원하지 않아요.')
  const current=getState().maps.find(map=>map.id===mapId)
  if(!current || current.share) throw new Error('맵 상태를 다시 확인해주세요.')
  validateSnapshot({schema:1,mapId:current.id,title:current.title,revision:current.revision,records:current.records})
  const endpoint = signalingServer(server)
  const room = await request<{ roomId: string; token: string; code: string }>(
    endpoint,
    '/rooms',
    'POST'
  )
  try {
    await mutate((state) => {
      const map = state.maps.find((item) => item.id === mapId)
      if (!map || map.share) throw new Error('맵 상태가 바뀌었어요. 다시 확인해주세요.')
      map.share = {
        roomId: room.roomId,
        token: room.token,
        code: room.code,
        server: endpoint,
        role: 'host',
        remoteMapId: null,
        sourceRevision: -1,
        lastSync: null
      }
    })
  } catch (error) {
    await request(endpoint, '/rooms/' + room.roomId, 'DELETE', room.token).catch(() => {})
    throw error
  }
}
export async function joinShare(code: string, server: string): Promise<void> {
  if (!('RTCPeerConnection' in window))
    throw new Error('이 환경은 기기 간 직접 연결을 지원하지 않아요.')
  const endpoint = signalingServer(server)
  const room = await request<{ roomId: string; token: string }>(
    endpoint,
    '/join',
    'POST',
    undefined,
    { code, name: getState().name }
  )
  try {
    await mutate((state) => {
      if (state.maps.length >= 30) throw new Error('맵은 최대 30개까지 보관할 수 있어요.')
      const map = newMap('연결을 기다리는 맵')
      map.share = {
        roomId: room.roomId,
        token: room.token,
        code: '',
        server: endpoint,
        role: 'guest',
        remoteMapId: null,
        sourceRevision: -1,
        lastSync: null
      }
      state.maps.push(map)
      state.selectedMapId = map.id
    })
  } catch (error) {
    await request(endpoint, '/rooms/' + room.roomId, 'DELETE', room.token).catch(() => {})
    throw error
  }
}
export async function disconnectShare(mapId: string): Promise<void> {
  await mutate((state) => {
    const map = state.maps.find((item) => item.id === mapId)
    if (!map?.share) return
    state.revocations.push({
      roomId: map.share.roomId,
      server: map.share.server,
      token: map.share.token
    })
    disconnectMap(map)
  })
  await flushRevocations()
}
let flushing = false
export async function flushRevocations(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    for (const item of getState().revocations) {
      try {
        await request(item.server, '/rooms/' + item.roomId, 'DELETE', item.token)
        await mutate((state) => {
          state.revocations = state.revocations.filter((value) => value.roomId !== item.roomId)
        })
      } catch(error) {
        if(error instanceof SignalError && ['ROOM_NOT_FOUND','ROOM_CLOSED'].includes(error.code)) {
          await mutate(state=>{state.revocations=state.revocations.filter(value=>value.roomId!==item.roomId)})
        }
        /* 네트워크 실패가 로컬 연결 해제를 되돌리지 않는다. */
      }
    }
  } finally {
    flushing = false
  }
}

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', changed)
      resolve()
    }
    const changed = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
    const timer = setTimeout(done, 5000)
    pc.addEventListener('icegatheringstatechange', changed)
  })
}
export class DeviceShare {
  private stopped = false
  private abort = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private unsubscribe: (() => void) | undefined
  private cursor = 0
  private instance = ''
  private lastOffer = 0
  private lastSent = -1
  private negotiationId = ''
  private ice: RTCIceServer[] = []
  private outgoing: Outgoing | null = null
  private incoming: Incoming | null = null
  private queue = Promise.resolve()
  private sending = false
  private bytesSent = 0
  private control: { size: number; received: number; parts: ArrayBuffer[] } | null = null
  private mapId: string
  private link: ShareLink
  private status: (value: ShareStatus) => void
  constructor(mapId: string, link: ShareLink, status: (value: ShareStatus) => void) {
    this.mapId = mapId
    this.link = link
    this.status = status
  }
  private active() {
    return (
      !this.stopped &&
      getState().maps.some((map) => map.id === this.mapId && map.share?.roomId === this.link.roomId)
    )
  }
  private report(stage: ShareStatus['stage'], message: string, extra: Partial<ShareStatus> = {}) {
    if (this.active()) this.status({ stage, message, ...extra })
  }
  private fail(error: unknown) {
    if (!this.active()) return
    this.report('error', error instanceof Error ? error.message : '연결을 확인해주세요.')
    this.closePeer()
  }
  start(): void {
    this.unsubscribe = subscribe(() => {
      if (this.link.role === 'host') void this.push().catch((error) => this.fail(error))
    })
    void this.poll()
  }
  stop(): void {
    this.stopped = true
    this.abort.abort()
    clearTimeout(this.timer)
    this.unsubscribe?.()
    this.closePeer()
  }
  private closePeer() {
    this.channel?.close()
    this.pc?.close()
    this.channel = null
    this.pc = null
    this.incoming = null
    this.outgoing = null
    this.control = null
    this.sending = false
    this.lastSent = -1
  }
  async approve(): Promise<void> {
    await request(
      this.link.server,
      '/rooms/' + this.link.roomId + '/approve',
      'POST',
      this.link.token,
      undefined,
      this.abort.signal
    )
    this.report('connecting', '직접 연결을 준비하고 있어요.')
  }
  retry(): void {
    this.lastOffer = 0
    this.closePeer()
  }
  private async signal(kind: string, description?: RTCSessionDescriptionInit) {
    await request(
      this.link.server,
      '/rooms/' + this.link.roomId + '/signal',
      'POST',
      this.link.token,
      { kind, description, sessionId: this.negotiationId },
      this.abort.signal
    )
  }
  private async poll(): Promise<void> {
    if (!this.active()) return
    try {
      const data = await request<PollResult>(
        this.link.server,
        '/rooms/' + this.link.roomId + '/events?after=' + this.cursor,
        'GET',
        this.link.token,
        undefined,
        this.abort.signal
      )
      if (!this.active()) return
      if (this.instance && this.instance !== data.instance) {
        this.cursor = 0
        this.closePeer()
      }
      this.instance = data.instance
      if (data.status === 'waiting')
        this.report('waiting', '공유 코드를 상대에게 전달해주세요. 코드는 10분 동안 유효해요.')
      if (data.status === 'pending')
        this.report(
          this.link.role === 'host' ? 'approval' : 'waiting',
          this.link.role === 'host'
            ? '상대 화면의 확인 문자가 같은지 확인하고 연결을 허용해주세요.'
            : '원본 기기의 연결 승인을 기다리고 있어요.',
          { phrase: data.phrase, guestName: data.guestName }
        )
      for (const event of data.events) {
        if (!this.active()) return
        this.cursor = Math.max(this.cursor, event.sequence)
        if (event.kind === 'request' && this.link.role === 'host') {
          this.lastOffer = 0
          this.closePeer()
        }
        if (
          event.kind === 'offer' &&
          this.link.role === 'guest' &&
          event.description &&
          event.sessionId
        )
          await this.answer(event.description, event.sessionId)
        if (
          event.kind === 'answer' &&
          this.link.role === 'host' &&
          event.description &&
          event.sessionId === this.negotiationId &&
          this.pc?.signalingState === 'have-local-offer'
        )
          await this.pc.setRemoteDescription(event.description)
      }
      if (
        data.status === 'paired' &&
        this.channel?.readyState !== 'open' &&
        Date.now() - this.lastOffer > 20000
      ) {
        this.lastOffer = Date.now()
        if (this.link.role === 'host') await this.offer()
        else await this.signal('request')
      }
    } catch (error) {
      if (!this.active()) return
      if (error instanceof SignalError && ['ROOM_CLOSED', 'CODE_EXPIRED'].includes(error.code)) {
        await mutate((state) => {
          const map = state.maps.find((map) => map.id === this.mapId)
          if (map?.share?.roomId === this.link.roomId) disconnectMap(map)
        })
        return
      }
      if (this.channel?.readyState !== 'open')
        this.report(
          'offline',
          error instanceof Error
            ? error.message
            : '상대 기기와 다시 연결할 때까지 받은 기록을 볼 수 있어요.'
        )
    } finally {
      if (this.active()) this.timer = setTimeout(() => void this.poll(), 1500)
    }
  }
  private peer(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.ice })
    this.pc = pc
    pc.onconnectionstatechange = () => {
      if (!this.active() || this.pc !== pc) return
      if (['failed', 'disconnected'].includes(pc.connectionState))
        this.report('offline', '상대 기기 연결이 끊겼어요. 받은 기록은 그대로 볼 수 있어요.')
    }
    return pc
  }
  private bind(channel: RTCDataChannel): void {
    this.channel = channel
    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = 65536
    channel.onopen = () => {
      this.report('connected', '기기가 연결됐어요.')
      if (this.link.role === 'host') void this.push().catch((error) => this.fail(error))
    }
    channel.onmessage = (event) => {
      this.queue = this.queue
        .then(async () => {
          if (this.active() && this.channel === channel) await this.receive(event.data)
        })
        .catch((error) => {
          if (this.channel === channel) this.fail(error)
        })
    }
    channel.onclose = () => {
      if (this.active() && this.channel === channel)
        this.report('offline', '상대 기기와 연결될 때 최신 기록을 가져올 수 있어요.')
    }
  }
  private async offer(): Promise<void> {
    this.closePeer()
    this.negotiationId = crypto.randomUUID()
    this.ice = (
      await request<{ iceServers: RTCIceServer[] }>(
        this.link.server,
        '/rooms/' + this.link.roomId + '/ice',
        'GET',
        this.link.token,
        undefined,
        this.abort.signal
      )
    ).iceServers
    this.report('connecting', '원본 기기와 직접 연결하고 있어요. 두 앱을 열어두세요.')
    const pc = this.peer()
    this.bind(pc.createDataChannel('records', { ordered: true }))
    await pc.setLocalDescription(await pc.createOffer())
    await waitForIce(pc)
    if (this.active() && this.pc === pc) await this.signal('offer', pc.localDescription!.toJSON())
  }
  private async answer(description: RTCSessionDescriptionInit, sessionId: string): Promise<void> {
    this.closePeer()
    this.lastOffer = Date.now()
    this.negotiationId = sessionId
    this.ice = (
      await request<{ iceServers: RTCIceServer[] }>(
        this.link.server,
        '/rooms/' + this.link.roomId + '/ice',
        'GET',
        this.link.token,
        undefined,
        this.abort.signal
      )
    ).iceServers
    const pc = this.peer()
    pc.ondatachannel = (event) => {
      if (this.active() && this.pc === pc) this.bind(event.channel)
    }
    this.report('connecting', '원본 기기와 직접 연결하고 있어요.')
    await pc.setRemoteDescription(description)
    await pc.setLocalDescription(await pc.createAnswer())
    await waitForIce(pc)
    if (this.active() && this.pc === pc) await this.signal('answer', pc.localDescription!.toJSON())
  }
  private async ready(channel: RTCDataChannel): Promise<void> {
    const started = Date.now()
    while (channel.bufferedAmount > 262144) {
      if (
        !this.active() ||
        this.channel !== channel ||
        channel.readyState !== 'open' ||
        Date.now() - started > 15000
      )
        throw new Error('전송이 중단됐어요. 두 기기의 연결을 확인해주세요.')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (!this.active() || this.channel !== channel || channel.readyState !== 'open')
      throw new Error('전송 중 연결이 끊겼어요.')
  }
  private async send(value: unknown): Promise<void> {
    if (!this.active() || this.channel?.readyState !== 'open')
      throw new Error('전송 중 연결이 끊겼어요. 기존 기록은 그대로 있어요.')
    const channel = this.channel,
      bytes = new TextEncoder().encode(JSON.stringify(value))
    if (bytes.length > 12 * 1024 * 1024) throw new Error('한 번에 전송할 기록 정보가 너무 커요.')
    channel.send(JSON.stringify({ kind: 'control-start', size: bytes.length }))
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      await this.ready(channel)
      channel.send(bytes.slice(offset, offset + 16384))
    }
    channel.send(JSON.stringify({ kind: 'control-end' }))
  }
  private async push(): Promise<void> {
    if (!this.active() || this.sending || this.channel?.readyState !== 'open') return
    const map = getState().maps.find((map) => map.id === this.mapId)!
    if (map.revision === this.lastSent) return
    const snapshot = validateSnapshot({
      schema: 1,
      mapId: map.id,
      title: map.title,
      revision: map.revision,
      records: map.records
    })
    const outgoing = {
      id: crypto.randomUUID(),
      snapshot,
      photos: new Map(
        snapshot.records.flatMap((record) =>
          record.photos.map((photo) => [photo.id, photo] as const)
        )
      )
    }
    this.outgoing = outgoing
    this.sending = true
    this.bytesSent = 0
    await this.send({ kind: 'manifest', id: outgoing.id, snapshot })
  }
  private async receive(data: string | ArrayBuffer): Promise<void> {
    if (data instanceof ArrayBuffer) {
      if (this.control) {
        if (data.byteLength > 16384 || this.control.received + data.byteLength > this.control.size)
          throw new Error('기록 정보 전송 크기가 올바르지 않아요.')
        this.control.parts.push(data)
        this.control.received += data.byteLength
        return
      }
      const file = this.incoming?.file
      if (!file || data.byteLength > 16384 || file.received + data.byteLength > file.size)
        throw new Error('사진 전송 크기가 올바르지 않아요.')
      file.parts.push(data)
      file.received += data.byteLength
      return
    }
    if (typeof data !== 'string' || data.length > 12 * 1024 * 1024)
      throw new Error('지원하지 않는 전송 데이터예요.')
    const message = JSON.parse(data) as Record<string, unknown>
    if (message.kind === 'control-start') {
      if (
        this.control ||
        !Number.isSafeInteger(message.size) ||
        (message.size as number) <= 0 ||
        (message.size as number) > 12 * 1024 * 1024
      )
        throw new Error('기록 정보 크기가 올바르지 않아요.')
      this.control = { size: message.size as number, received: 0, parts: [] }
      return
    }
    if (message.kind === 'control-end') {
      const control = this.control
      if (!control || control.received !== control.size)
        throw new Error('기록 정보를 끝까지 받지 못했어요.')
      this.control = null
      const content = new TextDecoder('utf-8', { fatal: true }).decode(
        await new Blob(control.parts).arrayBuffer()
      )
      await this.receive(content)
      return
    }
    if (message.kind === 'manifest' && this.link.role === 'guest') {
      const snapshot = validateSnapshot(message.snapshot),
        id = safeId(message.id)
      const map = getState().maps.find((map) => map.id === this.mapId)
      if (!map?.share) return
      if (map.share.remoteMapId && map.share.remoteMapId !== snapshot.mapId)
        throw new Error('공유 원본 맵이 바뀌었어요.')
      const idMap = new Map<string, string>(),
        needed = new Set<string>()
      const metadata = new Map(
        snapshot.records.flatMap((record) =>
          record.photos.map((photo) => [photo.id, photo] as const)
        )
      )
      for (const photo of metadata.values()) {
        const localId = await digest(new Blob([this.mapId + '|' + photo.id]))
        idMap.set(photo.id, localId)
        const existing = await getPhoto(localId)
        if (!existing || existing.size !== photo.bytes || (await digest(existing)) !== photo.hash)
          needed.add(photo.id)
      }
      this.incoming = { id, snapshot, idMap, needed, photos: [], file: null }
      this.report(
        'syncing',
        `기록 ${snapshot.records.length}개와 필요한 사진 ${needed.size}장을 가져오고 있어요.`
      )
      await this.send({ kind: 'need', id, photos: [...needed] })
      return
    }
    if (message.kind === 'need' && this.link.role === 'host') {
      const outgoing = this.outgoing
      if (
        !outgoing ||
        message.id !== outgoing.id ||
        !Array.isArray(message.photos) ||
        message.photos.length > outgoing.photos.size ||
        new Set(message.photos).size !== message.photos.length
      )
        throw new Error('사진 요청이 올바르지 않아요.')
      for (const id of message.photos) {
        if (typeof id !== 'string' || !outgoing.photos.has(id))
          throw new Error('허용되지 않은 사진 요청이에요.')
        const photo = outgoing.photos.get(id)!,
          blob = await getPhoto(id)
        if (!blob || blob.size !== photo.bytes || (await digest(blob)) !== photo.hash)
          throw new Error('원본 사진을 찾지 못했어요. 백업을 확인해주세요.')
        await this.send({ kind: 'file', id: outgoing.id, photoId: id })
        for (let offset = 0; offset < blob.size; offset += 16384) {
          const channel = this.channel
          if (!this.active() || !channel || channel.readyState !== 'open')
            throw new Error('사진 전송이 중단됐어요.')
          await this.ready(channel)
          channel.send(await blob.slice(offset, offset + 16384).arrayBuffer())
          this.bytesSent += Math.min(16384, blob.size - offset)
        }
        await this.send({ kind: 'file-end', id: outgoing.id })
      }
      await this.send({ kind: 'complete', id: outgoing.id })
      return
    }
    if (message.kind === 'file' && this.link.role === 'guest') {
      const incoming = this.incoming
      if (
        !incoming ||
        message.id !== incoming.id ||
        incoming.file ||
        typeof message.photoId !== 'string' ||
        !incoming.needed.has(message.photoId)
      )
        throw new Error('사진 순서가 올바르지 않아요.')
      const photo = incoming.snapshot.records
        .flatMap((record) => record.photos)
        .find((photo) => photo.id === message.photoId)!
      incoming.file = { id: photo.id, size: photo.bytes, parts: [], received: 0 }
      return
    }
    if (message.kind === 'file-end' && this.link.role === 'guest') {
      const incoming = this.incoming,
        file = incoming?.file
      if (!incoming || message.id !== incoming.id || !file || file.received !== file.size)
        throw new Error('사진을 끝까지 받지 못했어요.')
      const metadata = incoming.snapshot.records
        .flatMap((record) => record.photos)
        .find((photo) => photo.id === file.id)!
      const blob = new Blob(file.parts, { type: 'image/jpeg' })
      if ((await digest(blob)) !== metadata.hash) throw new Error('사진 검증에 실패했어요.')
      incoming.photos.push({
        id: incoming.idMap.get(file.id)!,
        blob,
        thumbnail: await prepareThumbnail(blob)
      })
      incoming.needed.delete(file.id)
      incoming.file = null
      return
    }
    if (message.kind === 'complete' && this.link.role === 'guest') {
      const incoming = this.incoming
      if (!incoming || incoming.id !== message.id || incoming.file || incoming.needed.size)
        throw new Error('일부 사진을 아직 받지 못했어요.')
      const { snapshot } = incoming
      const records = await Promise.all(
        snapshot.records.map(async (record) => ({
          ...record,
          id: await digest(new Blob([this.mapId + '|' + record.id])),
          originId: record.originId ?? record.id,
          photos: record.photos.map((photo) => ({ ...photo, id: incoming.idMap.get(photo.id)! }))
        }))
      )
      await mutate((state) => {
        const map = state.maps.find((map) => map.id === this.mapId)
        if (!map?.share || map.share.roomId !== this.link.roomId || map.share.role !== 'guest')
          throw new Error('공유 연결이 이미 해제됐어요.')
        if (map.share.remoteMapId && map.share.remoteMapId !== snapshot.mapId)
          throw new Error('공유 원본이 일치하지 않아요.')
        if (snapshot.revision < map.share.sourceRevision) return
        map.title = snapshot.title
        map.records = records
        map.revision++
        map.share.remoteMapId = snapshot.mapId
        map.share.sourceRevision = snapshot.revision
        map.share.lastSync = new Date().toISOString()
      }, incoming.photos)
      this.incoming = null
      await this.send({ kind: 'ack', id: message.id })
      this.report('connected', '최신 기록과 사진을 기기에 저장했어요.')
      return
    }
    const outgoing = this.outgoing
    if (
      message.kind === 'ack' &&
      this.link.role === 'host' &&
      outgoing &&
      message.id === outgoing.id
    ) {
      this.lastSent = outgoing.snapshot.revision
      this.sending = false
      this.outgoing = null
      this.report(
        'connected',
        `상대 기기에 기록과 사진을 전달했어요.${this.bytesSent ? ' (' + Math.ceil(this.bytesSent / 1024) + 'KB)' : ''}`
      )
      await mutate((state) => {
        const map = state.maps.find((map) => map.id === this.mapId)
        if (map?.share?.roomId === this.link.roomId) map.share.lastSync = new Date().toISOString()
      })
      await this.push()
      return
    }
    throw new Error('지원하지 않는 공유 메시지예요.')
  }
}
