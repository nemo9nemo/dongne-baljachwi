import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {{id:string,hostHash:string,guestHash:string|null,codeHash:string,expiresAt:number,status:'waiting'|'pending'|'paired'|'closed',updatedAt:number,sequence:number,guestName?:string,phrase?:string}} Room */
/** @typedef {{sequence:number,kind:string,sessionId?:string,description?:{type:string,sdp:string}}} Signal */
/** @param {string} value */
const hash = (value) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
/** @param {Room} room */
const publicRoom = (room) => ({
  status: room.status,
  guestName: room.guestName ?? '',
  phrase: room.phrase ?? '',
  expiresAt: room.expiresAt
})
/** @param {string|undefined} value @param {string|null|undefined} expected */
function matches(value, expected) {
  if(!expected) return false
  const actual = hash(value ?? '')
  return (
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  )
}

/**
 * 연결 정보만 중계한다. 기록/사진을 받는 API는 없으며 SDP는 메모리에만 보관한다.
 * @param {{statePath?:string,allowedOrigins?:string[],turnSecret?:string,turnUrls?:string[]}} [options]
 */
export function createShareHandler({
  statePath,
  allowedOrigins = [],
  turnSecret = '',
  turnUrls = []
} = {}) {
  const rooms = new Map(/** @type {[string,Room][]} */ ([]))
  const queues = new Map(/** @type {[string,Signal[]][]} */ ([]))
  const attempts = new Map(/** @type {[string,{count:number,until:number}][]} */ ([]))
  const instance = randomUUID()
  if (statePath) {
    try {
      const saved = /** @type {Room[]} */ (JSON.parse(readFileSync(statePath, 'utf8')))
      if (!Array.isArray(saved)) throw new Error('잘못된 공유 상태 파일')
      for (const room of saved)
        if (typeof room.id === 'string' && (room.status==='paired' || room.updatedAt > Date.now() - 30 * 86400000))
          rooms.set(room.id, room)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw error
    }
  }
  function persist() {
    if (!statePath) return
    mkdirSync(dirname(statePath), { recursive: true })
    const pending = statePath + '.pending'
    writeFileSync(pending, JSON.stringify([...rooms.values()]), { mode: 0o600 })
    renameSync(pending, statePath)
  }
  /** @param {Response} res @param {number} status @param {unknown} body */
  function send(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    res.end(JSON.stringify(body))
  }
  /** @param {string} key @param {number} limit */
  function limited(key, limit) {
    const now = Date.now(),
      item = attempts.get(key)
    if (!item || now > item.until) {
      attempts.set(key, { count: 1, until: now + 60000 })
      return false
    }
    return ++item.count > limit
  }
  /** @param {Room} room @param {string} side @param {Omit<Signal,'sequence'>} event */
  function enqueue(room, side, event) {
    room.sequence = (room.sequence ?? 0) + 1
    const key = room.id + side,
      list = queues.get(key) ?? []
    list.push({ sequence: room.sequence, ...event })
    queues.set(key, list.slice(-24))
    room.updatedAt = Date.now()
    persist()
  }
  /** @param {Request} req @returns {Promise<Record<string,unknown>>} */
  async function body(req) {
    const chunks = /** @type {Buffer[]} */ ([])
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 32768) throw new Error('BODY_TOO_LARGE')
      chunks.push(chunk)
    }
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('INVALID_REQUEST')
    return value
  }
  function prune() {
    const now = Date.now()
    for (const [key, item] of attempts) if (now > item.until) attempts.delete(key)
    for (const [id, room] of rooms) {
      if (
        (room.status === 'closed' && now-room.updatedAt > 30 * 86400000) ||
        ((room.status === 'waiting' || room.status==='pending') && now > room.expiresAt + 86400000)
      ) {
        rooms.delete(id)
        queues.delete(id + 'host')
        queues.delete(id + 'guest')
      }
    }
  }
  /** @param {Request} req @param {Response} res @param {()=>void} [next] */
  return async function shareHandler(
    req,
    res,
    next = () => send(res, 404, { error: 'NOT_FOUND' })
  ) {
    const url = new URL(req.url || '/', 'http://signal.local')
    if (!url.pathname.startsWith('/api/device-share')) return next()
    try {
      // 브라우저의 다른 사이트가 코드 생성/참여를 대신하지 못하도록 Origin을 검증한다.
      const origin = req.headers.origin
      const sameHost = origin && new URL(origin).host === req.headers.host
      if (origin && !sameHost && !allowedOrigins.includes(origin))
        return send(res, 403, { error: 'ORIGIN_NOT_ALLOWED' })
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        res.writeHead(204)
        res.end()
        return
      }
      prune()
      const path = url.pathname.slice('/api/device-share'.length)
      const ip = req.socket.remoteAddress ?? 'unknown'
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, instance })
      if (req.method === 'POST' && path === '/rooms') {
        if (limited(ip + 'create', 20) || rooms.size >= 2000)
          return send(res, 429, { error: 'TRY_LATER' })
        const id = randomUUID(),
          hostToken = token(),
          code = randomBytes(6).toString('hex').toUpperCase()
        const room = /** @type {Room} */ ({
          id,
          hostHash: hash(hostToken),
          guestHash: null,
          codeHash: hash(code),
          expiresAt: Date.now() + 10 * 60000,
          status: 'waiting',
          updatedAt: Date.now(),
          sequence: 0
        })
        rooms.set(id, room)
        persist()
        return send(res, 201, { roomId: id, token: hostToken, code, expiresAt: room.expiresAt })
      }
      if (req.method === 'POST' && path === '/join') {
        if (limited(ip + 'join', 30)) return send(res, 429, { error: 'TRY_LATER' })
        const input = await body(req)
        const code =
          typeof input.code === 'string' ? input.code.replace(/[-\s]/g, '').toUpperCase() : ''
        if (!/^[A-F0-9]{12}$/.test(code)) return send(res, 404, { error: 'INVALID_CODE' })
        const room = [...rooms.values()].find(
          (item) =>
            item.status === 'waiting' && item.expiresAt > Date.now() && matches(code, item.codeHash)
        )
        if (!room) return send(res, 404, { error: 'INVALID_CODE' })
        const guestToken = token()
        room.guestHash = hash(guestToken)
        room.status = 'pending'
        room.guestName = typeof input.name === 'string' ? input.name.slice(0, 40) : '상대 기기'
        room.phrase = randomBytes(3).toString('hex').toUpperCase()
        enqueue(room, 'host', { kind: 'join' })
        return send(res, 200, { roomId: room.id, token: guestToken, phrase: room.phrase })
      }
      const match = /^\/rooms\/([a-f0-9-]{36})(?:\/(events|approve|signal|ice))?$/.exec(path)
      if (!match) return next()
      const room = rooms.get(match[1])
      if (!room) return send(res, 404, { error: 'ROOM_NOT_FOUND' })
      const authorization = req.headers.authorization ?? ''
      const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
      const side = matches(provided, room.hostHash)
        ? 'host'
        : matches(provided, room.guestHash)
          ? 'guest'
          : null
      if (!side) return send(res, 403, { error: 'UNAUTHORIZED' })
      const remote = side === 'host' ? 'guest' : 'host'
      if (req.method === 'GET' && match[2] === 'ice' && room.status === 'paired') {
        const iceServers = /** @type {{urls:string|string[],username?:string,credential?:string}[]} */ ([{ urls: 'stun:stun.l.google.com:19302' }])
        if (turnSecret && turnUrls.length) {
          const username = Math.floor(Date.now() / 1000 + 3600) + ':' + room.id + ':' + side
          iceServers.push({
            urls: turnUrls,
            username,
            credential: createHmac('sha1', turnSecret).update(username).digest('base64')
          })
        }
        return send(res, 200, { iceServers })
      }
      if (req.method === 'GET' && match[2] === 'events') {
        if (room.status === 'closed') return send(res, 410, { error: 'ROOM_CLOSED' })
        if (room.status !== 'paired' && Date.now() > room.expiresAt)
          return send(res, 410, { error: 'CODE_EXPIRED' })
        if (limited(room.id + side + 'poll', 100)) return send(res, 429, { error: 'TRY_LATER' })
        const after = Number(url.searchParams.get('after') ?? '0')
        if (Date.now() - room.updatedAt > 60000) {
          room.updatedAt = Date.now()
          persist()
        }
        return send(res, 200, {
          instance,
          ...publicRoom(room),
          events: (queues.get(room.id + side) ?? []).filter((event) => event.sequence > after)
        })
      }
      if (req.method === 'DELETE' && !match[2]) {
        room.status = 'closed'
        room.updatedAt = Date.now()
        queues.delete(room.id + 'host')
        queues.delete(room.id + 'guest')
        persist()
        return send(res, 200, { ok: true })
      }
      if (room.status === 'closed') return send(res, 410, { error: 'ROOM_CLOSED' })
      if (req.method === 'POST' && match[2] === 'approve' && side === 'host') {
        if (room.status !== 'pending' || Date.now() > room.expiresAt)
          return send(res, 409, { error: 'NO_PENDING_REQUEST' })
        room.status = 'paired'
        enqueue(room, 'guest', { kind: 'approved' })
        return send(res, 200, { ok: true })
      }
      if (req.method === 'POST' && match[2] === 'signal' && room.status === 'paired') {
        if (limited(room.id + side + 'signal', 30)) return send(res, 429, { error: 'TRY_LATER' })
        const input = await body(req)
        if (input.kind === 'request' && side === 'guest') {
          enqueue(room, 'host', { kind: 'request' })
          return send(res, 200, { ok: true })
        }
        const type = side === 'host' ? 'offer' : 'answer'
        const description=typeof input.description==='object' && input.description!==null ? /** @type {Record<string,unknown>} */(input.description):null
        if (
          input.kind !== type ||
          typeof input.sessionId !== 'string' ||
          !/^[a-f0-9-]{36}$/.test(input.sessionId) ||
          !description ||
          description.type !== type ||
          typeof description.sdp !== 'string' ||
          description.sdp.length > 26000 ||
          !description.sdp.startsWith('v=0')
        )
          return send(res, 400, { error: 'INVALID_SIGNAL' })
        enqueue(room, remote, {
          kind: type,
          sessionId: input.sessionId,
          description: { type, sdp: description.sdp }
        })
        return send(res, 200, { ok: true })
      }
      return send(res, 400, { error: 'INVALID_REQUEST' })
    } catch (error) {
      if (!res.headersSent)
        send(res, error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'INVALID_REQUEST' })
    }
  }
}
