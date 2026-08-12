/** F-09: Crockford Base32 대문자. `I L O U`를 뺀 32자. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** F-08: 초대 코드 길이 */
export const INVITE_CODE_LENGTH = 8

/**
 * 사용자가 입력한 초대 코드를 서버가 비교하는 형태로 정규화한다 (F-10).
 *
 * - 대소문자 무시
 * - 공백·하이픈 등 문자셋 밖 문자 무시
 * - 손으로 옮겨 적을 때의 혼동 교정: `O → 0`, `I·L → 1`
 *
 * `U`는 문자셋에서 빠져 있지만 교정 규칙이 스펙에 없다. 임의로 다른 글자에 매핑하면
 * 엉뚱한 코드를 만들어내므로, 그냥 버려서 길이 8을 못 채우게 둔다(= 제출 불가).
 *
 * 서버(`redeem_invite`)도 같은 정규화를 다시 수행한다. 여기 정규화는 입력 편의용이지
 * 신뢰 경계가 아니다 (01 §4.3).
 *
 * @returns 문자셋에 속하는 문자만 남긴 최대 {@link INVITE_CODE_LENGTH}자 대문자 문자열
 */
export function normalizeInviteCode(raw: string): string {
  let out = ''
  for (const ch of raw.toUpperCase()) {
    const corrected = ch === 'O' ? '0' : ch === 'I' || ch === 'L' ? '1' : ch
    if (ALPHABET.includes(corrected)) out += corrected
    if (out.length === INVITE_CODE_LENGTH) break
  }
  return out
}

/**
 * 코드를 사람이 읽기 좋게 4자씩 끊어 보여준다 (`A3F9-K2M7`).
 * 표시 전용이다 — 서버로 보낼 때는 정규화된 원본을 쓴다.
 */
export function formatInviteCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}
