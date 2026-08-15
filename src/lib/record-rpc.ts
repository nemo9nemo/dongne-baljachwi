import { supabase } from './supabase'
import { narrowRpcError } from './rpc-error'
import type { UpsertRecordArgs, UpsertRecordResult } from './database.types'

/**
 * 기록 본문 저장 (05 §4.2).
 *
 * `couple-rpc.ts`와 같은 계약 경계다 — 화면은 `supabase.rpc`를 직접 부르지 않는다.
 * 이 함수는 실패를 **예외로 던지는** 경로(A)만 쓴다. `redeem_invite`처럼 실패를 값으로
 * 돌려줄 이유(무차별 대입 카운터 커밋)가 여기엔 없다.
 *
 * 본문과 태그를 왜 한 함수로 묶는지는 스펙 §4.2에 있다: 수정 시 "기존 태그 전체 삭제 후
 * 재삽입"이 클라이언트에서 2회 요청으로 쪼개지면 중간 실패에서 태그가 사라진 기록이 남는다.
 */

/** 05 §4.2의 실패 코드 + 클라이언트에서만 붙는 2개 */
export type RecordErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_IN_COUPLE'
  | 'RECORD_NOT_FOUND'
  | 'STATION_NOT_FOUND'
  | 'INVALID_DATE'
  | 'INVALID_ENUM'
  | 'NOTE_TOO_LONG'
  | 'INVALID_TAGS'
  | 'NETWORK'
  | 'UNKNOWN'

export type RecordFailure = {
  code: RecordErrorCode
  retryAfterSec: number | null
}

export type UpsertRecordOutcome =
  | { ok: true; data: UpsertRecordResult }
  | { ok: false; failure: RecordFailure }

const KNOWN_CODES: ReadonlySet<RecordErrorCode> = new Set<RecordErrorCode>([
  'UNAUTHENTICATED',
  'NOT_IN_COUPLE',
  'RECORD_NOT_FOUND',
  'STATION_NOT_FOUND',
  'INVALID_DATE',
  'INVALID_ENUM',
  'NOTE_TOO_LONG',
  'INVALID_TAGS',
])

/**
 * 실패 코드 → 화면 문구. 서버가 준 `message`는 절대 그대로 노출하지 않는다 (01 §4.4 규칙).
 *
 * 대부분은 클라이언트가 먼저 막는 값이라 여기까지 오면 "화면과 서버 검증이 어긋난 상태"다.
 * 그래도 문구를 두는 이유: 검증을 신뢰하지 않는 게 §4.2의 전제이고, 문구가 없으면
 * 사용자에게 아무 일도 일어나지 않은 것처럼 보인다.
 */
export function recordFailureMessage(failure: RecordFailure): string {
  switch (failure.code) {
    case 'UNAUTHENTICATED':
      return '로그인이 풀렸어요. 다시 로그인해주세요.'
    case 'NOT_IN_COUPLE':
      return '커플에 연결된 상태에서만 기록할 수 있어요.'
    // 남의 기록인지 없는 기록인지 서버가 구분하지 않는다 (§4.2). 화면 문구도 구분하지 않는다.
    case 'RECORD_NOT_FOUND':
      return '이 기록을 찾을 수 없어요. 삭제되었을 수 있어요.'
    case 'STATION_NOT_FOUND':
      return '역 정보가 올바르지 않아요. 역을 다시 선택해주세요.'
    case 'INVALID_DATE':
      return '방문 날짜는 오늘까지만 고를 수 있어요.'
    case 'INVALID_ENUM':
      return '감정·날씨 값이 올바르지 않아요.'
    case 'NOTE_TOO_LONG':
      return '일기는 2,000자까지 쓸 수 있어요.'
    case 'INVALID_TAGS':
      return '태그는 1~20자로 최대 10개까지 넣을 수 있어요.'
    case 'NETWORK':
      return '네트워크 연결을 확인해주세요.'
    case 'UNKNOWN':
      return '저장하지 못했어요. 잠시 후 다시 시도해주세요.'
  }
}

/**
 * F-34: 본문 → 태그를 RPC 1회로 저장한다. 사진은 이 호출이 성공한 **뒤에** 올린다(F-16).
 *
 * @param args 05 §4.2 계약 그대로. 태그는 정규화 전 원문을 보내고 서버가 다시 정규화한다.
 */
export async function upsertRecord(args: UpsertRecordArgs): Promise<UpsertRecordOutcome> {
  const { data, error } = await supabase.rpc('upsert_record', args)
  if (error) return { ok: false, failure: narrowRpcError(error, KNOWN_CODES) }
  if (data == null) return { ok: false, failure: { code: 'UNKNOWN', retryAfterSec: null } }
  return { ok: true, data }
}
