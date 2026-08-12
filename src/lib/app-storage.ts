/**
 * 이 앱이 브라우저 저장소에 쓰는 모든 키의 접두사.
 *
 * F-25 / AC-15: 로그아웃하면 이전 커플의 캐시가 하나도 남으면 안 된다(공용 PC).
 * 키를 전부 이 접두사로 강제해 두면 "지울 목록"을 따로 관리할 필요가 없다.
 * Supabase auth 토큰 키도 이 접두사를 쓰도록 `supabase.ts`에서 storageKey를 지정한다.
 */
export const STORAGE_PREFIX = 'dbj.'

/** F-25: 접두사가 붙은 로컬/세션 저장소 항목을 전부 삭제한다. */
export function clearAppStorage(): void {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key)
    }
    // 순회하면서 지우면 인덱스가 앞으로 밀려 일부 키를 건너뛴다. 먼저 모으고 나서 지운다.
    for (const key of keys) storage.removeItem(key)
  }
}
