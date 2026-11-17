import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _android, chromium } from 'playwright'

const pkg = 'com.nemo9.dongnebaljachwi'
const apk = resolve('output/android/dongne-baljachwi-debug.apk')
const output = resolve('tmp/android-qa')
await mkdir(output, { recursive: true })
const base = 'http://127.0.0.1:8787'
const secret = 'emulator-only-turn-fixture'
const turn = spawn('turnserver', ['-n', '--no-cli', '--no-tls', '--no-dtls',
  '--listening-ip=127.0.0.1', '--relay-ip=127.0.0.1', '--allow-loopback-peers',
  '--listening-port=13478', '--min-port=49160', '--max-port=49200',
  '--realm=emulator.test', '--use-auth-secret', `--static-auth-secret=${secret}`,
  '--log-file=stdout'], { stdio: ['ignore', 'pipe', 'pipe'] })
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
  '--port', '8787', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, VITE_STORAGE_BACKEND: 'local', SHARE_STATE_PATH: resolve(output, 'sharing.json'),
    SHARE_ALLOWED_ORIGINS: 'https://localhost', SHARE_TURN_SECRET: secret,
    SHARE_TURN_URLS: 'turn:127.0.0.1:13478?transport=tcp'
  } })
let logs = ''
for (const child of [server, turn]) {
  child.stdout.on('data', value => { logs += value.toString() })
  child.stderr.on('data', value => { logs += value.toString() })
}
const errors = []
const results = []
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
let device, page, browser, guest
async function until(action, message, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await action()) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(message)
}
async function check(name, action) {
  await action()
  results.push(name)
  console.log('PASS ' + name)
}
async function openNative() {
  await device.shell(`am force-stop ${pkg}`)
  await device.shell(`am start -W -n ${pkg}/.MainActivity`)
  const view = await device.webView({ pkg, timeout: 45000 })
  const next = await view.page()
  page = next
  next.setDefaultTimeout(30000)
  next.on('pageerror', error => errors.push(error.message))
  next.on('dialog', dialog => void dialog.accept())
  try {
    await next.getByRole('heading', { name: '오늘의 발자취는 어디인가요' }).waitFor()
  } catch (error) {
    await writeFile(resolve(output, 'startup.json'), JSON.stringify({ url: next.url(),
      body: await next.locator('body').innerText(), errors }, null, 2))
    throw error
  }
  return next
}
async function tab(target, name) {
  await target.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name, exact: true }).click()
}
async function close(target) {
  await target.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).last().click()
}
async function fileInput(locator, data, name, type) {
  // 파일 선택 뒤의 전처리·네이티브 저장 경로를 검증한다. OS 사진 선택기 자체는 별도 실기기 항목이다.
  await locator.evaluate((input, file) => {
    const bytes = Uint8Array.from(atob(file.data), char => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], file.name, { type: file.type }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, { data, name, type })
}
async function makeRecord(target, title, photo = false) {
  await tab(target, '노선도')
  await target.getByRole('textbox', { name: '역 이름 검색' }).fill('성수')
  await target.locator('.local-results button').first().click()
  await target.getByRole('button', { name: '이 역에 기록 남기기 ＋', exact: true }).click()
  await target.getByLabel('장소 이름', { exact: false }).fill(title)
  await target.getByLabel('기억할 이야기', { exact: false }).fill('Android VM 실제 SQLite·사진 기록')
  if (photo) {
    await fileInput(target.getByLabel('사진 파일 선택'), png, 'fixture.png', 'image/png')
    await target.getByAltText('첨부 사진 1').waitFor()
  }
  await target.getByRole('button', { name: '기기에 저장', exact: true }).click()
  await target.getByRole('dialog').getByRole('heading', { name: title, exact: true }).waitFor()
  await close(target)
}
async function photos(target) {
  await target.waitForFunction(() => [...document.querySelectorAll('.local-record img')]
    .some(image => image.complete && image.naturalWidth > 0))
}
try {
  await until(async () => {
    try { return (await fetch(base + '/api/device-share/health')).ok } catch { return false }
  }, '검증 서버 시작 실패')
  const devices = await _android.devices()
  assert(devices.length, 'Android emulator not found')
  device = devices[0]
  assert.equal((await device.shell('getprop ro.kernel.qemu')).toString().trim(), '1',
    'This test only runs on a disposable emulator, never a personal phone')
  execFileSync('adb', ['-s', device.serial(), 'reverse', 'tcp:8787', 'tcp:8787'])
  execFileSync('adb', ['-s', device.serial(), 'reverse', 'tcp:13478', 'tcp:13478'])
  await device.shell('logcat -c')
  await device.installApk(apk)
  page = await openNative()
  await check('Android 네이티브 SQLite와 사진 파일에 저장', async () => {
    assert.equal(await page.evaluate(() => window.Capacitor.getPlatform()), 'android')
    await makeRecord(page, '가상 기기 첫 기록', true)
    assert.match((await device.shell(`run-as ${pkg} ls databases`)).toString(), /baljachwi_device/)
    assert.match((await device.shell(`run-as ${pkg} find files -type f`)).toString(), /\.jpg/)
  })
  await check('강제 종료·재실행 뒤 글과 사진 유지', async () => {
    page = await openNative()
    await tab(page, '타임라인')
    await page.getByRole('heading', { name: '가상 기기 첫 기록', exact: true }).waitFor()
    await photos(page)
    await page.screenshot({ path: resolve(output, 'native-persisted.png'), fullPage: true })
  })
  await check('동일 서명 APK 덮어 설치 뒤 데이터 유지', async () => {
    await device.installApk(apk)
    page = await openNative()
    await tab(page, '타임라인')
    await page.getByRole('heading', { name: '가상 기기 첫 기록', exact: true }).waitFor()
    await photos(page)
  })
  let backup
  await check('네이티브 암호화 백업 파일·공유 시트 생성', async () => {
    await tab(page, '내 맵·설정')
    await page.getByRole('button', { name: '암호화 백업·복원 열기' }).click()
    await page.getByLabel('백업 암호', { exact: true }).fill('emulator-fixture-password')
    await page.getByRole('button', { name: '전체 맵·사진 백업 파일 만들기' }).click()
    let path = ''
    await until(async () => {
      path = (await device.shell(`run-as ${pkg} find cache -name '*.baljachwi'`)).toString().trim().split('\n')[0]
      return path.endsWith('.baljachwi')
    }, 'Native backup file was not created')
    backup = Buffer.from((await device.shell(`run-as ${pkg} base64 '${path}'`)).toString(), 'base64')
    assert.equal(backup.subarray(0, 8).toString(), 'BALJENC1')
    const activities = (await device.shell('dumpsys activity activities')).toString()
    assert.match(activities, /ChooserActivity|IntentResolver|ResolverActivity/i)
    // 공유 시트 취소 후 앱으로 돌아온다. 외부 보관 성공으로 계산하지 않는다.
    await device.shell('input keyevent 4')
    await until(() => page.getByRole('button', { name: '전체 맵·사진 백업 파일 만들기' }).isEnabled(), 'Share sheet did not dismiss')
    await close(page)
  })
  await check('잘못된 암호 거부·사진 포함 새 맵 복원', async () => {
    await page.getByRole('button', { name: '암호화 백업·복원 열기' }).click()
    await fileInput(page.getByLabel('복원할 백업 파일'), backup.toString('base64'), 'fixture.baljachwi', 'application/octet-stream')
    await page.getByLabel('백업 암호', { exact: true }).fill('wrong-password')
    await page.getByRole('button', { name: '백업에서 복원', exact: true }).click()
    await page.getByRole('dialog').getByRole('alert').waitFor()
    assert.equal(await page.getByLabel('현재 맵', { exact: true }).locator('option').count(), 1)
    await page.getByLabel('백업 암호', { exact: true }).fill('emulator-fixture-password')
    await page.getByRole('button', { name: '백업에서 복원', exact: true }).click()
    await page.getByText('백업의 기록과 사진을 새 개인 맵으로 복원했어요.').waitFor()
    assert.equal(await page.getByLabel('현재 맵', { exact: true }).locator('option').count(), 2)
    await tab(page, '타임라인')
    await photos(page)
  })
  browser = await chromium.launch({ headless: true })
  guest = await browser.newPage({ viewport: { width: 390, height: 844 } })
  guest.on('dialog', dialog => void dialog.accept())
  guest.on('pageerror', error => errors.push(error.message))
  await guest.goto(base)
  await guest.getByRole('heading', { name: '오늘의 발자취는 어디인가요' }).waitFor()
  await check('Android 원본에서 Chromium 상대에게 실제 WebRTC 사진 공유', async () => {
    await tab(page, '내 맵·설정')
    await page.getByLabel('공유 연결 서버').fill(base)
    await page.getByRole('button', { name: '이 맵의 공유 코드 만들기' }).click()
    const code = (await page.getByLabel('공유 코드', { exact: true }).textContent()).trim()
    await tab(guest, '내 맵·설정')
    await guest.getByLabel('초대받은 공유 코드').fill(code)
    await guest.getByRole('button', { name: '코드로 연결 요청' }).click()
    await page.getByTestId('pair-phrase').waitFor()
    await page.getByRole('button', { name: '이 기기 연결 허용' }).click()
    await guest.getByText('최신 기록과 사진을 기기에 저장했어요.', { exact: true }).waitFor({ timeout: 90000 })
    await tab(guest, '타임라인')
    await guest.getByRole('heading', { name: '가상 기기 첫 기록', exact: true }).waitFor()
    await photos(guest)
    await guest.screenshot({ path: resolve(output, 'browser-received.png'), fullPage: true })
    await makeRecord(page, '연결 중 추가 기록')
    await guest.getByRole('heading', { name: '연결 중 추가 기록', exact: true }).waitFor({ timeout: 60000 })
  })
  await check('연결 해제 뒤 양쪽 사본 보존·독립 작성', async () => {
    await tab(page, '내 맵·설정')
    await page.getByRole('button', { name: '연결 끊고 개인 맵으로' }).click()
    await guest.getByText('독립된 개인 맵이에요.', { exact: false }).waitFor()
    await makeRecord(page, 'Android 독립 기록')
    await makeRecord(guest, '브라우저 독립 기록')
    await tab(page, '타임라인')
    await tab(guest, '타임라인')
    assert.equal(await page.getByRole('heading', { name: '브라우저 독립 기록', exact: true }).count(), 0)
    assert.equal(await guest.getByRole('heading', { name: 'Android 독립 기록', exact: true }).count(), 0)
    await photos(page)
    await photos(guest)
  })
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ platform: 'Android emulator + Chromium',
    android: (await device.shell('getprop ro.build.version.release')).toString().trim(),
    passed: results, limitations: ['OS 사진 선택기 실제 조작', '백업 외부 보관 완료', '두 실제 휴대폰·다른 통신망'] }, null, 2))
  console.log(`${results.length} Android emulator checks passed`)
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  if (device) await writeFile(resolve(output, 'logcat.txt'), await device.shell('logcat -d -s Capacitor Capacitor/Console Capacitor/Plugin chromium AndroidRuntime')).catch(() => {})
  await writeFile(resolve(output, 'server.log'), logs)
  throw error
} finally {
  await browser?.close()
  await device?.close()
  server.kill()
  turn.kill()
}
