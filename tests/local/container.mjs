import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const suffix = `${process.pid}-${Date.now()}`
const container = `baljachwi-share-test-${suffix}`
const volume = `${container}-data`
const image = 'baljachwi-sharing:test'
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true }).trim()
let started = false, createdVolume = false
try {
  execFileSync('docker', ['build', '-f', 'deploy/sharing/Dockerfile', '-t', image, '.'], { stdio: 'inherit', windowsHide: true })
  docker(['volume', 'create', volume]); createdVolume = true
  docker(['run', '-d', '--name', container, '--read-only', '--tmpfs', '/tmp',
    '--mount', `type=volume,src=${volume},dst=/data`, '-p', '127.0.0.1::8787',
    '-e', 'PORT=8787', '-e', 'SHARE_ALLOWED_ORIGINS=https://localhost', image]); started = true
  let base
  async function healthy() {
    // 임의로 할당한 호스트 포트는 Docker 재시작 뒤 달라질 수 있다.
    const port = docker(['port', container, '8787/tcp']).split(':').pop()
    base = `http://127.0.0.1:${port}/api/device-share`
    for (let n = 0; n < 100; n++) {
      try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1500) })).ok) return } catch {}
      await setTimeout(100)
    }
    throw new Error('Sharing container did not become healthy')
  }
  async function request(path, method = 'GET', token, body, origin = 'https://localhost') {
    const response = await fetch(base + path, { method, headers: {
      Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: await response.json() }
  }
  await healthy()
  assert.match(docker(['exec', container, 'cat', '/proc/1/status']), /^Uid:\s+1000\s+1000/m)
  assert.equal((await request('/rooms', 'POST', undefined, undefined, 'https://untrusted.invalid')).status, 403)
  const host = await request('/rooms', 'POST')
  assert.equal(host.status, 201)
  const guest = await request('/join', 'POST', undefined, { code: host.data.code, name: 'Container fixture' })
  assert.equal(guest.status, 200)
  assert.equal((await request(`/rooms/${host.data.roomId}/approve`, 'POST', host.data.token)).status, 200)
  console.log('PASS: non-root container, Origin restriction and pairing')
  docker(['restart', container]); await healthy()
  const restored = await request(`/rooms/${host.data.roomId}/events`, 'GET', guest.data.token)
  assert.equal(restored.status, 200)
  assert.equal(restored.data.status, 'paired')
  console.log('PASS: approved connection survives container restart')
  assert.equal((await request(`/rooms/${host.data.roomId}`, 'DELETE', host.data.token)).status, 200)
  docker(['restart', container]); await healthy()
  assert.equal((await request(`/rooms/${host.data.roomId}/events`, 'GET', guest.data.token)).status, 410)
  console.log('PASS: disconnection notification survives restart')
} catch (error) {
  if (started) console.error(docker(['logs', container]))
  throw error
} finally {
  if (started) docker(['rm', '-f', container])
  if (createdVolume) docker(['volume', 'rm', volume])
}
