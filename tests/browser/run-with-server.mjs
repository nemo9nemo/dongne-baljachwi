import { spawn } from 'node:child_process'
import { once } from 'node:events'

// 같은 실행 환경에서 서버와 브라우저를 띄워 로컬 네트워크 격리 차이를 없앤다.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5175'
const url = new URL(base)
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', url.hostname, '--port', url.port, '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let serverOutput = ''
server.stdout.on('data', chunk => { serverOutput += chunk })
server.stderr.on('data', chunk => { serverOutput += chunk })
let exitCode = 1
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(serverOutput)
    try {
      if ((await fetch(base)).ok) { ready = true; break }
    } catch { /* 서버가 포트를 열 때까지 기다린다. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('Vite 시작 시간 초과: ' + serverOutput)
  exitCode = 0
  for (const script of ['tests/browser/run.mjs', 'tests/browser/completion.mjs']) {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, TEST_BASE_URL: base }, stdio: 'inherit', windowsHide: true,
    })
    const [code] = await once(child, 'exit')
    if (code !== 0) { exitCode = code ?? 1; break }
  }
} finally {
  server.kill()
}
process.exitCode = exitCode
