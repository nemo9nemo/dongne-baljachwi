import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({headless:true, channel:process.env.TEST_BROWSER_CHANNEL || 'msedge'})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor:1 })
  const errors=[]
  page.on('pageerror', e=>errors.push(e.message))
  await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:5176') + '/design/mockup.html')
  await page.waitForTimeout(1300)
  await page.screenshot({ path:'docs/design/references/record-map-mockup-desktop-2026-10-19.png', fullPage:true })
  await page.getByLabel('역 이름 검색').fill('성수')
  await page.getByRole('button', {name:'성수 지도에서 보기 ↗',exact:true}).click()
  await page.getByRole('button',{name:'이 역에 기록 남기기 ＋'}).click()
  await page.getByRole('dialog').waitFor()
  await page.getByLabel('닫기',{exact:true}).click()
  await page.setViewportSize({width:390,height:844})
  await page.waitForTimeout(500)
  await page.screenshot({path:'docs/design/references/record-map-mockup-mobile-2026-10-19.png',fullPage:true})
  console.log(JSON.stringify({errors,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}))
} finally {await browser.close()}
