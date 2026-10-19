import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL || 'msedge'})
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5176'
const user='00000000-0000-0000-0000-0000000000a1'
const personal='00000000-0000-0000-0000-0000000000aa'
const shared='00000000-0000-0000-0000-0000000000bb'
const errors=[]
try {
  const page=await browser.newPage({viewport:{width:390,height:844}})
  page.on('pageerror',e=>errors.push(e.message))
  let failTags=true, delayA=false, photoSigns=0, photoGets=0, refreshes=0, savedBody=null
  const requests=[]
  await page.route('https://**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),table=url.pathname.split('/').at(-1)
    let data=[]
    if(table==='app_settings')data={value:{version:1}}
    if(table==='station_master_public')data=[{id:'station-a',code:'TEST',name:'테스트역',name_short:'테스트',is_active:true,in_mvp_scope:true,is_transfer:false,lat:37,lng:127,region_code:'11'}]
    if(table==='lines')data=[]
    if(table==='get_record_context')data={personal_id:personal,shared_id:shared}
    if(table==='couple_members')data=[{couple_id:shared,user_id:user,role:'owner'}]
    if(table==='couples')data={id:shared,started_on:'2026-01-01',status:'active'}
    if(table==='profiles')data=[{id:user,display_name:'나'}]
    if(table==='records') {
      const id=url.searchParams.get('id')?.replace('eq.','') || 'detail-a'
      data={id,station_id:'station-a',visited_on:'2026-10-01',mood:null,weather:null,note:id==='detail-a'?'A의 본문':'B의 본문',author_id:user,last_edited_by:null,place_name:null}
      if(savedBody && id===savedBody.p_record_id)data={...data,visited_on:savedBody.p_visited_on,note:savedBody.p_note,place_name:savedBody.p_place_name}
      if(id==='detail-a' && delayA)await new Promise(r=>setTimeout(r,700))
    }
    if(table==='record_tags' && failTags) {await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'injected'})});return}
    if(table==='record_photos')data=savedBody?[]:[{id:'photo-a',storage_path:'space/record/photo.jpg',sort_order:0,width:20,height:20}]
    if(table==='save_record_v3'){savedBody=request.postDataJSON();data={record_id:savedBody.p_record_id,created:true,revision:1,updated_at:new Date().toISOString()}}
    if(url.pathname.includes('/storage/v1/object/sign/')) {photoSigns++;data=[{path:'space/record/photo.jpg',signedURL:'/object/sign/record-photos/space/record/photo.jpg?token=fake'}]}
    if(request.resourceType()==='image') {photoGets++;await route.fulfill({status:404,body:''});return}
    if(table==='query_record_cards') {
      const args=request.postDataJSON();requests.push({args,scope:request.headers()['x-record-scope']});refreshes++
      const scope=request.headers()['x-record-scope']
      data=[{id:'list-a',station_id:'station-a',visited_on:'2026-10-01',mood:null,weather:null,note_excerpt:scope===shared?'공동 공간 기록':'개인 공간 기록',author_id:user,place_name:args.p_query?'검색 장소':null}]
    }
    if(table==='query_record_months')data=[{month:'2026-09',count:3}]
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
  })
  await page.goto(`${base}/tests/browser/index.html?real&entry=${encodeURIComponent('/records/detail-a')}`)
  await page.getByText('기록을 불러오지 못했어요.').waitFor()
  assert.equal(await page.getByRole('button',{name:'기록 메뉴'}).count(),0)
  failTags=false
  await page.getByRole('button',{name:'다시 시도',exact:true}).click()
  await page.getByText('A의 본문',{exact:true}).waitFor()
  await page.waitForTimeout(800)
  assert.ok(photoSigns<=3,`서명 무한 재시도: ${photoSigns}`)
  assert.ok(photoGets<=3,`이미지 무한 재시도: ${photoGets}`)
  console.log('PASS 실제 상세 화면의 메타데이터 실패·재시도·사진 오류 재시도 상한')
  delayA=true
  await page.goto(`${base}/tests/browser/index.html?real&entry=${encodeURIComponent('/records/detail-a')}`)
  await page.getByRole('link',{name:'다른 기록 상세'}).click()
  await page.getByText('B의 본문',{exact:true}).waitFor()
  await page.waitForTimeout(850)
  assert.equal(await page.getByText('A의 본문',{exact:true}).count(),0)
  console.log('PASS 실제 상세 A→B 전환에서 지연 응답 폐기')
  await page.addInitScript(({user})=>{
    const expires=Math.floor(Date.now()/1000)+3600
    const encode=value=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
    const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:user,exp:expires,role:'authenticated'})+'.test-signature'
    localStorage.setItem('dbj.auth',JSON.stringify({access_token:token,refresh_token:'test',token_type:'bearer',expires_in:3600,expires_at:expires,user:{id:user,email:'test@example.invalid',aud:'authenticated'}}))
  },{user})
  await page.goto(`${base}/tests/browser/index.html?live&entry=/timeline`)
  await page.getByText('개인 공간 기록',{exact:true}).waitFor()
  assert.equal(await page.getByText('상대 초대 대기 중',{exact:true}).count(),0)
  assert.equal(requests.at(-1).scope,personal)
  await page.getByLabel('기록 범위').selectOption(shared)
  await page.getByText('공동 공간 기록',{exact:true}).waitFor()
  assert.equal(await page.getByText('개인 공간 기록',{exact:true}).count(),0)
  await page.getByLabel('기록 범위').selectOption(personal)
  await page.getByText('개인 공간 기록',{exact:true}).waitFor()
  console.log('PASS 실제 세션 공급자의 개인 기본 진입·개인/공동 공간 전환·범위 헤더·캐시 분리')
  await page.getByRole('textbox',{name:'기록 검색'}).fill('카페')
  await page.getByLabel('시작일',{exact:true}).fill('2026-01-01')
  await page.getByRole('button',{name:'검색',exact:true}).click()
  await page.getByText('검색 장소',{exact:true}).waitFor()
  assert.equal(requests.at(-1).args.p_query,'카페')
  assert.equal(requests.at(-1).args.p_start,'2026-01-01')
  await page.getByRole('button',{name:'기간 이동',exact:true}).click()
  await page.getByRole('button',{name:'2026-09 · 3건',exact:true}).click()
  await page.waitForTimeout(200)
  assert.equal(requests.at(-1).args.p_jump,'2026-09-30')
  assert.equal(requests.at(-1).args.p_query,'카페')
  console.log('PASS 검색·기간 조건과 연월 점프 상한·URL 복귀 맥락')
  const before=refreshes
  await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(400)
  assert.ok(refreshes>before)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.deepEqual(errors,[])
  console.log('PASS 재연결 재조회·모바일 가로 넘침·런타임 오류 없음')
  await page.goto(`${base}/tests/browser/index.html?real&entry=${encodeURIComponent('/records/new?stationId=station-a&date=2026-09-12')}`)
  await page.getByLabel('일기',{exact:true}).fill('새 기록의 일기')
  await page.getByLabel('장소 이름 선택',{exact:true}).fill('산책 장소')
  await page.getByRole('button',{name:'저장',exact:true}).click()
  await page.getByRole('button',{name:'이어서 기록 추가',exact:true}).click()
  await page.getByLabel('일기',{exact:true}).waitFor()
  assert.equal(await page.getByLabel(/^날짜/).inputValue(),'2026-09-12')
  assert.equal(await page.getByLabel('일기',{exact:true}).inputValue(),'')
  assert.equal(await page.getByLabel('장소 이름 선택',{exact:true}).inputValue(),'')
  assert.equal(await page.getByLabel('역 이름 검색',{exact:true}).inputValue(),'')
  console.log('PASS 실제 작성→상세→연속 작성에서 날짜만 이어받고 본문·장소 초기화')
} finally {await browser.close()}
