import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createShareHandler } from '../../scripts/sharing/broker.mjs'

async function withServer(options, action) {
  const handler = createShareHandler(options),
    server = createServer((req, res) => void handler(req, res))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port + '/api/device-share'
  async function call(path, method = 'GET', token, body, origin) {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(origin ? { Origin: origin } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    return await action(call)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
async function pair(call) {
  const host = (await call('/rooms', 'POST')).body
  const guest = (await call('/join', 'POST', undefined, { code: host.code, name: '테스트 기기' }))
    .body
  await call('/rooms/' + host.roomId + '/approve', 'POST', host.token)
  return { host, guest, path: '/rooms/' + host.roomId }
}
test('코드는 한 상대만 요청 가능하고 승인 전에는 전송할 수 없음', async () =>
  withServer({}, async (call) => {
    const host = (await call('/rooms', 'POST')).body
    assert.match(host.code, /^[A-F0-9]{12}$/)
    assert.equal((await call('/rooms/' + host.roomId + '/events')).status, 403)
    assert.equal((await call('/join', 'POST', undefined, { code: 'AAAAAAAAAAAA' })).status, 404)
    const guest = (await call('/join', 'POST', undefined, { code: host.code })).body
    assert.equal((await call('/join', 'POST', undefined, { code: host.code })).status, 404)
    assert.equal(
      (await call('/rooms/' + host.roomId + '/approve', 'POST', guest.token)).status,
      400
    )
    assert.equal((await call('/rooms/' + host.roomId + '/ice', 'GET', guest.token)).status, 400)
    assert.equal(
      (await call('/rooms/' + host.roomId + '/signal', 'POST', guest.token, { kind: 'request' }))
        .status,
      400
    )
  }))
test('서로 다른 연결의 토큰으로 읽거나 닫을 수 없음', async () =>
  withServer({}, async (call) => {
    const first = await pair(call),
      second = await pair(call)
    assert.equal((await call(first.path + '/events', 'GET', second.host.token)).status, 403)
    assert.equal((await call(first.path, 'DELETE', second.guest.token)).status, 403)
    assert.equal((await call(first.path + '/events', 'GET', first.guest.token)).status, 200)
  }))
test('승인된 양쪽 역할에 맞는 SDP만 전달하고 사진 업로드 API는 없음', async () =>
  withServer({}, async (call) => {
    const { host, guest, path } = await pair(call),
      sessionId = randomUUID()
    assert.equal(
      (await call(path + '/signal', 'POST', host.token, { kind: 'file', data: 'private-photo' }))
        .status,
      400
    )
    assert.equal(
      (
        await call(path + '/signal', 'POST', guest.token, {
          kind: 'offer',
          description: { type: 'offer', sdp: 'v=0' }
        })
      ).status,
      400
    )
    assert.equal(
      (
        await call(path + '/signal', 'POST', host.token, {
          kind: 'offer',
          sessionId,
          description: { type: 'offer', sdp: 'v=0\r\n' }
        })
      ).status,
      200
    )
    const messages = (await call(path + '/events', 'GET', guest.token)).body.events
    assert(messages.some((message) => message.kind === 'offer' && message.sessionId === sessionId))
    assert(!JSON.stringify(messages).includes(host.token))
  }))
test('기기 연결 해제는 양쪽에 인증된 종료 상태로 전달', async () =>
  withServer({}, async (call) => {
    const { host, guest, path } = await pair(call)
    assert.equal((await call(path, 'DELETE', guest.token)).status, 200)
    assert.equal((await call(path + '/events', 'GET', host.token)).body.error, 'ROOM_CLOSED')
    assert.equal((await call(path + '/events', 'GET', guest.token)).status, 410)
    assert.equal((await call(path, 'DELETE', guest.token)).status, 200)
  }))
test('허용하지 않은 웹 Origin의 연결 생성·요청 차단', async () =>
  withServer({}, async (call) => {
    assert.equal(
      (await call('/rooms', 'POST', undefined, {}, 'https://attacker.invalid')).status,
      403
    )
  }))
test('TURN 자격 증명은 승인된 연결에 단기 발급하고 비밀을 반환하지 않음', async () =>
  withServer(
    { turnSecret: 'test-turn-secret', turnUrls: ['turns:relay.example.invalid:5349'] },
    async (call) => {
      const { guest, path } = await pair(call),
        response = await call(path + '/ice', 'GET', guest.token)
      const turn = response.body.iceServers[1]
      assert(Number(turn.username.split(':')[0]) > Date.now() / 1000)
      assert.equal(
        turn.credential,
        createHmac('sha1', 'test-turn-secret').update(turn.username).digest('base64')
      )
      assert(!JSON.stringify(response.body).includes('test-turn-secret'))
    }
  ))
test('연결 메타데이터는 재시작 후 유지하며 토큰 원문·SDP를 파일에 저장하지 않음', async () => {
  await mkdir('tmp', { recursive: true })
  const directory = await mkdtemp(resolve('tmp/broker-test-')),
    statePath = resolve(directory, 'state.json')
  let created
  try {
    await withServer({ statePath }, async (call) => {
      created = await pair(call)
      await call(created.path + '/signal', 'POST', created.host.token, {
        kind: 'offer',
        sessionId: randomUUID(),
        description: { type: 'offer', sdp: 'v=0\r\na=private-network-details' }
      })
      const saved = await readFile(statePath, 'utf8')
      assert(!saved.includes(created.host.token))
      assert(!saved.includes(created.guest.token))
      assert(!saved.includes(created.host.code))
      assert(!saved.includes('private-network-details'))
    })
    await withServer({ statePath }, async (call) => {
      assert.equal(
        (await call(created.path + '/events', 'GET', created.guest.token)).body.status,
        'paired'
      )
    })
  } finally {
    await unlink(statePath).catch(() => {})
  }
})
test('만료된 코드는 재참여와 대기를 종료하며 다른 연결을 열지 않음', async () => {
  await mkdir('tmp', { recursive: true })
  const directory = await mkdtemp(resolve('tmp/broker-test-')),
    statePath = resolve(directory, 'expired.json')
  const id = randomUUID(),
    token = 'expired-token',
    code = 'ABCDEF123456',
    hash = (value) => createHash('sha256').update(value).digest('hex')
  await writeFile(
    statePath,
    JSON.stringify([
      {
        id,
        hostHash: hash(token),
        guestHash: null,
        codeHash: hash(code),
        status: 'waiting',
        expiresAt: Date.now() - 1000,
        updatedAt: Date.now(),
        sequence: 0
      }
    ])
  )
  try {
    await withServer({ statePath }, async (call) => {
      assert.equal((await call('/join', 'POST', undefined, { code })).status, 404)
      assert.equal(
        (await call('/rooms/' + id + '/events', 'GET', token)).body.error,
        'CODE_EXPIRED'
      )
    })
  } finally {
    await unlink(statePath).catch(() => {})
  }
})
