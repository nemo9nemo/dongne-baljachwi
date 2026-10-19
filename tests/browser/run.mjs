import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5174'
const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' })
const errors = []
let saved
let failPhotos = false
let failSnapshot = false
let dropBodyOnce = false
let dropPhotosOnce = false
let conflictBodyOnce = false
let delaySnapshotId = null
let failUploadAt = -1
const uploadRequests = []
const bodyRequests = []
const photoRequests = []
const receipts = new Map()
const records = new Map()
const originalPhotos = [1,2,3].map((n, sort_order) => ({ id: `photo-${n}`, storage_path: `couple-a/edit-a/photo-${n}.jpg`, sort_order, width: 20, height: 20, byte_size: 100, content_type: 'image/jpeg' }))
const editRecord = () => ({ record: { id: 'edit-a', revision: 1, couple_id: 'couple-a', station_id: 'station-a', visited_on: '2026-01-01', mood: 'happy', weather: 'sunny', note: '서버 원본' }, tags: ['기존태그'], photos: structuredClone(originalPhotos) })
records.set('edit-a', editRecord())
const card = (id, text) => ({ id, station_id: 'station-a', visited_on: '2026-01-01', mood: 'happy', weather: 'sunny', note_excerpt: text, author_id: 'user-a' })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  // 외부 요청은 모두 모킹해 실서비스 데이터를 읽거나 변경하지 않는다.
  await page.route('https://**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/storage/v1/object/record-photos/') && route.request().method() === 'POST') {
      uploadRequests.push(url.pathname)
      if (uploadRequests.length === failUploadAt) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'one upload failure' }) })
        return
      }
    }
    if (failPhotos && url.pathname.includes('/storage/v1/')) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'test upload failure' }) })
      return
    }
    const table = url.pathname.split('/').at(-1)
    const appError = async code => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: JSON.stringify({ error_code: code, message: 'injected failure' }) }) })
    let data = []
    if (table === 'app_settings') data = { value: { version: 1 } }
    if (table === 'lines') data = [{ id: 'line-a', code: '2', name: '2호선', color_token: '--line-2', sort_order: 1, in_mvp_scope: true, is_active: true }]
    if (table === 'station_master_public') data = [{ id: 'station-a', code: 'TEST', name: '테스트역', name_short: '테스트', lat: 37, lng: 127, region_code: '11', is_active: true, is_transfer: false, in_mvp_scope: true }]
    if (table === 'station_lines') data = [{ station_id: 'station-a', line_id: 'line-a', seq: 1 }]
    if (table === 'couple_tag_usage') data = [{ tag: '느림', tag_norm: '느림', usage_count: 1 }, { tag: '빠름', tag_norm: '빠름', usage_count: 1 }]
    if (table === 'record_tags' && url.searchParams.has('tag_norm')) data = [{ record_id: url.searchParams.get('tag_norm').includes('느림') ? 'slow' : 'fast' }]
    if (table === 'query_record_cards') {
      const args = route.request().postDataJSON()
      const slow = args.p_tag_norm === '느림'
      const fast = args.p_tag_norm === '빠름'
      if (slow) await new Promise(resolve => setTimeout(resolve, 700))
      data = [card(slow ? 'slow' : fast ? 'fast' : 'initial', slow ? '늦게 온 이전 기록' : fast ? '최신 필터 기록' : '첫 기록')]
      if (args.p_station_id) data = []
    }
    if (table === 'get_record_edit_snapshot') {
      if (failSnapshot) { await appError('UNKNOWN'); return }
      const { p_record_id } = route.request().postDataJSON()
      data = records.get(p_record_id) ?? null
      if (p_record_id === delaySnapshotId) await new Promise(resolve => setTimeout(resolve, 700))
    }
    if (table === 'save_record_v3') {
      saved = route.request().postDataJSON()
      bodyRequests.push(structuredClone(saved))
      if (conflictBodyOnce) {
        conflictBodyOnce = false
        records.get(saved.p_record_id).record.note = '다른 기기의 최신 글'
        records.get(saved.p_record_id).record.revision += 1
        await appError('RECORD_CONFLICT'); return
      }
      const key = 'body:' + saved.p_operation_id
      data = receipts.get(key)
      if (!data) {
        const previous = records.get(saved.p_record_id)
        if (!saved.p_create && previous?.record.revision !== saved.p_expected_revision) { await appError('RECORD_CONFLICT'); return }
        const revision = saved.p_create ? 1 : previous.record.revision + 1
        records.set(saved.p_record_id, { record: { ...previous?.record, id: saved.p_record_id, revision,
          station_id: saved.p_station_id, visited_on: saved.p_visited_on, mood: saved.p_mood, weather: saved.p_weather, note: saved.p_note, place_name: saved.p_place_name }, tags: saved.p_tags, photos: previous?.photos ?? [] })
        data = { record_id: saved.p_record_id, created: saved.p_create, revision, updated_at: new Date().toISOString() }
        receipts.set(key, data)
      }
      if (dropBodyOnce) { dropBodyOnce = false; await route.abort('failed'); return }
    }
    if (table === 'sync_record_photos') {
      const args = route.request().postDataJSON()
      photoRequests.push(args)
      const key = 'photos:' + args.p_operation_id
      data = receipts.get(key)
      if (!data) {
        const previous = records.get(args.p_record_id)
        if (previous.record.revision !== args.p_expected_revision) { await appError('RECORD_CONFLICT'); return }
        const removed_paths = previous.photos.filter(photo => !args.p_photos.some(p => p.id === photo.id)).map(photo => photo.storage_path)
        previous.photos = args.p_photos
        previous.record.revision += 1
        data = { record_id: args.p_record_id, revision: previous.record.revision, updated_at: new Date().toISOString(), photos: args.p_photos, removed_paths }
        receipts.set(key, data)
      }
      if (dropPhotosOnce) { dropPhotosOnce = false; await route.abort('failed'); return }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  const open = entry => page.goto(`${base}/tests/browser/index.html?entry=${encodeURIComponent(entry)}`)
  await open('/records/new?stationId=station-a')
  await page.getByLabel('일기', { exact: true }).fill('단순한 기록')
  const optional = page.locator('details')
  assert.equal(await optional.getAttribute('open'), null)
  await optional.locator('summary').click()
  await page.getByRole('radio', { name: '기쁨' }).click()
  await page.getByRole('radio', { name: '맑음' }).click()
  await page.getByLabel('태그', { exact: true }).fill('산책')
  await page.getByLabel('태그', { exact: true }).press('Enter')
  await optional.locator('summary').click()
  await optional.locator('summary').focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.getByRole('radio', { name: '기쁨' }).getAttribute('aria-checked'), 'true')
  await optional.locator('summary').click()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByText('저장 완료 상세 화면').waitFor()
  assert.equal(saved.p_note, '단순한 기록')
  assert.equal(saved.p_mood, 'happy')
  assert.equal(saved.p_weather, 'sunny')
  assert.deepEqual(saved.p_tags, ['산책'])
  console.log('PASS 선택 항목 접기·키보드 조작·입력값 유지·저장 요청')
  await open('/records/new?stationId=station-a')
  await page.getByLabel('일기', { exact: true }).fill('사진 실패 테스트')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 20; canvas.height = 20
    canvas.getContext('2d').fillRect(0, 0, 20, 20)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.locator('img').first().waitFor()
  failPhotos = true
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '사진' }).waitFor()
  await page.getByRole('link', { name: '테스트 목록 이동' }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: '계속 작성' }).click()
  assert.equal(await page.getByLabel('일기', { exact: true }).inputValue(), '사진 실패 테스트')
  failPhotos = false
  console.log('PASS 사진 업로드 실패 후 이탈 경고·작성값 유지')
  // 현재 쓰기 계약의 실패 경로를 실제 React 화면에서 검사한다.
  const fresh = async entry => {
    await page.evaluate(() => localStorage.clear())
    records.set('edit-a', editRecord())
    records.set('edit-b', { ...editRecord(), record: { ...editRecord().record, id: 'edit-b', note: '다음 기록 내용' }, tags: ['다음태그'], photos: [] })
    await open(entry)
  }
  await fresh('/records/edit-a/edit')
  await page.getByLabel('일기', { exact: true }).waitFor()
  failSnapshot = true
  await page.reload()
  await page.getByText('기록과 태그·사진을 모두 불러오지 못했어요. 다시 시도해주세요.').waitFor()
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).count(), 0)
  failSnapshot = false
  await page.getByRole('button', { name: '다시 시도', exact: true }).click()
  await page.getByLabel('일기', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('일기', { exact: true }).inputValue(), '서버 원본')
  assert.equal(await page.getByRole('button', { name: '사진 다시 불러오기', exact: true }).count(), 3)
  await page.locator('summary').click()
  await page.getByRole('button', { name: '기존태그 태그 삭제', exact: true }).waitFor()
  console.log('PASS 완전한 스냅샷 실패 시 저장 차단·재시도·사진 서명 실패 시 메타데이터 보존')

  delaySnapshotId = 'edit-a'
  await fresh('/records/edit-a/edit')
  await page.getByRole('link', { name: '다른 기록 편집', exact: true }).click()
  await page.getByLabel('일기', { exact: true }).waitFor()
  await page.waitForTimeout(900)
  assert.equal(await page.getByLabel('일기', { exact: true }).inputValue(), '다음 기록 내용')
  delaySnapshotId = null
  console.log('PASS 기록 A의 늦은 스냅샷이 기록 B 편집에 들어오지 않음')

  await fresh('/records/edit-a/edit')
  await page.getByLabel('일기', { exact: true }).waitFor()
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      toBlob.call(this, blob => { window.__releasePhoto = () => callback(blob) }, ...args)
    }
  })
  const beforePreparing = bodyRequests.length
  await page.locator('input[type=file]').setInputFiles({ name: 'preparing.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.waitForFunction(() => typeof window.__releasePhoto === 'function')
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '사진 1 삭제', exact: true }).isDisabled(), true)
  await page.getByLabel('일기', { exact: true }).fill('준비 중에도 글 입력 유지')
  await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  assert.equal(bodyRequests.length, beforePreparing)
  await page.evaluate(() => window.__releasePhoto())
  await page.locator('img').first().waitFor()
  assert.equal(await page.getByRole('button', { name: '사진 4 삭제', exact: true }).count(), 1)
  console.log('PASS 사진 준비 중 Enter·삭제 차단·글 입력 허용·준비 완료 목록 반영')

  await fresh('/records/new?stationId=station-a')
  await page.getByLabel('일기', { exact: true }).waitFor()
  await page.locator('input[type=file]').setInputFiles([
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
    { name: 'valid.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
  ])
  await page.getByText('broken.png — 이미지를 읽지 못했어요.', { exact: true }).waitFor()
  await page.getByRole('button', { name: '사진 1 삭제', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '사진 2 삭제', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isEnabled(), true)
  console.log('PASS 한 파일 디코딩 실패가 다른 준비 사진을 지우지 않음')

  await fresh('/records/new?stationId=station-a')
  await page.getByLabel('일기', { exact: true }).waitFor()
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      toBlob.call(this, blob => { window.__releasePhoto = () => callback(blob) }, ...args)
    }
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'leave.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.waitForFunction(() => typeof window.__releasePhoto === 'function')
  await page.getByRole('link', { name: '테스트 목록 이동', exact: true }).click()
  await page.getByRole('button', { name: '나가기', exact: true }).click()
  await page.getByText('첫 기록', { exact: true }).waitFor()
  await page.evaluate(() => window.__releasePhoto())
  await page.waitForTimeout(100)
  assert.equal(await page.getByText('첫 기록', { exact: true }).count(), 1)
  console.log('PASS 사진 준비 중 이탈 확인·화면 종료 후 늦은 완료 폐기')

  await fresh('/records/new?stationId=station-a')
  await page.getByLabel('일기', { exact: true }).fill('글 우선 저장')
  await page.locator('input[type=file]').setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.locator('img').first().waitFor()
  failPhotos = true
  const beforePhotoBody = bodyRequests.length
  const beforePhotoSync = photoRequests.length
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '기존 사진 목록을 유지' }).waitFor()
  assert.equal(bodyRequests.length, beforePhotoBody + 1)
  assert.equal(photoRequests.length, beforePhotoSync)
  const retryId = saved.p_record_id
  await page.getByLabel('일기', { exact: true }).fill('사진만 재시도할 때 저장하지 않을 글')
  failPhotos = false
  await page.getByRole('button', { name: '사진 다시 올리기', exact: true }).click()
  await page.getByText('사진은 저장됐어요. 변경한 글은 전체 저장 버튼으로 저장해주세요.').waitFor()
  assert.equal(bodyRequests.length, beforePhotoBody + 1)
  assert.equal(records.get(retryId).record.note, '글 우선 저장')
  assert.equal(records.get(retryId).photos.length, 1)
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByText('저장 완료 상세 화면').waitFor()
  assert.equal(records.get(retryId).record.note, '사진만 재시도할 때 저장하지 않을 글')
  console.log('PASS 업로드 실패 시 목록 교체 보류·사진 전용 재시도·추가 본문 보존')

  await fresh('/records/edit-a/edit')
  await page.getByLabel('일기', { exact: true }).waitFor()
  await page.locator('input[type=file]').setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
    { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
  ])
  await page.getByRole('button', { name: '사진 5 삭제', exact: true }).waitFor()
  const beforeUploads = uploadRequests.length
  failUploadAt = beforeUploads + 2
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '기존 사진 목록을 유지' }).waitFor()
  assert.equal(records.get('edit-a').photos.length, 3)
  await page.getByRole('button', { name: '사진 다시 올리기', exact: true }).click()
  await page.getByText('저장 완료 상세 화면').waitFor()
  assert.equal(uploadRequests.length, beforeUploads + 3)
  assert.equal(records.get('edit-a').photos.length, 5)
  console.log('PASS 일부 업로드 성공 파일 재사용·실패 파일만 재업로드·기존 사진 전량 유지')

  await fresh('/records/edit-a/edit')
  await page.getByLabel('일기', { exact: true }).waitFor()
  await page.locator('input[type=file]').setInputFiles({ name: 'conflict.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.getByRole('button', { name: '사진 4 삭제', exact: true }).waitFor()
  failPhotos = true
  const beforeOtherDevice = bodyRequests.length
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '기존 사진 목록을 유지' }).waitFor()
  records.get('edit-a').record.note = '사진 실패 사이 다른 기기가 쓴 글'
  records.get('edit-a').record.revision += 1
  failPhotos = false
  await page.getByRole('button', { name: '사진 다시 올리기', exact: true }).click()
  await page.getByRole('button', { name: '최신 내용 확인', exact: true }).waitFor()
  assert.equal(bodyRequests.length, beforeOtherDevice + 1)
  assert.equal(records.get('edit-a').record.note, '사진 실패 사이 다른 기기가 쓴 글')
  assert.equal(records.get('edit-a').photos.length, 3)
  console.log('PASS 사진 재시도가 다른 기기의 본문을 덮지 않고 버전 충돌로 멈춤')

  await fresh('/records/new?stationId=station-a')
  await page.getByLabel('일기', { exact: true }).fill('응답 유실 후 복구')
  dropBodyOnce = true
  const beforeDroppedBody = bodyRequests.length
  const beforeCreate = records.size
  await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  await page.getByText('저장 결과를 확인하지 못했어요. 같은 요청의 결과를 확인해주세요.', { exact: true }).waitFor()
  assert.equal(bodyRequests.length, beforeDroppedBody + 1)
  await page.reload()
  // 같은 공동 공간이어도 계정이 바뀌면 미확인 요청과 초안을 노출하지 않는다.
  await page.goto(base + '/tests/browser/index.html?entry=' + encodeURIComponent('/records/new?stationId=station-a') + '&user=user-b')
  await page.getByLabel('일기', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '저장 결과 확인', exact: true }).count(), 0)
  assert.equal(await page.getByLabel('일기', { exact: true }).inputValue(), '')
  await open('/records/new?stationId=station-a')
  await page.getByRole('button', { name: '저장 결과 확인', exact: true }).click()
  await page.getByText('저장 결과를 확인했어요. 전송했던 글을 유지했어요.').waitFor()
  assert.equal(bodyRequests.length, beforeDroppedBody + 2)
  assert.equal(bodyRequests.at(-1).p_operation_id, bodyRequests.at(-2).p_operation_id)
  assert.equal(bodyRequests.at(-1).p_record_id, bodyRequests.at(-2).p_record_id)
  assert.equal(records.size, beforeCreate + 1)
  assert.equal(await page.getByLabel('일기', { exact: true }).inputValue(), '응답 유실 후 복구')
  console.log('PASS 연속 제출 차단·커밋 후 응답 유실·새로고침 후 같은 요청 복구·중복 생성 방지')
  console.log('PASS 같은 공간의 다른 계정에 미확인 요청·초안 노출 없음')

  await fresh('/records/new?stationId=station-a')
  await page.getByLabel('일기', { exact: true }).fill('부분 사진 실패 후 새로고침')
  await page.locator('input[type=file]').setInputFiles({ name: 'refresh.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.locator('img').first().waitFor()
  failPhotos = true
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '기존 사진 목록을 유지' }).waitFor()
  const partialId = saved.p_record_id
  await page.getByLabel('일기', { exact: true }).fill('사진 실패 뒤 추가로 편집한 초안')
  await page.waitForTimeout(700)
  failPhotos = false
  await page.reload()
  await page.getByText('작성 중이던 내용이 있어요. 이어서 쓸까요?', { exact: true }).waitFor()
  await page.waitForTimeout(700)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dbj.record-draft.user-a.couple-a.new')).note), '사진 실패 뒤 추가로 편집한 초안')
  await page.getByRole('button', { name: '저장 결과 확인', exact: true }).click()
  await page.getByText('글은 저장됐어요. 새로고침으로 사진 파일이 없어졌어요. 사진을 다시 선택해주세요.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '이어서 쓰기', exact: true }).click()
  await page.getByRole('button', { name: '새 사진 없이 계속', exact: true }).click()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByText('저장 완료 상세 화면').waitFor()
  assert.equal(saved.p_record_id, partialId)
  assert.equal(saved.p_create, false)
  assert.equal(records.get(partialId).record.note, '사진 실패 뒤 추가로 편집한 초안')
  console.log('PASS 부분 실패 후 새로고침에서도 기록 ID 유지·사진 재선택 범위 안내·명시적 사진 제외')

  await fresh('/records/edit-a/edit')
  await page.getByLabel('일기', { exact: true }).fill('내가 쓴 글')
  conflictBodyOnce = true
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByRole('button', { name: '최신 내용 확인', exact: true }).click()
  await page.getByText('다른 기기의 최신 글', { exact: true }).waitFor()
  for (const width of [360, 1280, 390]) {
    await page.setViewportSize({ width, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.screenshot({ path: 'docs/design/references/record-write-conflict-mobile-2026-10-15.png', fullPage: true })
  assert.equal(await page.getByLabel('일기', { exact: true }).inputValue(), '내가 쓴 글')
  assert.equal(records.get('edit-a').record.note, '다른 기기의 최신 글')
  await page.getByRole('button', { name: '내 입력을 최신 버전에 적용', exact: true }).click()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByText('저장 완료 상세 화면').waitFor()
  assert.equal(records.get('edit-a').record.note, '내가 쓴 글')
  console.log('PASS 버전 충돌 시 내 글 보존·서버 내용 비교·명시적 재적용')

  await fresh('/records/edit-a/edit')
  await page.getByRole('button', { name: '사진 1 뒤로 이동', exact: true }).click()
  dropPhotosOnce = true
  const beforeDroppedPhotoBody = bodyRequests.length
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '글은 저장됐어요.' }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: '저장 결과 확인', exact: true }).click()
  await page.getByText('저장 결과를 확인했어요. 전송했던 글을 유지했어요.').waitFor()
  assert.equal(bodyRequests.length, beforeDroppedPhotoBody + 1)
  assert.equal(photoRequests.at(-1).p_operation_id, photoRequests.at(-2).p_operation_id)
  assert.deepEqual(records.get('edit-a').photos.map(photo => photo.id), ['photo-2','photo-1','photo-3'])
  console.log('PASS 사진 확정 응답 유실·새로고침 복구에서 본문 재전송 없음·사진 순서 보존')

  await fresh('/records/new?stationId=station-a')
  await page.getByLabel('일기', { exact: true }).fill('초안 삭제 실패에도 저장 완료')
  await page.evaluate(() => {
    const removeItem = Storage.prototype.removeItem
    Storage.prototype.removeItem = function(key) {
      if (key.includes('record-draft')) throw new Error('injected storage failure')
      return removeItem.call(this, key)
    }
  })
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByText('저장 완료 상세 화면').waitFor()
  console.log('PASS 로컬 초안 정리 예외가 서버 저장 성공을 바꾸지 않음')
  await open('/timeline')
  await page.getByText('첫 기록', { exact: true }).waitFor()
  await page.locator('summary').click()
  await page.getByRole('button', { name: '#느림 1' }).click()
  await page.getByRole('button', { name: '#빠름 1' }).click()
  await page.getByText('최신 필터 기록', { exact: true }).waitFor()
  await page.waitForTimeout(1000)
  assert.equal(await page.getByText('늦게 온 이전 기록', { exact: true }).count(), 0)
  assert.equal(await page.getByText('최신 필터 기록', { exact: true }).count(), 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  console.log('PASS 필터 응답 역전·모바일 가로 넘침·브라우저 오류 없음')
} finally {
  await browser.close()
}
