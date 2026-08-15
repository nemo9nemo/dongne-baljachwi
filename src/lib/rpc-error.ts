import type { PostgrestError } from '@supabase/supabase-js'
import { isNetworkFailure } from './supabase'
import type { RpcErrorEnvelope } from './database.types'

/**
 * SQL 함수 실패 봉투 `{ error_code, message, retry_after }` 파싱 (01 §4.4).
 *
 * 원래 `couple-rpc.ts` 안에 있던 것을 두 번째 사용처(`record-rpc.ts`)가 생겨서 꺼냈다.
 * 봉투 모양은 백엔드 공통 헬퍼 `app_raise()`가 정하므로 도메인마다 다시 구현하면
 * 한쪽만 고쳐지는 사고가 난다.
 *
 * 코드 집합은 도메인마다 다르므로 호출부가 자기 집합을 넘긴다. 아는 코드가 아니면
 * UNKNOWN으로 떨어뜨린다 — 모르는 코드로 분기하다가 조용히 아무 문구도 안 나오는
 * 상황을 만들지 않기 위해서다.
 */

export type ParsedFailure<Code extends string> = {
  code: Code | 'NETWORK' | 'UNKNOWN'
  /** RATE_LIMITED 처럼 서버가 대기 시간을 준 경우에만 값이 있다. 단위: 초 */
  retryAfterSec: number | null
}

/** 정상 반환값으로 온 봉투(`redeem_invite` 경로)를 화면이 쓸 형태로 옮긴다. */
export function envelopeToFailure<Code extends string>(
  envelope: RpcErrorEnvelope,
  knownCodes: ReadonlySet<Code>,
): ParsedFailure<Code> {
  const retry = envelope.retry_after
  // Set<Code>.has()는 Code만 받으므로 DB가 준 문자열을 그대로 넣을 수 없다.
  // 넓힌 뒤 확인하고, 통과한 값만 Code로 되돌린다.
  const known = (knownCodes as ReadonlySet<string>).has(envelope.error_code)
  return {
    code: known ? (envelope.error_code as Code) : 'UNKNOWN',
    retryAfterSec: typeof retry === 'number' && Number.isFinite(retry) ? retry : null,
  }
}

/**
 * 예외로 던져진 실패를 좁힌다.
 *
 * `app_raise()`가 봉투 JSON을 예외 메시지 본문에 그대로 싣고, PostgREST는 그것을 응답의
 * `message`로 내보낸다. detail/hint는 백엔드가 **의도적으로 비워 둔다** — 파싱 지점이
 * 둘이면 여기서 또 관용 파싱을 해야 하기 때문이다. 그래서 `message`만 본다.
 */
export function narrowRpcError<Code extends string>(
  error: PostgrestError,
  knownCodes: ReadonlySet<Code>,
): ParsedFailure<Code> {
  // fetch 자체가 실패하면 postgrest-js가 TypeError 메시지를 그대로 담아 준다.
  // 이 경우 SQL 함수는 실행조차 되지 않았으므로 재시도 가능한 네트워크 오류로 본다.
  if (isNetworkFailure(error)) {
    return { code: 'NETWORK', retryAfterSec: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(error.message)
  } catch {
    // 봉투가 아닌 원시 DB 에러(제약 위반 등). 화면에 보여줄 수 있는 문구가 없다.
    return { code: 'UNKNOWN', retryAfterSec: null }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { code: 'UNKNOWN', retryAfterSec: null }
  }

  const bag = parsed as Record<string, unknown>
  if (typeof bag.error_code !== 'string') {
    return { code: 'UNKNOWN', retryAfterSec: null }
  }

  return envelopeToFailure(
    {
      error_code: bag.error_code,
      message: typeof bag.message === 'string' ? bag.message : '',
      retry_after: typeof bag.retry_after === 'number' ? bag.retry_after : null,
    },
    knownCodes,
  )
}
