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
