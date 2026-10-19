import { useCallback, useEffect, useRef, useState } from 'react'
import { signPhotoUrls, signThumbnailUrls } from '../lib/photo-storage'
import { useSession } from '../auth/session-context'

type Props = { path: string; url: string | null; alt: string; className?: string; thumbnail?: boolean }

/** D09: 한 로드 주기당 자동 재서명은 한 번, 이후에는 명시적 재시도만 허용한다. */
export function RecordPhoto({ path, url, alt, className, thumbnail = false }: Props) {
  const session = useSession()
  const scope = JSON.stringify([session.userId, session.couple?.id, path, url])
  const [image, setImage] = useState({ scope, url, failed: false })
  const generation = useRef(0)
  const attempted = useRef(false)
  const invalidate = useCallback(() => { generation.current++ }, [])
  useEffect(() => {
    generation.current++
    attempted.current = false
    setImage({ scope, url, failed: false })
    return invalidate
  }, [scope, url, invalidate])
  async function renew(manual = false) {
    if (attempted.current && !manual) {
      setImage({ scope, url: null, failed: true })
      return
    }
    attempted.current = true
    const current = ++generation.current
    try {
      const signed = await (thumbnail ? signThumbnailUrls : signPhotoUrls)([path])
      if (current !== generation.current) return
      const next = signed.get(path) ?? null
      setImage({ scope, url: next, failed: next === null })
    } catch {
      if (current === generation.current) setImage({ scope, url: null, failed: true })
    }
  }
  const current = image.scope === scope ? image : { scope, url, failed: false }
  if (current.url === null) return thumbnail
    ? <span className={className} role="img" aria-label="사진을 불러오지 못했어요" />
    : <button type="button" className={className} aria-label="사진 다시 불러오기" onClick={() => void renew(true)}>사진 다시 보기</button>
  return <img className={className} src={current.url} alt={alt} loading="lazy" onError={() => void renew()} />
}
