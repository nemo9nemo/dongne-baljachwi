// D07: 운영 현황은 읽기 전용으로만 확인한다. 키·기록 본문·사용자 정보는 출력하지 않는다.
const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('서버 환경의 Supabase 설정이 필요합니다.')
const headers = { apikey: key, Authorization: `Bearer ${key}` }
const schemaResponse = await fetch(`${url}/rest/v1/`, { headers: { ...headers, Accept: 'application/openapi+json' } })
if (!schemaResponse.ok) throw new Error(`스키마 조회 실패 (${schemaResponse.status})`)
const schema = await schemaResponse.json()
if(typeof schema!=='object' || schema===null || !('paths' in schema) || typeof schema.paths!=='object' || schema.paths===null)throw new Error('스키마 응답을 확인하지 못했습니다.')
const paths = new Set(Object.keys(schema.paths))
const expected = ['get_record_edit_snapshot','save_record_v2','sync_record_photos','get_record_context','save_record_v3','query_record_cards','query_record_months']
const response = await fetch(`${url}/rest/v1/couples?select=id&status=eq.dissolved&purge_after=lt.${encodeURIComponent(new Date().toISOString())}`, { headers: { ...headers, Prefer: 'count=exact', Range:'0-0' } })
console.log(JSON.stringify({ checkedAt:new Date().toISOString(), rpc: Object.fromEntries(expected.map(name=>[name,paths.has(`/rpc/${name}`)])), expiredSharedSpaces: response.ok ? response.headers.get('content-range')?.split('/').at(-1) ?? 'unknown' : 'unknown', scheduler: '관리 API 또는 DB 연결로 별도 확인 필요' },null,2))
