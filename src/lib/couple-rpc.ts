import type { PostgrestError } from '@supabase/supabase-js'
import { isNetworkFailure, supabase } from './supabase'
import type {
  CreateCoupleResult,
  DissolveCoupleResult,
  IssueInviteResult,
  RedeemInviteResult,
  RpcErrorEnvelope,
} from './database.types'

/**
 * 커플 연결 관련 SQL 함수 호출 (01 §4.3).
 *
 * 이 파일이 백엔드와의 **계약 경계**다. 화면 컴포넌트는 supabase.rpc를 직접 부르지 않고
 * 여기를 통해서만 부른다 — 실패의 전달 경로가 하나가 아니기 때문이다.
 *
 * 실패 봉투 `{ error_code, message, retry_after }`의 **모양은 네 함수가 모두 같지만
 * 전달 경로가 둘로 갈린다**:
 *
 *  (A) `create_couple` / `issue_invite` / `dissolve_couple`
 *      → `RAISE EXCEPTION`으로 던진다. PostgREST가 400 응답의 `message`에 봉투 JSON을 싣는다.
 *
 *  (B) `redeem_invite`
 *      → **던지지 않고 정상 반환값(jsonb)으로 돌려준다.**
 *      Postgres에 자율 트랜잭션이 없어서, 실패를 예외로 던지면 같은 트랜잭션에서 기록한
 *      `invite_attempts` 행까지 함께 롤백된다. 그러면 실패 카운터가 영원히 0이 되어
 *      F-12(1시간 10회 무차별 대입 차단)가 원리적으로 성립하지 않는다. 실패를 남기려면
 *      커밋해야 하고, 커밋한다는 건 곧 "예외가 아니라 값으로 돌려준다"는 뜻이다.
 *      (근거: `supabase/migrations/20260811120100_couple_link.sql` 상단 주석)
 *
 * 두 경로를 모두 같은 {@link RpcFailure}로 수렴시켜, 화면 쪽은 차이를 알 필요가 없게 한다.
 */

/** 01 §4.3의 실패 코드 + 클라이언트에서만 발생하는 2개(NETWORK/UNKNOWN) */
export type CoupleErrorCode =
  // create_couple
  | 'UNAUTHENTICATED'
  | 'ALREADY_IN_COUPLE'
  | 'INVALID_START_DATE'
  | 'INVALID_DISPLAY_NAME'
  // issue_invite
  | 'NOT_IN_COUPLE'
  | 'COUPLE_ALREADY_FULL'
  | 'CODE_GENERATION_FAILED'
  // redeem_invite
  | 'RATE_LIMITED'
  | 'CODE_NOT_FOUND'
  | 'CODE_EXPIRED'
  | 'CODE_USED'
  | 'CODE_REVOKED'
  | 'OWN_CODE'
  | 'COUPLE_DISSOLVED'
  // dissolve_couple
  | 'CONFIRM_MISMATCH'
  // 서버가 정의한 코드가 아니라 클라이언트가 붙이는 값
  | 'NETWORK'
  | 'UNKNOWN'

export type RpcFailure = {
  code: CoupleErrorCode
  /** RATE_LIMITED일 때만 값이 있다. 단위: 초 */
  retryAfterSec: number | null
}

export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: RpcFailure }

/**
 * 연결 해제 시 사용자가 타이핑해야 하는 확인 문구 (F-23).
 *
 * ⚠️ 01 §9에서 미결정으로 남은 항목이다. 상대 이름을 치게 하는 안(감정적으로 무거움) 대신
 * 고정 문구 안을 골랐다. **`dissolve_couple(p_confirm)`이 비교하는 문자열과 정확히 같아야
 * 하므로 백엔드와 함께 바꿔야 한다.**
 */
export const DISSOLVE_CONFIRM_PHRASE = '연결 해제'

const KNOWN_CODES: ReadonlySet<string> = new Set<CoupleErrorCode>([
  'UNAUTHENTICATED',
  'ALREADY_IN_COUPLE',
  'INVALID_START_DATE',
  'INVALID_DISPLAY_NAME',
  'NOT_IN_COUPLE',
  'COUPLE_ALREADY_FULL',
  'CODE_GENERATION_FAILED',
  'RATE_LIMITED',
  'CODE_NOT_FOUND',
  'CODE_EXPIRED',
  'CODE_USED',
  'CODE_REVOKED',
  'OWN_CODE',
  'COUPLE_DISSOLVED',
  'CONFIRM_MISMATCH',
])

/**
 * 실패 봉투를 화면이 쓸 형태로 옮긴다.
 *
 * `error_code`가 타입상 `string`인 것은 DB가 주는 값이라 컴파일 타임에 보장되지 않기 때문이다.
 * 아는 코드가 아니면 UNKNOWN으로 떨어뜨린다 — 모르는 코드로 분기하다가 조용히 아무 문구도
 * 안 나오는 상황을 만들지 않기 위해서다.
 */
function envelopeToFailure(envelope: RpcErrorEnvelope): RpcFailure {
  const retry = envelope.retry_after
  return {
    code: KNOWN_CODES.has(envelope.error_code)
      ? (envelope.error_code as CoupleErrorCode)
      : 'UNKNOWN',
    retryAfterSec: typeof retry === 'number' && Number.isFinite(retry) ? retry : null,
  }
}

/**
 * 경로 (A): 예외로 던져진 실패를 좁힌다.
 *
 * `app_raise()`가 봉투 JSON을 예외 메시지 본문에 그대로 싣고, PostgREST는 그것을 응답의
 * `message`로 내보낸다. detail/hint는 백엔드가 **의도적으로 비워 둔다** — 파싱 지점이
 * 둘이면 여기서 또 관용 파싱을 해야 하기 때문이다. 그래서 `message`만 본다.
 */
function narrowError(error: PostgrestError): RpcFailure {
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

  return envelopeToFailure({
    error_code: bag.error_code,
    message: typeof bag.message === 'string' ? bag.message : '',
    retry_after: typeof bag.retry_after === 'number' ? bag.retry_after : null,
  })
}

/**
 * 실패 코드에 대응하는 화면 문구.
 *
 * 01 §4.4: 프론트는 `error_code`로만 분기하고 문구는 프론트가 소유한다.
 * 서버가 준 `message`는 화면에 절대 그대로 노출하지 않는다(내부 정보 노출 방지).
 * RATE_LIMITED의 남은 시간은 호출부가 카운트다운으로 따로 붙인다.
 */
export function failureMessage(failure: RpcFailure): string {
  switch (failure.code) {
    case 'UNAUTHENTICATED':
      return '로그인이 풀렸어요. 다시 로그인해주세요.'
    case 'ALREADY_IN_COUPLE':
      return '이미 커플에 연결되어 있어요.'
    case 'INVALID_START_DATE':
      return '사귀기 시작한 날은 오늘까지만 고를 수 있어요.'
    case 'INVALID_DISPLAY_NAME':
      return '이름은 1~12자로 입력해주세요.'
    case 'NOT_IN_COUPLE':
      return '아직 커플에 연결되어 있지 않아요.'
    case 'COUPLE_ALREADY_FULL':
      return '이미 두 사람이 연결된 커플이에요.'
    case 'CODE_GENERATION_FAILED':
      return '코드를 만들지 못했어요. 잠시 후 다시 시도해주세요.'
    case 'RATE_LIMITED':
      return '시도 횟수를 넘겼어요.'
    case 'CODE_NOT_FOUND':
      return '코드를 찾을 수 없어요. 대소문자 없이 8자리를 다시 확인해주세요.'
    case 'CODE_EXPIRED':
      return '만료된 코드예요. 상대에게 새 코드를 요청해주세요.'
    case 'CODE_USED':
      return '이미 사용된 코드예요.'
    // 재발급으로 무효화된 코드. 사용자 입장에서는 "만료"와 같은 상황이므로 같은 안내를 준다.
    case 'CODE_REVOKED':
      return '더 이상 쓸 수 없는 코드예요. 상대에게 새 코드를 요청해주세요.'
    case 'OWN_CODE':
      return '본인이 만든 코드예요. 상대에게 전달해주세요.'
    case 'COUPLE_DISSOLVED':
      return '연결이 해제된 커플의 코드예요.'
    case 'CONFIRM_MISMATCH':
      return '확인 문구가 정확히 일치하지 않아요.'
    case 'NETWORK':
      return '네트워크 연결을 확인해주세요.'
    case 'UNKNOWN':
      return '문제가 생겼어요. 잠시 후 다시 시도해주세요.'
  }
}

/**
 * F-07 / AC-03: 커플 생성 + owner 멤버십 + 첫 초대 코드까지 단일 트랜잭션.
 * @param startedOn `YYYY-MM-DD` (로컬 기준 날짜, 오늘 이하)
 * @param displayName 1~12자
 */
export async function createCouple(
  startedOn: string,
  displayName: string,
): Promise<RpcResult<CreateCoupleResult>> {
  const { data, error } = await supabase.rpc('create_couple', {
    p_started_on: startedOn,
    p_display_name: displayName,
  })
  if (error) return { ok: false, failure: narrowError(error) }
  if (data == null) return { ok: false, failure: { code: 'UNKNOWN', retryAfterSec: null } }
  return { ok: true, data }
}

/** F-08 / AC-04: 새 코드 발급. 기존 유효 코드는 서버에서 즉시 무효화된다. */
export async function issueInvite(): Promise<RpcResult<IssueInviteResult>> {
  const { data, error } = await supabase.rpc('issue_invite', {})
  if (error) return { ok: false, failure: narrowError(error) }
  if (data == null) return { ok: false, failure: { code: 'UNKNOWN', retryAfterSec: null } }
  return { ok: true, data }
}

/**
 * F-13: 코드 검증과 합류는 이 함수 하나로만 한다.
 * 미연결 사용자는 RLS상 `couple_invites`를 SELECT할 수 없으므로 사전 조회는 불가능하다(F-14).
 *
 * **경로 (B)**: 이 함수만 실패도 200 + 정상 반환값으로 온다(파일 상단 주석 참조).
 * 그래서 `error`가 없다고 성공이 아니다 — 반드시 `error_code` 유무로 한 번 더 갈라야 한다.
 *
 * @param code 정규화된 8자 코드
 * @param displayName 1~12자
 */
export async function redeemInvite(
  code: string,
  displayName: string,
): Promise<RpcResult<RedeemInviteResult>> {
  const { data, error } = await supabase.rpc('redeem_invite', {
    p_code: code,
    p_display_name: displayName,
  })
  // 여기 걸리는 건 봉투가 아니라 네트워크 실패·권한 오류 등 "함수 바깥"의 문제다.
  if (error) return { ok: false, failure: narrowError(error) }
  if (data == null) return { ok: false, failure: { code: 'UNKNOWN', retryAfterSec: null } }
  if ('error_code' in data) return { ok: false, failure: envelopeToFailure(data) }
  return { ok: true, data }
}

/**
 * F-19~F-21: 한쪽이 단독으로 실행하는 연결 해제. 되돌릴 수 없다(F-22).
 * @param confirm 사용자가 타이핑한 확인 문구. {@link DISSOLVE_CONFIRM_PHRASE}와 같아야 한다.
 */
export async function dissolveCouple(
  confirm: string,
): Promise<RpcResult<DissolveCoupleResult>> {
  const { data, error } = await supabase.rpc('dissolve_couple', { p_confirm: confirm })
  if (error) return { ok: false, failure: narrowError(error) }
  if (data == null) return { ok: false, failure: { code: 'UNKNOWN', retryAfterSec: null } }
  return { ok: true, data }
}
