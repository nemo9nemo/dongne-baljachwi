/**
 * react-router의 `location.state`는 타입이 없다(임의의 값). 경계에서 좁혀 쓴다.
 *
 * @param state `useLocation().state`
 * @param key 꺼낼 필드 이름
 * @returns 해당 필드가 문자열일 때만 그 값, 아니면 null
 */
export function readStateString(state: unknown, key: string): string | null {
  if (typeof state !== 'object' || state === null) return null
  const value = (state as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/**
 * 불리언 신호용. 06이 삭제 후 목록으로 복귀할 때 "캐시를 되살려도 된다"는 뜻으로 쓴다
 * (08 AC-14 / 04 AC-12 — 삭제 복귀는 `replace` 이동이라 `useNavigationType()`이 POP이
 * 아니어서 뒤로가기와 구분되지 않는다).
 *
 * @returns 해당 필드가 정확히 `true`일 때만 true
 */
export function readStateFlag(state: unknown, key: string): boolean {
  if (typeof state !== 'object' || state === null) return false
  return (state as Record<string, unknown>)[key] === true
}
