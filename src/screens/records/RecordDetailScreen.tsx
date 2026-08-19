import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useSession } from '../../auth/session-context'
import { supabase } from '../../lib/supabase'
import { loadStationLines, loadStationMaster } from '../../lib/station-master'
import type { StationMaster } from '../../lib/station-master'
import { MOODS, WEATHERS } from '../../lib/mood-weather'
import { formatVisitedOn } from '../../lib/format-date'
import type { Mood, Weather } from '../../lib/database.types'
import { ConfirmDialog } from './ConfirmDialog'
import { PhotoViewer } from './PhotoViewer'
import type { ViewerPhoto } from './PhotoViewer'
import { RecordImageDialog } from './RecordImageDialog'
import type { CardInput } from './record-image-render'
import { removePhotoObjects, signPhotoUrls } from './photo-pipeline'
import styles from './record-detail.module.css'
import ui from '../../styles/ui.module.css'

/**
 * 기록 상세 (`docs/specs/06-record-detail.md`).
 *
 * 목록 카드에서 잘렸던 것(일기 2줄, 사진 1장)을 전부 펼쳐 보여주는 화면이자, 기록에 대한
 * 모든 파괴적 동작(수정·삭제)의 유일한 관문이다 (§1).
 *
 * 이번 라운드에 없는 것:
 * - 목록에서 진입할 때 카드 값으로 먼저 그리는 최적화(§6 첫 픽셀) — 04(역 상세)/08(타임라인)이
 *   아직 자리표시자라 그 카드 자체가 없다.
 * - 삭제 후 "이전 화면"이 아직 없어 `/timeline`으로 고정 이동한다(F-17 잠정 대응).
 */

type DetailPhoto = { id: string; storagePath: string; width: number; height: number; url: string | null }

type RecordDetail = {
  id: string
  stationId: string
  visitedOn: string
  mood: Mood | null
  weather: Weather | null
  note: string | null
  tags: string[]
  photos: DetailPhoto[]
  authorId: string
  lastEditedBy: string | null
}

type LoadState = 'loading' | 'ready' | 'not-found' | 'failed'

export function RecordDetailScreen() {
  const { recordId } = useParams()
  const navigate = useNavigate()
  const session = useSession()

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [data, setData] = useState<RecordDetail | null>(null)
  const [master, setMaster] = useState<StationMaster | null>(null)
  const [lineLinks, setLineLinks] = useState<{ station_id: string; line_id: string }[]>([])
  const [online, setOnline] = useState(() => navigator.onLine)

  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [deleteState, setDeleteState] = useState<'idle' | 'confirming' | 'deleting'>('idle')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const menuWrapRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    if (recordId === undefined) return
    setLoadState('loading')

    const [masterResult, recordRes] = await Promise.all([
      loadStationMaster().catch(() => null),
      supabase
        .from('records')
        .select('id, station_id, visited_on, mood, weather, note, author_id, last_edited_by')
        .eq('id', recordId)
        .maybeSingle(),
    ])

    if (recordRes.error !== null) {
      setLoadState('failed')
      return
    }
    if (recordRes.data === null) {
      // RLS 특성상 "없는 기록"과 "남의 기록"을 구분할 수 없다 (§2.3) — 문구도 구분하지 않는다.
      setLoadState('not-found')
      return
    }

    if (masterResult !== null) {
      setMaster(masterResult)
      void loadStationLines(masterResult.version).then(setLineLinks, () => setLineLinks([]))
    }

    const row = recordRes.data
    const [tagRes, photoRes] = await Promise.all([
      supabase.from('record_tags').select('tag').eq('record_id', recordId),
      supabase
        .from('record_photos')
        .select('id, storage_path, sort_order, width, height')
        .eq('record_id', recordId)
        .order('sort_order'),
    ])

    const photoRows = photoRes.data ?? []
    const signed = await signPhotoUrls(photoRows.map((photo) => photo.storage_path))

    setData({
      id: row.id,
      stationId: row.station_id,
      visitedOn: row.visited_on,
      mood: row.mood,
      weather: row.weather,
      note: row.note,
      tags: (tagRes.data ?? []).map((tag) => tag.tag),
      photos: photoRows.map((photo) => ({
        id: photo.id,
        storagePath: photo.storage_path,
        width: photo.width,
        height: photo.height,
        url: signed.get(photo.storage_path) ?? null,
      })),
      authorId: row.author_id,
      lastEditedBy: row.last_edited_by,
    })
    setLoadState('ready')
  }, [recordId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // 메뉴 바깥 클릭·Esc로 닫는다 (§6: 키보드로 열고 닫을 수 있어야 한다).
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (menuWrapRef.current !== null && !menuWrapRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const station = useMemo(() => {
    if (master === null || data === null) return null
    return master.stations.find((item) => item.id === data.stationId) ?? null
  }, [master, data])

  /** F-09: 동명이역 구분용 배지. StationPicker와 같은 조인 로직 */
  const badges = useMemo(() => {
    if (master === null || data === null) return []
    const lineById = new Map(master.lines.map((line) => [line.id, line]))
    const result: { code: string; name: string; colorToken: string }[] = []
    for (const link of lineLinks) {
      if (link.station_id !== data.stationId) continue
      const line = lineById.get(link.line_id)
      if (line === undefined || !line.is_active) continue
      if (!result.some((item) => item.name === line.name)) {
        result.push({ code: line.code, name: line.name, colorToken: line.color_token })
      }
    }
    return result
  }, [master, lineLinks, data])

  /**
   * 10 §4.1 카드 렌더 입력. `RecordImageDialog`는 이 객체의 참조가 바뀌면 사진을 다시 내려받고
   * 카드를 다시 그린다 — 습관적 메모가 아니라 참조 안정성이 실제로 필요한 자리다.
   */
  const cardInput = useMemo<CardInput | null>(() => {
    if (data === null) return null
    return {
      stationName: station?.name ?? '역 정보 없음',
      visitedOn: data.visitedOn,
      mood: data.mood,
      weather: data.weather,
      note: data.note,
      tags: data.tags,
      photos: data.photos.map((photo) => ({ id: photo.id, url: photo.url })),
    }
  }, [data, station])

  async function resignPhoto(photoId: string, storagePath: string) {
    const signed = await signPhotoUrls([storagePath])
    const url = signed.get(storagePath) ?? null
    setData((prev) =>
      prev === null
        ? prev
        : { ...prev, photos: prev.photos.map((p) => (p.id === photoId ? { ...p, url } : p)) },
    )
  }

  async function handleDelete() {
    if (data === null) return
    setDeleteState('deleting')
    setDeleteError(null)

    const photoPaths = data.photos.map((photo) => photo.storagePath)
    // affected 행 수를 확인해야 한다 — 0행은 성공이 아니다 (§4.3 "DELETE가 0행에 영향을
    // 줬을 때를 성공으로 처리하면 안 된다").
    const res = await supabase.from('records').delete().eq('id', data.id).select('id')

    if (res.error !== null) {
      setDeleteState('confirming')
      setDeleteError('삭제하지 못했어요. 다시 시도해주세요.')
      return
    }

    if ((res.data ?? []).length === 0) {
      navigate('/timeline', { replace: true, state: { toast: '이미 삭제된 기록이에요' } })
      return
    }

    // F-16: Storage 삭제 실패는 사용자에게 노출하지 않는다. 고아 객체는 배치가 정리한다.
    void removePhotoObjects(photoPaths)
    navigate('/timeline', { replace: true, state: { toast: '기록을 삭제했어요' } })
  }

  if (loadState === 'loading') {
    return (
      <div className={styles.screen}>
        <div className={styles.skeleton} aria-hidden="true" />
        <p className="srOnly" role="status">
          불러오는 중
        </p>
      </div>
    )
  }

  if (loadState === 'failed') {
    return (
      <div className={ui.centerBox}>
        <p>기록을 불러오지 못했어요.</p>
        <button
          type="button"
          className={`${ui.button} ${ui.buttonPrimary}`}
          onClick={() => void load()}
        >
          다시 시도
        </button>
      </div>
    )
  }

  if (loadState === 'not-found' || data === null) {
    return (
      <div className={ui.centerBox}>
        {/* §2.3: "권한 없음"이라고 말하지 않는다 — 존재 여부가 새어 나간다 */}
        <p>기록을 찾을 수 없어요.</p>
        <Link to="/timeline" className={`${ui.button} ${ui.buttonPrimary}`}>
          타임라인으로
        </Link>
      </div>
    )
  }

  const { dateLabel, weekday } = formatVisitedOn(data.visitedOn)
  const moodMeta = data.mood === null ? null : (MOODS.find((item) => item.slug === data.mood) ?? null)
  const weatherMeta =
    data.weather === null ? null : (WEATHERS.find((item) => item.slug === data.weather) ?? null)
  const authorName =
    session.members.find((member) => member.userId === data.authorId)?.displayName ?? '알 수 없음'
  const editorName =
    data.lastEditedBy === null || data.lastEditedBy === data.authorId
      ? null
      : (session.members.find((member) => member.userId === data.lastEditedBy)?.displayName ?? '알 수 없음')

  const viewerPhotos: ViewerPhoto[] = data.photos.map((photo, index) => ({
    id: photo.id,
    url: photo.url,
    // §6: 사용자가 alt를 입력하지 않으므로 최소한의 맥락을 시스템이 만든다.
    alt: `${dateLabel} ${station?.name ?? ''}에서 찍은 사진 ${index + 1}/${data.photos.length}`,
  }))

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div>
          {station === null ? (
            <span className={styles.stationName}>역 정보 없음</span>
          ) : (
            <Link to={`/stations/${station.id}`} className={styles.stationLink}>
              {station.name}
            </Link>
          )}
          {badges.length > 0 && (
            <span className={styles.badges}>
              {badges.map((badge) => (
                <span key={badge.code} className={styles.badge}>
                  <span
                    className={styles.badgeDot}
                    style={{ background: `var(--${badge.colorToken}, var(--line-default))` }}
                    aria-hidden="true"
                  />
                  {badge.name}
                </span>
              ))}
            </span>
          )}
          <p className={styles.date}>
            {dateLabel} ({weekday})
          </p>
        </div>

        <div className={styles.menuWrap} ref={menuWrapRef}>
          <button
            ref={menuButtonRef}
            type="button"
            className={ui.button}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={!online}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false)
                  navigate(`/records/${data.id}/edit`)
                }}
              >
                수정
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false)
                  // 시트가 포커스를 복원할 지점을 미리 만들어 둔다 (AC-14). 지금 눌린 메뉴
                  // 항목은 곧 언마운트되므로, 그대로 두면 시트가 body를 "이전 포커스"로 잡는다.
                  menuButtonRef.current?.focus()
                  setImageDialogOpen(true)
                }}
              >
                이미지로 저장
              </button>
              <button
                type="button"
                role="menuitem"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  setMenuOpen(false)
                  setDeleteState('confirming')
                }}
              >
                삭제
              </button>
            </div>
          )}
        </div>
      </header>

      {!online && <p className={ui.hint}>오프라인 — 사진과 수정·삭제는 연결 후 이용할 수 있어요.</p>}

      {(moodMeta !== null || weatherMeta !== null) && (
        <div className={styles.metaRow}>
          {moodMeta !== null && (
            <span className={styles.metaChip}>
              <span aria-hidden="true">{moodMeta.emoji}</span> {moodMeta.label}
            </span>
          )}
          {weatherMeta !== null && (
            <span className={styles.metaChip}>
              <span aria-hidden="true">{weatherMeta.emoji}</span> {weatherMeta.label}
            </span>
          )}
        </div>
      )}

      {data.photos.length > 0 && (
        <ul className={styles.photoGrid}>
          {data.photos.map((photo, index) => (
            <li
              key={photo.id}
              className={styles.photoItem}
              style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
            >
              {photo.url === null ? (
                <button
                  type="button"
                  className={styles.photoFallback}
                  onClick={() => void resignPhoto(photo.id, photo.storagePath)}
                >
                  불러오지 못함 · 다시 시도
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.photoButton}
                  onClick={() => setViewerIndex(index)}
                >
                  <img
                    className={styles.photoThumb}
                    src={photo.url}
                    alt={viewerPhotos[index]?.alt ?? ''}
                    onError={() => void resignPhoto(photo.id, photo.storagePath)}
                  />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.note !== null && data.note !== '' && (
        // F-06: 줄바꿈만 보존하고 나머지는 평문 취급한다. React가 텍스트를 이스케이프하므로
        // <script> 같은 입력도 문자 그대로 렌더된다(AC-03) — dangerouslySetInnerHTML을 쓰지 않는다.
        <p className={styles.note}>{data.note}</p>
      )}

      {data.tags.length > 0 && (
        <ul className={styles.tagList}>
          {data.tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                className={styles.tagChip}
                onClick={() => navigate(`/timeline?tag=${encodeURIComponent(tag)}`)}
              >
                #{tag}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.byline}>
        {authorName}이(가) 남긴 기록
        {editorName !== null && ` · ${editorName}이(가) 수정함`}
      </p>

      {viewerIndex !== null && (
        <PhotoViewer photos={viewerPhotos} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}

      {imageDialogOpen && cardInput !== null && (
        <RecordImageDialog input={cardInput} onClose={() => setImageDialogOpen(false)} />
      )}

      {deleteState !== 'idle' && (
        <ConfirmDialog
          title="이 기록을 삭제할까요?"
          confirmLabel={deleteState === 'deleting' ? '삭제하는 중…' : '삭제'}
          cancelLabel="취소"
          danger
          busy={deleteState === 'deleting'}
          onConfirm={() => void handleDelete()}
          onCancel={() => {
            setDeleteState('idle')
            setDeleteError(null)
          }}
        >
          <p>
            {/* F-13: 상대가 쓴 기록이면 작성자를 명시해 오조작을 막는다 */}
            {data.authorId !== session.userId && `${authorName}님이 남긴 `}
            {station?.name ?? '이 역'}, {dateLabel} 기록
            {data.photos.length > 0 && ` (사진 ${data.photos.length}장)`}을 삭제해요. 되돌릴 수 없어요.
          </p>
          {deleteError !== null && (
            <p className={ui.error} role="alert">
              {deleteError}
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}
