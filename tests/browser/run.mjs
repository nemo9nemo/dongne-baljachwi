import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5174'
const browser = await chromium.launch({
  headless: true,
  channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
})
/** 조회 오류·재시도·서명 오류·응답 지연을 재현하는 모의 API 상태. */
const pageErrors = []
let saveRequests = 0
let tagFailureId = null
let remainingTagFailures = 0
let photoFailureId = null
let remainingPhotoFailures = 0
let failPhotoSigning = false
let delayRecordA = false

/** 테스트 기록 한 건을 만든다.
 * @param {string} recordId 필수: 조회 경로에 넣을 기록 ID
 * @returns {object} 화면 조회 응답에 필요한 기록 행
 */
function recordFor(recordId) {
  return {
    id: recordId,
    station_id: 'station-a',
    visited_on: '2026-01-01',
    mood: 'happy',
    weather: 'sunny',
    note: `메모 ${recordId}`,
    author_id: 'user-a',
    last_edited_by: 'user-a',
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  // 외부 API를 모두 가로채어 실제 Supabase 데이터에는 접근하지 않는다.
  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').at(-1)
    const queryId = url.searchParams.get('id') ?? url.searchParams.get('record_id') ?? ''
    const recordId = queryId.split('.').at(-1) ?? ''
    let data = []

    if (table === 'app_settings') data = { value: { version: 1 } }
    if (table === 'lines') {
      data = [
        {
          id: 'line-a',
          code: '2',
          name: '2호선',
          sort_order: 1,
          color_token: 'line-2',
          in_mvp_scope: true,
          is_active: true,
        },
      ]
    }
    if (table === 'station_master_public') {
      data = [
        {
          id: 'station-a',
          code: 'TEST',
          name: '테스트역',
          name_short: '테스트',
          lat: 37,
          lng: 127,
          region_code: '11',
          is_active: true,
          is_transfer: false,
          in_mvp_scope: true,
        },
      ]
    }
    if (table === 'station_lines' || table === 'couple_tag_usage') data = []
    if (table === 'records') {
      if (delayRecordA && recordId === 'record-a') {
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
      data = recordFor(recordId)
    }
    if (table === 'record_tags') {
      if (recordId === tagFailureId && remainingTagFailures > 0) {
        remainingTagFailures -= 1
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'TEST_FAILURE', message: 'tag query failed' }),
        })
        return
      }
      data = [`태그 ${recordId} 1`, `태그 ${recordId} 2`].map((tag) => ({ tag }))
    }
    if (table === 'record_photos') {
      if (recordId === photoFailureId && remainingPhotoFailures > 0) {
        remainingPhotoFailures -= 1
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'TEST_FAILURE', message: 'photo query failed' }),
        })
        return
      }
      data = [1, 2].map((index) => ({
        id: `${recordId}-photo-${index}`,
        storage_path: `${recordId}/photo-${index}.jpg`,
        sort_order: index - 1,
        width: 640,
        height: 480,
        byte_size: 1024,
        content_type: 'image/jpeg',
      }))
    }
    if (url.pathname.endsWith('/rpc/upsert_record')) {
      saveRequests += 1
      data = { record_id: 'saved-record', created: false, updated_at: new Date().toISOString() }
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })

  await page.route('**/storage/v1/**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p5sAAAAASUVORK5CYII=',
          'base64',
        ),
      })
      return
    }
    if (failPhotoSigning) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'signing failed' }),
      })
      return
    }
    const paths = route.request().postDataJSON().paths
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(paths.map((path) => ({ path, signedURL: `/object/sign/photos/${path}?token=test` }))),
    })
  })

  /** 모의 앱에 특정 편집/상세 경로로 진입한다.
   * @param {string} entry 필수: `/records/:id/edit` 또는 `/records/:id` 경로
   * @returns {Promise<object>} 페이지 탐색 완료 응답
   */
  const open = (entry) =>
    page.goto(`${base}/tests/browser/index.html?entry=${encodeURIComponent(entry)}`)

  tagFailureId = 'record-a'
  remainingTagFailures = 1
  await open('/records/record-a/edit')
  await page.getByText('기록 내용을 불러오지 못했어요.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).count(), 0)
  assert.equal(saveRequests, 0)

  await page.getByRole('button', { name: '다시 시도', exact: true }).click()
  await page.getByText('태그 record-a 1', { exact: false }).waitFor()
  const loadedEditorPhotos = page.locator('[aria-labelledby="photo-label"] li')
  assert.equal(await loadedEditorPhotos.count(), 2)
  assert.deepEqual(
    await page
      .locator('[aria-labelledby="photo-label"] img')
      .evaluateAll((images) => images.map((image) => image.getAttribute('src'))),
    [
      'http://localhost:54321/storage/v1/object/sign/photos/record-a/photo-1.jpg?token=test',
      'http://localhost:54321/storage/v1/object/sign/photos/record-a/photo-2.jpg?token=test',
    ],
  )
  console.log('PASS 태그 조회 실패는 편집을 막고 재시도 성공 시 태그와 사진 순서를 복원')

  photoFailureId = 'record-b'
  remainingPhotoFailures = 1
  await open('/records/record-b/edit')
  await page.getByText('기록 내용을 불러오지 못했어요.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).count(), 0)
  assert.equal(saveRequests, 0)
  await page.getByRole('button', { name: '다시 시도', exact: true }).click()
  await page.getByText('태그 record-b 1', { exact: false }).waitFor()
  assert.equal(await page.locator('[aria-labelledby="photo-label"] li').count(), 2)
  console.log('PASS 사진 메타데이터 조회 실패도 편집을 막고 재시도할 수 있음')

  failPhotoSigning = true
  await open('/records/record-c/edit')
  await page.getByRole('button', { name: '사진 1 삭제' }).waitFor()
  assert.equal(await page.getByText('불러오지 못함', { exact: true }).count(), 2)
  assert.equal(await page.locator('[aria-labelledby="photo-label"] li').count(), 2)
  console.log('PASS 사진 URL 발급 실패에도 사진 메타데이터와 순서를 보존')
  failPhotoSigning = false

  tagFailureId = 'record-detail'
  remainingTagFailures = 1
  await open('/records/record-detail')
  await page.getByText('기록을 불러오지 못했어요.', { exact: true }).waitFor()
  assert.equal(await page.getByText('메모 record-detail', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '다시 시도', exact: true }).click()
  await page.getByText('메모 record-detail', { exact: true }).waitFor()
  await page.getByText('태그 record-detail 1', { exact: false }).waitFor()
  console.log('PASS 상세 화면도 태그 조회 오류에서 빈 기록을 표시하지 않고 재시도')

  delayRecordA = true
  await open('/records/record-a/edit')
  await page.getByRole('link', { name: '기록 B로 이동' }).click()
  await page.getByLabel('일기', { exact: true }).waitFor()
  await page.getByText('태그 record-b 1', { exact: false }).waitFor()
  await page.waitForTimeout(800)
  assert.equal(await page.getByLabel('일기', { exact: true }).inputValue(), '메모 record-b')
  assert.equal(await page.getByText('태그 record-a 1', { exact: false }).count(), 0)
  assert.deepEqual(pageErrors, [])
  assert.equal(saveRequests, 0)
  console.log('PASS 기록 A의 늦은 응답이 기록 B에 반영되지 않음')
} finally {
  await browser.close()
}
