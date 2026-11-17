import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

await mkdir('tmp', { recursive: true })
const directory = await mkdtemp(resolve('tmp/local-test-'))
const port = process.env.TEST_LOCAL_PORT || '5183',
  base = 'http://127.0.0.1:' + port
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'],
  {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VITE_STORAGE_BACKEND: 'local',
      SHARE_STATE_PATH: resolve(directory, 'sharing.json')
    }
  }
)
let output = ''
server.stdout.on('data', (value) => (output += value))
server.stderr.on('data', (value) => (output += value))
let browser,
  passed = 0
const errors = []
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64'
)
async function check(name, action) {
  await action()
  passed++
  console.log('PASS ' + name)
}
async function pageFor(context) {
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto(base)
  await page.getByRole('heading', { name: '오늘의 발자취는 어디인가요' }).waitFor()
  return page
}
async function tab(page, name) {
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('button', { name, exact: true })
    .click()
}
async function close(page) {
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).last().click()
}
async function makeRecord(page, title, photo = false) {
  await tab(page, '노선도')
  await page.getByRole('textbox', { name: '역 이름 검색' }).fill('성수')
  await page.locator('.local-results button').first().click()
  await page.getByRole('button', { name: '이 역에 기록 남기기 ＋', exact: true }).click()
  await page.getByLabel('장소 이름', { exact: false }).fill(title)
  await page.getByLabel('기억할 이야기', { exact: false }).fill('사진과 함께 남긴 실제 기기 기록')
  if (photo) {
    await page
      .getByLabel('사진 파일 선택')
      .setInputFiles({ name: 'memory.png', mimeType: 'image/png', buffer: png })
    await page.getByAltText('첨부 사진 1').waitFor()
  }
  await page.getByRole('button', { name: '기기에 저장', exact: true }).click()
  await page.getByRole('dialog').getByRole('heading', { name: title, exact: true }).waitFor()
  await close(page)
}
async function visiblePhoto(page) {
  await page.locator('.local-record img').first().waitFor()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.local-record img')].some(
      (image) => image.complete && image.naturalWidth > 0
    )
  )
}
async function connect(host, guest) {
  await tab(host, '내 맵·설정')
  await host.getByRole('button', { name: '이 맵의 공유 코드 만들기' }).click()
  const code = (await host.getByLabel('공유 코드', { exact: true }).textContent()).trim()
  await tab(guest, '내 맵·설정')
  await guest.getByLabel('초대받은 공유 코드').fill(code)
  await guest.getByRole('button', { name: '코드로 연결 요청' }).click()
  await host.getByTestId('pair-phrase').waitFor()
  await host.getByRole('button', { name: '이 기기 연결 허용' }).click()
  await guest
    .getByText('최신 기록과 사진을 기기에 저장했어요.', { exact: true })
    .waitFor({ timeout: 60000 })
}
async function edit(page, title) {
  await tab(page, '타임라인')
  await page
    .locator('.local-record')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .getByRole('button')
    .click()
  await page.getByRole('dialog').getByRole('button', { name: '수정', exact: true }).click()
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(output)
    try {
      if ((await fetch(base)).ok) break
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (attempt === 99) throw new Error('Vite 준비 실패: ' + output)
  }
  browser = await chromium.launch({
    headless: true,
    channel: process.env.TEST_BROWSER_CHANNEL || 'msedge'
  })
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const host = await pageFor(hostContext),
    guest = await pageFor(guestContext)
  let downloadPath
  await check('로그인 없이 시작하고 Supabase 요청 없음', async () => {
    const requests = []
    hostContext.on('request', (request) => requests.push(request.url()))
    await host.reload()
    await host.getByRole('button', { name: '첫 기록 남기기 ＋' }).waitFor()
    assert(!requests.some((url) => url.includes('supabase.co') || url.includes('/auth/v1/')))
  })
  await check('실제 사진 전처리·기기 저장·재시작 후 복원', async () => {
    await makeRecord(host, '성수 첫 기억', true)
    await host.reload()
    await tab(host, '타임라인')
    await host.getByRole('heading', { name: '성수 첫 기억', exact: true }).waitFor()
    await visiblePhoto(host)
    await host.screenshot({ path: resolve(directory, 'desktop.png'), fullPage: true })
    await tab(host,'노선도')
    await host.getByRole('textbox',{name:'역 이름 검색'}).fill('성수')
    await host.locator('.local-results button').first().click()
    await host.waitForTimeout(200)
    await host.screenshot({path:resolve(directory,'map-desktop.png'),fullPage:true})
  })
  await check('암호화 전체 백업 생성', async () => {
    await tab(host, '내 맵·설정')
    await host.getByRole('button', { name: '암호화 백업·복원 열기' }).click()
    await host.getByLabel('백업 암호', { exact: true }).fill('test-passphrase-2026')
    const promise = host.waitForEvent('download')
    await host.getByRole('button', { name: '전체 맵·사진 백업 파일 만들기' }).click()
    const download = await promise
    downloadPath = resolve(directory, 'backup.baljachwi')
    await download.saveAs(downloadPath)
    await host.getByText('암호화 백업 파일을 만들었어요.', { exact: false }).waitFor()
  })
  await check('다른 기기에 사진 포함 백업 복원·잘못된 암호는 원본 보존', async () => {
    await tab(guest, '내 맵·설정')
    await guest.getByRole('button', { name: '암호화 백업·복원 열기' }).click()
    await guest.getByLabel('복원할 백업 파일').setInputFiles(downloadPath)
    await guest.getByLabel('백업 암호', { exact: true }).fill('wrong-passphrase')
    await guest.getByRole('button', { name: '백업에서 복원', exact: true }).click()
    await guest.getByRole('dialog').getByRole('alert').waitFor()
    await guest.getByLabel('백업 암호', { exact: true }).fill('test-passphrase-2026')
    await guest.getByRole('button', { name: '백업에서 복원', exact: true }).click()
    await guest.getByText('백업의 기록과 사진을 새 개인 맵으로 복원했어요.').waitFor()
    await tab(guest, '타임라인')
    await visiblePhoto(guest)
    await guest.screenshot({ path: resolve(directory, 'mobile.png'), fullPage: true })
    await tab(guest,'노선도')
    await guest.getByRole('textbox',{name:'역 이름 검색'}).fill('성수')
    await guest.locator('.local-results button').first().click()
    await guest.waitForTimeout(200)
    await guest.screenshot({path:resolve(directory,'map-mobile.png'),fullPage:true})
  })
  await check('공유 코드 승인 후 실제 WebRTC 사진 전송', async () => {
    await host.getByRole('button', { name: '이 맵의 공유 코드 만들기' }).click()
    const code = (await host.getByLabel('공유 코드', { exact: true }).textContent()).trim()
    await tab(guest, '내 맵·설정')
    await guest.getByLabel('초대받은 공유 코드').fill(code)
    await guest.getByRole('button', { name: '코드로 연결 요청' }).click()
    await host.getByTestId('pair-phrase').waitFor()
    await guest.getByTestId('pair-phrase').waitFor()
    assert.equal(
      await host.getByTestId('pair-phrase').textContent(),
      await guest.getByTestId('pair-phrase').textContent()
    )
    await host.getByRole('button', { name: '이 기기 연결 허용' }).click()
    await guest
      .getByText('최신 기록과 사진을 기기에 저장했어요.', { exact: true })
      .waitFor({ timeout: 60000 })
    await tab(guest, '타임라인')
    await visiblePhoto(guest)
    assert.equal(
      await guest.getByRole('button', { name: '기록 남기기 ＋', exact: true }).count(),
      0
    )
  })
  await check('원본 변경을 받은 맵에 동기화', async () => {
    await makeRecord(host, '추가한 두 번째 기록')
    await tab(host, '타임라인')
    await guest
      .getByRole('heading', { name: '추가한 두 번째 기록', exact: true })
      .waitFor({ timeout: 30000 })
  })
  await check('해제하면 양쪽 개인 맵·사진 보존·독립 수정', async () => {
    await tab(guest, '내 맵·설정')
    await guest.getByRole('button', { name: '연결 끊고 개인 맵으로' }).click()
    await guest.getByText('독립된 개인 맵이에요.', { exact: false }).waitFor()
    await host.getByText('독립된 개인 맵이에요.', { exact: false }).waitFor({ timeout: 20000 })
    await makeRecord(guest, '해제 뒤 나만의 기록')
    await tab(guest, '타임라인')
    await visiblePhoto(guest)
    await tab(host, '타임라인')
    assert.equal(
      await host.getByRole('heading', { name: '해제 뒤 나만의 기록', exact: true }).count(),
      0
    )
    await host.reload()
    await guest.reload()
    await tab(host, '타임라인')
    await tab(guest, '타임라인')
    await guest.getByRole('heading', { name: '해제 뒤 나만의 기록', exact: true }).waitFor()
    await visiblePhoto(guest)
    await visiblePhoto(host)
  })
  await check('모바일 가로 넘침·런타임 오류 없음', async () => {
    assert.equal(
      await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    )
    assert.deepEqual(errors, [])
  })
  await check('다른 탭의 수정과 충돌하면 덮어쓰지 않음', async () => {
    const other = await pageFor(hostContext)
    await edit(host, '성수 첫 기억')
    await edit(other, '성수 첫 기억')
    await host.getByLabel('기억할 이야기', { exact: false }).fill('먼저 저장한 최신 기록')
    await host.getByRole('button', { name: '기기에 저장', exact: true }).click()
    await close(host)
    await other.getByLabel('기억할 이야기', { exact: false }).fill('덮어쓰면 안 되는 오래된 수정')
    await other.getByRole('button', { name: '기기에 저장', exact: true }).click()
    await other.getByRole('dialog').getByRole('alert').waitFor()
    await close(other)
    await other.getByRole('dialog').getByText('먼저 저장한 최신 기록', { exact: true }).waitFor()
    await other.close()
  })
  await check('큰 맵 전송·비공개 맵 격리·페이지 재시작 후 재연결', async () => {
    await host.evaluate(async () => {
      const { mutate } = await import('/src/local/storage.ts')
      await mutate((state) => {
        const map = state.maps.find((map) => map.id === state.selectedMapId),
          sample = map.records[0]
        map.records.push(
          ...Array.from({ length: 80 }, (_, index) => ({
            ...sample,
            id: crypto.randomUUID(),
            place: '큰 맵 기록 ' + index,
            note: '긴 이야기'.repeat(120),
            photos: [],
            date: '2020-01-01',
            createdAt: '2020-01-01T00:00:00.000Z'
          }))
        )
        map.revision++
        state.maps.push({
          id: crypto.randomUUID(),
          title: '공유하지 않는 맵',
          revision: 0,
          share: null,
          records: [
            {
              ...sample,
              id: crypto.randomUUID(),
              place: '전송되면 안 되는 비공개 기록',
              photos: []
            }
          ]
        })
      })
    })
    await connect(host, guest)
    await tab(guest, '타임라인')
    await guest.getByText('기록 82개', { exact: true }).waitFor()
    assert.equal(
      await guest
        .getByRole('heading', { name: '전송되면 안 되는 비공개 기록', exact: true })
        .count(),
      0
    )
    await guest.getByRole('button', { name: '기록 더 보기' }).click()
    await guest.getByRole('heading', { name: '큰 맵 기록 0', exact: true }).waitFor()
    await guest.reload()
    await host.reload()
    await makeRecord(host, '재연결 뒤의 기록')
    await tab(guest, '타임라인')
    await guest
      .getByRole('heading', { name: '재연결 뒤의 기록', exact: true })
      .waitFor({ timeout: 60000 })
  })
  await check('사진 전송 중단은 마지막 완전한 맵을 보존하고 재시도 가능', async () => {
    await host.evaluate(() => {
      window.originalDataSend = RTCDataChannel.prototype.send
      RTCDataChannel.prototype.send = function (data) {
        if (data instanceof ArrayBuffer) return
        return window.originalDataSend.call(this, data)
      }
    })
    await makeRecord(host, '전송 중단 사진', true)
    await guest
      .getByText('사진을 끝까지 받지 못했어요.', { exact: false })
      .first()
      .waitFor({ timeout: 30000 })
    assert.equal(
      await guest.getByRole('heading', { name: '전송 중단 사진', exact: true }).count(),
      0
    )
    await host.evaluate(() => {
      RTCDataChannel.prototype.send = window.originalDataSend
      delete window.originalDataSend
    })
    await tab(host, '내 맵·설정')
    await host.getByRole('button', { name: '연결 다시 시도' }).click()
    await guest
      .getByRole('heading', { name: '전송 중단 사진', exact: true })
      .waitFor({ timeout: 60000 })
  })
  await check('연결 서버가 끊겨도 개인 맵 전환하고 복귀 후 상대에게 해제 전달', async () => {
    await guestContext.route('**/api/device-share/**', (route) => route.abort())
    await tab(guest, '내 맵·설정')
    await guest.getByRole('button', { name: '연결 끊고 개인 맵으로' }).click()
    await guest.getByText('독립된 개인 맵이에요.', { exact: false }).waitFor()
    await guest.getByText('상대에게 해제 사실을 전달하려면', { exact: false }).waitFor()
    await guestContext.unroute('**/api/device-share/**')
    await guest.evaluate(() => dispatchEvent(new Event('online')))
    await host.getByText('독립된 개인 맵이에요.', { exact: false }).waitFor({ timeout: 20000 })
    await tab(guest, '타임라인')
    await visiblePhoto(guest)
    assert.deepEqual(errors, [])
  })
  console.log(JSON.stringify({ passed, artifacts: directory }))
} catch (error) {
  console.error(error)
  if (browser)
    for (const [i, context] of browser.contexts().entries())
      for (const [j, page] of context.pages().entries()) {
        await page
          .screenshot({ path: resolve(directory, `failure-${i}-${j}.png`), fullPage: true })
          .catch(() => {})
        console.error(
          (
            await page
              .locator('body')
              .innerText()
              .catch(() => '')
          ).slice(-2200)
        )
      }
  console.error(output.slice(-1800))
  process.exitCode = 1
} finally {
  await browser?.close()
  server.kill()
  await once(server, 'exit').catch(() => {})
  await rm(resolve(directory, 'sharing.json'), { force: true })
}
