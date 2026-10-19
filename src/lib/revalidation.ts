import { useEffect } from 'react'

// D08: 편집 폼에는 붙이지 않는다. 복귀 시 조회 화면만 최신 서버 상태로 맞춘다.
export function useRevalidation(refresh: () => void): void {
  useEffect(() => {
    let last = 0
    const update = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - last < 1000) return
      last = Date.now()
      refresh()
    }
    document.addEventListener('visibilitychange', update)
    window.addEventListener('online', update)
    window.addEventListener('focus', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('online', update)
      window.removeEventListener('focus', update)
    }
  }, [refresh])
}
