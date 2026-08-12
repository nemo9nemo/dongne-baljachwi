import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { STORAGE_PREFIX } from './app-storage'

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * `.env.local`에 Supabase 값이 채워져 있는지 여부.
 * 아직 Supabase 프로젝트가 없어서 개발 중에는 false다. 화면에 경고를 띄우는 데 쓴다.
 */
export const isSupabaseConfigured = url.length > 0 && anonKey.length > 0

/**
 * 브라우저용 Supabase 클라이언트. **anon 키만** 쓴다.
 * service_role 키는 배치 스크립트 전용이며 이 번들에 절대 들어오면 안 된다 (CLAUDE.md).
 *
 * createClient는 빈 URL을 받으면 그 자리에서 throw한다. 그러면 `.env.local`이 없는 지금
 * 앱이 렌더조차 되지 않는다. 그래서 미설정일 때는 더미 값으로 초기화해서
 * **빌드·렌더는 되고 네트워크 호출만 실패하는** 상태로 만든다.
 */
export const supabase = createClient<Database>(
  isSupabaseConfigured ? url : 'http://localhost:54321',
  isSupabaseConfigured ? anonKey : 'anon-key-not-configured',
  {
    auth: {
      // F-25: 세션은 브라우저에 유지되고 자동 갱신된다.
      // 401 → 갱신 1회 → 실패 시 로그아웃(01 §5)은 auth-js가 내부적으로 수행하고,
      // 최종 실패는 onAuthStateChange의 SIGNED_OUT으로 넘어온다. 직접 구현하지 않는다.
      persistSession: true,
      autoRefreshToken: true,
      // 이메일 확인 / 비밀번호 재설정 링크로 들어온 토큰을 클라이언트가 처리한다.
      detectSessionInUrl: true,
      // 01 §6: 확인 링크가 "메일 앱이 띄우는 기본 브라우저"에서 열려도 세션이 이어져야 한다.
      // PKCE는 code_verifier가 가입을 요청한 브라우저 저장소에만 있어 이 요구를 만족할 수 없다.
      // 그래서 implicit(토큰이 URL 프래그먼트로 전달)로 고정한다.
      flowType: 'implicit',
      // 저장소 키도 앱 접두사 아래로 넣어 로그아웃 시 일괄 삭제 대상이 되게 한다 (F-25).
      storageKey: `${STORAGE_PREFIX}auth`,
    },
  },
)

/**
 * 요청이 서버에 닿지도 못한 실패인지 판별한다 (오프라인·DNS 실패·CORS 차단·서버 무응답).
 *
 * supabase-js는 계층마다 다른 에러 타입(PostgrestError / AuthError)을 주지만, fetch가
 * 통째로 실패한 경우에는 공통적으로 브라우저의 `TypeError` 메시지를 그대로 실어 보낸다.
 * 문구가 엔진마다 다르므로 세 가지를 모두 본다:
 * Chrome `Failed to fetch` / Firefox `NetworkError when attempting to fetch resource.` /
 * Safari `Load failed`.
 *
 * 이 구분이 필요한 이유는 01 §2.4(오프라인)다. 네트워크 실패를 도메인 실패로 뭉개면
 * "비밀번호가 틀렸다" 같은 엉뚱한 안내가 나가고, 사용자는 멀쩡한 값을 계속 고쳐 치게 된다.
 */
export function isNetworkFailure(error: { message: string }): boolean {
  return !navigator.onLine || /failed to fetch|networkerror|load failed/i.test(error.message)
}
