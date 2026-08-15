/**
 * 태그 정규화 — 00 §4.7의 **프론트/백엔드 공통 규칙**을 클라이언트 쪽에 옮긴 것이다.
 *
 * 최종 책임은 DB 트리거(`record_tags_normalize`)에 있고 여기는 화면 표시용 선계산이다.
 * 그래도 같은 규칙을 두는 이유: 칩에 보이는 글자와 저장되는 글자가 다르면 사용자는
 * "내가 쓴 게 안 들어갔다"고 읽는다. 중복 판정(F-27)도 저장 전에 해야 한다.
 *
 * ⚠️ 규칙을 바꾸면 `supabase/migrations/20260811120300_records.sql`의
 * `record_tags_normalize()`를 **같이** 고쳐야 한다. 한쪽만 바뀌면 "Cafe"와 "cafe"가
 * 서로 다른 필터로 갈라지는데, 이건 화면 오류로 드러나지 않는 종류의 사고다.
 */

/** 00 §4.7 규칙 6 */
export const MAX_TAGS = 10
/** 00 §4.7 규칙 5. `tag` 기준 문자 수 */
export const MAX_TAG_LENGTH = 20

/**
 * 표시·저장용 표기(`tag`)를 만든다. 규칙 1~3.
 *
 * @returns 정규화 결과. 빈 문자열이면 태그로 쓸 수 없는 입력이다.
 */
export function normalizeTag(raw: string): string {
  const nfc = raw.normalize('NFC')
  // 규칙 2: 내부 연속 공백 1칸 축약 + 앞뒤 공백 제거
  const collapsed = nfc.replace(/\s+/g, ' ').trim()
  // 규칙 3: 선행 # 제거. "# 카페"처럼 # 뒤에 공백이 남을 수 있어 한 번 더 trim한다
  // (DB 쪽 btrim(regexp_replace(..., '^#+', ''))와 같은 순서다).
  return collapsed.replace(/^#+/, '').trim()
}

/** 비교·집계 키(`tag_norm`). 규칙 4 — 소문자 변환은 여기에만 적용한다 */
export function toTagNorm(tag: string): string {
  return tag.toLowerCase()
}

/**
 * 규칙 5의 길이 검증.
 *
 * `String.length`가 아니라 코드포인트 수를 세는 이유: Postgres `char_length`는 코드포인트
 * 기준이라 이모지(서러게이트 페어)에서 두 값이 갈린다. 화면에서 통과한 태그가 DB CHECK에
 * 걸려 떨어지는 상황을 막는다.
 */
export function tagLength(tag: string): number {
  return [...tag].length
}
