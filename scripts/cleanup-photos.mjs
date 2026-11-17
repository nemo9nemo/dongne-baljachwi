import { createClient } from '@supabase/supabase-js'
// D07: 기본은 dry-run. --apply는 검증된 서버 환경의 스케줄 작업에서만 지정한다.
const url=process.env.VITE_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url || !key)throw new Error('서버 전용 Supabase 환경 설정이 필요합니다.')
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const apply=process.argv.includes('--apply')
const plan=await client.rpc('get_photo_cleanup_candidates',{p_limit:100})
if(plan.error)throw new Error(`정리 계획 조회 실패 (${plan.error.code || 'network'})`)
if(!Array.isArray(plan.data) || !plan.data.every(row=>typeof row.path==='string'))throw new Error('정리 계획 응답이 올바르지 않습니다.')
console.log(JSON.stringify({mode:apply?'apply':'dry-run',candidates:plan.data.length}))
if(!apply)process.exit(0)
const claimed=await client.rpc('claim_photo_cleanup',{p_paths:plan.data.map(row=>row.path)})
if(claimed.error || !Array.isArray(claimed.data))throw new Error('정리 대상을 확정하지 못했습니다.')
let failed=0
for(const path of claimed.data){
  const result=await client.storage.from('record-photos').remove([path])
  const done=await client.rpc('complete_photo_cleanup',{p_path:path,p_success:result.error===null})
  if(result.error || done.error)failed++
}
// 파일 삭제가 끝난 공간만 DB를 정리한다. 중간 실패는 다음 실행에서 다시 시도한다.
const spaces=await client.from('couples').select('id').eq('status','dissolved').lte('purge_after',new Date().toISOString()).limit(100)
if(spaces.error)throw new Error('만료 공간 확인 실패')
let purged=0
for(const space of spaces.data){
  const result=await client.rpc('finalize_expired_record_space',{p_id:space.id})
  if(result.error)failed++;else if(result.data===true)purged++
}
console.log(JSON.stringify({claimed:claimed.data.length,failed,purgedSpaces:purged}))
process.exitCode=failed>0?1:0
