import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSession } from '../../auth/session-context'
import { STORAGE_PREFIX } from '../../lib/app-storage'
import { supabase } from '../../lib/supabase'
import { recordFailureMessage, upsertRecord } from '../../lib/record-rpc'
import { loadStationLines, loadStationMaster } from '../../lib/station-master'
import type { StationMaster, StationRow } from '../../lib/station-master'
import type { Database, Mood, Weather } from '../../lib/database.types'
import { MOODS, WEATHERS } from '../../lib/mood-weather'
import { todayLocal } from '../../lib/format-date'
import { ConfirmDialog } from './ConfirmDialog'
import { PhotoField } from './PhotoField'
import type { EditorPhoto } from './PhotoField'
import { StationPicker } from './StationPicker'
import type { LineBadge } from './StationPicker'
import { TagField } from './TagField'
import {
  MAX_PHOTOS,
  photoStoragePath,
  removePhotoObjects,
  signPhotoUrls,
  uploadPhoto,
} from './photo-pipeline'
import styles from './record-editor.module.css'
import ui from '../../styles/ui.module.css'

/**
 * 기록 작성 / 수정 (`docs/specs/05-record-editor.md`).
 *
 * 이 앱에 데이터가 들어오는 유일한 입구다. 작성과 수정은 **같은 폼**이고 차이는 초기값과
 * 저장 동작뿐이다 (F-02).
 *
 * 저장 순서는 F-16/F-34가 못 박는다: 본문+태그(RPC 1회) → 사진 업로드 → 사진 행 삽입.
 * 사진이 실패해도 본문은 이미 저장돼 있다. **일기를 지키는 것이 사진보다 우선이다.**
 *
 * 이번 라운드에 없는 것:
 * - 역 상세(04)가 없어 "이 역에 기록 추가" 진입 경로 대신 `?stationId=`를 열어 뒀다 (§7 진입 경로).
 * - 기록 상세(06)가 없어 저장 후 이동 목적지는 자리표시자 화면이다.
 * - 수정 중 상대가 먼저 저장한 경우의 안내(§2.3): RPC가 충돌 신호를 주지 않아 감지 불가.
 */

/** F-24 / 00 §4.5 CHECK (2026-08-15 결정) */
const MAX_NOTE = 1000
/** F-24: 항상 카운터를 띄우면 "짧게 써야 한다"는 압박을 준다. 80%부터만 보여준다 */
const NOTE_COUNTER_FROM = Math.floor(MAX_NOTE * 0.8)

/** §6: 모바일에서 전량 병렬 업로드는 실패율을 올린다 */
const UPLOAD_CONCURRENCY = 2

type FormValue = {
  stationId: string | null
  /** `YYYY-MM-DD` */
  visitedOn: string
  mood: Mood | null
  weather: Weather | null
  note: string
  /** 정규화된 표기. 서버가 다시 정규화한다 (00 §4.7) */
  tags: string[]
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string }

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'uploading'; done: number; total: number }

export function RecordEditorScreen() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const session = useSession()

  const routeRecordId = params.recordId ?? null
  const coupleId = session.couple?.id ?? null
  const today = todayLocal()

  const [form, setForm] = useState<FormValue>(() => {
    const prefilledDate = searchParams.get('date')
    return {
      // §7 진입 경로: 프리필 파라미터만 다르고 폼은 동일하다. 04(역 상세)가 붙으면
      // `/records/new?stationId=...`로 넘겨받는다.
      stationId: searchParams.get('stationId'),
      visitedOn:
        prefilledDate !== null && DATE_PATTERN.test(prefilledDate) && prefilledDate <= today
          ? prefilledDate
          : today,
      mood: null,
      weather: null,
      note: '',
      tags: [],
    }
  })
  const [photos, setPhotos] = useState<EditorPhoto[]>([])

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' })
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const [master, setMaster] = useState<StationMaster | null>(null)
  const [lineLinks, setLineLinks] = useState<{ station_id: string; line_id: string }[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [draftOffer, setDraftOffer] = useState<FormValue | null>(null)
  const [deletedDialog, setDeletedDialog] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  /** 변경 감지의 기준값. 저장에 성공하면 여기를 갱신해 dirty를 내린다 */
  const baselineRef = useRef<FormValue>(form)
  /** 사진 목록의 기준 지문(순서 포함). 사진 변경도 이탈 확인 대상이다 */
  const photoBaselineRef = useRef<string>('')
  /**
   * 지금까지 만들어진 기록 id. 신규 저장이 성공한 뒤 사진에서 실패해 재시도할 때
   * 이 값이 없으면 **기록이 하나 더 생긴다**.
   */
  const recordIdRef = useRef<string | null>(routeRecordId)
  /** DB에 실재하는 사진 행 (id → storage_path). 삭제 대상 판정의 기준 */
  const dbPhotosRef = useRef<Map<string, string>>(new Map())
  /** 이탈 확인을 건너뛸 때. 저장 성공 직후의 이동이 막히면 안 된다 */
  const skipBlockRef = useRef(false)

  const draftKey = `${STORAGE_PREFIX}record-draft.${routeRecordId ?? 'new'}`

  // ── 로드 ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoadState({ kind: 'loading' })
    let loaded: StationMaster
    try {
      loaded = await loadStationMaster()
    } catch {
      setLoadState({ kind: 'failed', message: '역 정보를 불러오지 못했어요.' })
      return
    }
    setMaster(loaded)

    // 호선 배지(F-09)와 태그 자동완성(F-28)은 폼 조작을 막지 않는다. 실패해도 그냥 없이 간다.
    void loadStationLines(loaded.version).then(setLineLinks, () => setLineLinks([]))
    void supabase
      .from('couple_tag_usage')
      .select('tag, usage_count')
      .order('usage_count', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (data !== null) setSuggestions(data.map((row) => row.tag))
      })

    if (routeRecordId === null) {
      setLoadState({ kind: 'ready' })
      return
    }

    // 수정 모드. RLS가 내 커플 행만 돌려주므로 couple_id 조건을 따로 걸지 않는다.
    const [recordRes, tagRes, photoRes] = await Promise.all([
      supabase
        .from('records')
        .select('id, station_id, visited_on, mood, weather, note')
        .eq('id', routeRecordId)
        .maybeSingle(),
      supabase.from('record_tags').select('tag').eq('record_id', routeRecordId),
      supabase
        .from('record_photos')
        .select('id, storage_path, sort_order, width, height, byte_size, content_type')
        .eq('record_id', routeRecordId)
        .order('sort_order'),
    ])

    if (recordRes.error !== null) {
      setLoadState({ kind: 'failed', message: '기록을 불러오지 못했어요.' })
      return
    }
    if (recordRes.data === null) {
      // RLS 특성상 "없는 기록"과 "남의 기록"을 구분할 수 없다 (00 §5).
      setLoadState({ kind: 'failed', message: '기록을 찾을 수 없어요.' })
      return
    }

    const row = recordRes.data
    const loadedForm: FormValue = {
      stationId: row.station_id,
      visitedOn: row.visited_on,
      mood: row.mood,
      weather: row.weather,
      note: row.note ?? '',
      tags: (tagRes.data ?? []).map((tag) => tag.tag),
    }
    setForm(loadedForm)
    baselineRef.current = loadedForm

    const photoRows = photoRes.data ?? []
    dbPhotosRef.current = new Map(photoRows.map((photo) => [photo.id, photo.storage_path]))
    // 서명 URL은 한 번에 발급받는다(왕복 1회). 실패하면 그 자리만 대체 표시된다.
    const signed = await signPhotoUrls(photoRows.map((photo) => photo.storage_path))
    const loadedPhotos: EditorPhoto[] = photoRows.map((photo) => ({
      kind: 'existing',
      id: photo.id,
      storagePath: photo.storage_path,
      width: photo.width,
      height: photo.height,
      byteSize: photo.byte_size,
      contentType: photo.content_type,
      url: signed.get(photo.storage_path) ?? null,
      dbSortOrder: photo.sort_order,
    }))
    setPhotos(loadedPhotos)
    photoBaselineRef.current = loadedPhotos.map((photo) => photo.id).join(',')

    setLoadState({ kind: 'ready' })
  }, [routeRecordId])

  useEffect(() => {
    void load()
  }, [load])

  // ── 오프라인 (§5: 입력은 되지만 저장 버튼에 사유 표시) ──────────────────
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // ── 변경 감지 ───────────────────────────────────────────────────────────
  const photoFingerprint = photos.map((photo) => photo.id).join(',')
  const dirty =
    JSON.stringify(form) !== JSON.stringify(baselineRef.current) ||
    photoFingerprint !== photoBaselineRef.current

  /**
   * F-04 / AC-14: 변경사항이 있으면 이탈을 막는다.
   *
   * `useBlocker`는 데이터 라우터에서만 동작한다 — 그래서 `App.tsx`가 `createBrowserRouter`를
   * 쓴다. 저장 성공 직후의 이동은 ref로 통과시킨다(상태로 두면 setState → 리렌더 →
   * 블로커 재등록 순서를 기다려야 한다).
   */
  const blocker = useBlocker(
    useCallback(() => dirty && !skipBlockRef.current, [dirty]),
  )

  // 탭 닫기·새로고침은 라우터가 관여하지 않는다. 브라우저 기본 확인창으로 막는다.
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // ── 임시 저장(초안) — §5 ────────────────────────────────────────────────
  // 사진 파일은 넣지 않는다(용량). 저장 실패·앱 종료 후 재진입에서 일기를 지키는 게 목적이다.
  useEffect(() => {
    if (loadState.kind !== 'ready') return
    const raw = window.localStorage.getItem(draftKey)
    if (raw === null) return
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return
      const draft = parsed as Partial<FormValue>
      if (typeof draft.visitedOn !== 'string' || !Array.isArray(draft.tags)) return
      const restored: FormValue = {
        stationId: typeof draft.stationId === 'string' ? draft.stationId : null,
        visitedOn: draft.visitedOn,
        mood: (draft.mood ?? null) as Mood | null,
        weather: (draft.weather ?? null) as Weather | null,
        note: typeof draft.note === 'string' ? draft.note : '',
        tags: draft.tags.filter((tag): tag is string => typeof tag === 'string'),
      }
      // 초안이 현재 폼과 같으면 물어볼 이유가 없다.
      if (JSON.stringify(restored) !== JSON.stringify(baselineRef.current)) {
        setDraftOffer(restored)
      }
    } catch {
      window.localStorage.removeItem(draftKey)
    }
    // 의존성에 form/baseline을 **의도적으로 넣지 않는다**. 진입 시 1회만 물어봐야 하는데
    // form이 들어가면 타이핑할 때마다 제안 배너가 되살아난다.
  }, [loadState.kind, draftKey])

  useEffect(() => {
    if (loadState.kind !== 'ready' || !dirty) return
    // 키 입력마다 직렬화하면 긴 일기에서 입력이 끊긴다 (§6 입력 지연 50ms).
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(form))
      } catch {
        // 용량 초과. 초안은 보조 기능이라 실패해도 폼은 그대로 동작한다.
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [form, dirty, loadState.kind, draftKey])

  // ── 파생 데이터 ─────────────────────────────────────────────────────────
  const stationById = useMemo(
    () => new Map((master?.stations ?? []).map((station) => [station.id, station])),
    [master],
  )

  /** F-09: 역 → 소속 호선 배지. 1,000행대 조인이라 한 번만 만든다 */
  const badgesByStationId = useMemo(() => {
    const lineById = new Map((master?.lines ?? []).map((line) => [line.id, line]))
    const map = new Map<string, LineBadge[]>()
    for (const link of lineLinks) {
      const line = lineById.get(link.line_id)
      if (line === undefined || !line.is_active) continue
      const list = map.get(link.station_id)
      const badge: LineBadge = { code: line.code, name: line.name, colorToken: line.color_token }
      if (list === undefined) map.set(link.station_id, [badge])
      // 같은 이름의 노선이 본선·지선으로 나뉘어 있어 배지가 중복될 수 있다 (03의 LineOption과 같은 사정).
      else if (!list.some((item) => item.name === badge.name)) list.push(badge)
    }
    return map
  }, [master, lineLinks])

  const selectedStation: StationRow | null =
    form.stationId === null ? null : (stationById.get(form.stationId) ?? null)

  const saving = saveState.kind !== 'idle'
  const canSave = form.stationId !== null && online && !saving && loadState.kind === 'ready'

  // ── 저장 ────────────────────────────────────────────────────────────────

  /**
   * 사진 업로드 + `record_photos` 정합 맞추기 (§4.3).
   *
   * `sort_order`는 **화면 목록의 인덱스 그대로**다. UNIQUE(record_id, sort_order) 때문에
   * 자리 교체를 UPDATE로 하면 중간 상태에서 유니크 충돌이 난다(0↔1 맞바꿈에 빈 슬롯이 없다).
   * 그래서 자리가 바뀐 행은 **삭제 후 재삽입**하고, 삭제·삽입을 각각 요청 1회로 묶어
   * "행이 사라진 채로 남는" 창을 최소화했다. 업로드를 먼저 끝내는 것도 같은 이유다.
   *
   * @returns 화면에 반영할 사진 목록과 실패 장수
   */
  async function syncPhotos(
    recordId: string,
    list: EditorPhoto[],
  ): Promise<{ list: EditorPhoto[]; failed: number; message: string | null }> {
    if (coupleId === null) return { list, failed: 0, message: '커플 정보를 확인하지 못했어요.' }

    const pending = list.filter((photo) => photo.kind === 'new')
    const uploadedPaths = new Map<string, string>()

    if (pending.length > 0) {
      const total = pending.length
      let done = 0
      setSaveState({ kind: 'uploading', done, total })
      const queue = [...pending]
      const worker = async () => {
        for (;;) {
          const photo = queue.shift()
          if (photo === undefined || photo.kind !== 'new') return
          const path = photoStoragePath(coupleId, recordId, photo.id)
          if (await uploadPhoto(path, photo.prepared)) uploadedPaths.set(photo.id, path)
          done += 1
          setSaveState({ kind: 'uploading', done, total })
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, () => worker()),
      )
    }

    const liveIds = new Set(list.map((photo) => photo.id))
    const removedPaths: string[] = []
    const idsToDelete: string[] = []
    for (const [id, path] of dbPhotosRef.current) {
      if (!liveIds.has(id)) {
        idsToDelete.push(id)
        removedPaths.push(path)
      }
    }

    // 스키마의 Insert 타입을 그대로 쓴다 — 컬럼을 빠뜨리면 여기서 컴파일이 깨진다.
    const rowsToInsert: Database['public']['Tables']['record_photos']['Insert'][] = []
    for (const [index, photo] of list.entries()) {
      if (photo.kind === 'existing') {
        if (photo.dbSortOrder === index) continue
        idsToDelete.push(photo.id)
        rowsToInsert.push({
          id: photo.id,
          record_id: recordId,
          storage_path: photo.storagePath,
          sort_order: index,
          width: photo.width,
          height: photo.height,
          byte_size: photo.byteSize,
          content_type: photo.contentType,
        })
        continue
      }
      const path = uploadedPaths.get(photo.id)
      if (path === undefined) continue
      rowsToInsert.push({
        id: photo.id,
        record_id: recordId,
        storage_path: path,
        sort_order: index,
        width: photo.prepared.width,
        height: photo.prepared.height,
        byte_size: photo.prepared.byteSize,
        content_type: photo.prepared.contentType,
      })
    }

    if (idsToDelete.length > 0) {
      const { error } = await supabase.from('record_photos').delete().in('id', idsToDelete)
      if (error !== null) {
        return { list, failed: pending.length, message: '사진 정보를 저장하지 못했어요.' }
      }
    }
    if (rowsToInsert.length > 0) {
      const { error } = await supabase.from('record_photos').insert(rowsToInsert)
      if (error !== null) {
        // 삭제는 됐는데 삽입이 실패한 상태. 목록은 그대로 두어 재시도가 같은 계산을
        // 다시 하도록 한다(삭제는 멱등이고 삽입은 같은 id로 복구된다).
        return {
          list: list.map((photo) =>
            photo.kind === 'new' ? { ...photo, failed: true } : photo,
          ),
          failed: pending.length,
          message: '사진 정보를 저장하지 못했어요. 다시 시도해주세요.',
        }
      }
    }

    // Storage 삭제 실패는 사용자에게 보이지 않는다 — DB 행이 없으면 화면에 안 뜬다 (§4.3).
    // 고아 객체는 배치가 정리한다.
    void removePhotoObjects(removedPaths)

    let failed = 0
    const nextList: EditorPhoto[] = list.map((photo, index) => {
      if (photo.kind === 'existing') {
        return photo.dbSortOrder === index ? photo : { ...photo, dbSortOrder: index }
      }
      const path = uploadedPaths.get(photo.id)
      if (path === undefined) {
        failed += 1
        return { ...photo, failed: true }
      }
      // 업로드가 끝난 사진은 '기존'으로 승격시킨다. 재시도 시 두 번 삽입되지 않게 하는 장치다.
      // 썸네일은 서명 URL을 새로 받지 않고 로컬 미리보기를 그대로 쓴다(이미 같은 이미지다).
      return {
        kind: 'existing',
        id: photo.id,
        storagePath: path,
        width: photo.prepared.width,
        height: photo.prepared.height,
        byteSize: photo.prepared.byteSize,
        contentType: photo.prepared.contentType,
        url: photo.previewUrl,
        dbSortOrder: index,
      }
    })

    dbPhotosRef.current = new Map(
      nextList
        .filter((photo): photo is Extract<EditorPhoto, { kind: 'existing' }> => photo.kind === 'existing')
        .map((photo) => [photo.id, photo.storagePath]),
    )

    return { list: nextList, failed, message: null }
  }

  /**
   * @param asNew 삭제된 기록을 새 기록으로 되살리는 경로 (§2.3)
   * @param photoList 사진 목록을 인자로 받는 이유: "삭제된 기록" 흐름이 목록을 걸러낸 직후
   *   저장을 부르는데, setState 반영 전이라 클로저의 `photos`가 아직 옛 값이다.
   */
  async function save(asNew: boolean, photoList: EditorPhoto[]) {
    if (form.stationId === null) return
    setErrorBanner(null)
    setPhotoError(null)
    setSaveState({ kind: 'saving' })

    // F-34: 본문 + 태그는 RPC 1회. 태그만 저장 실패해 절반짜리 기록이 남는 걸 막는다.
    const result = await upsertRecord({
      p_record_id: asNew ? null : recordIdRef.current,
      p_station_id: form.stationId,
      p_visited_on: form.visitedOn,
      p_mood: form.mood,
      p_weather: form.weather,
      p_note: form.note.trim() === '' ? null : form.note,
      p_tags: form.tags,
    })

    if (!result.ok) {
      setSaveState({ kind: 'idle' })
      // §2.3: 수정하려던 기록이 사라졌다. 입력값을 새 기록으로 살릴 기회를 준다.
      if (result.failure.code === 'RECORD_NOT_FOUND' && recordIdRef.current !== null) {
        setDeletedDialog(true)
        return
      }
      // F-05 / AC-15: 실패해도 입력값은 손대지 않는다. 초안도 그대로 남는다.
      setErrorBanner(recordFailureMessage(result.failure))
      return
    }

    const recordId = result.data.record_id
    recordIdRef.current = recordId
    // §5: 초안은 저장 성공 시 삭제한다. 사진 실패는 본문 저장을 되돌리지 않으므로 여기서 지운다.
    window.localStorage.removeItem(draftKey)

    const synced = await syncPhotos(recordId, photoList)
    setPhotos(synced.list)
    setSaveState({ kind: 'idle' })

    // 본문이 저장됐으니 이 시점의 값이 새 기준이다. 사진만 남았을 때 이탈 확인이
    // 다시 뜨지 않도록 사진 지문도 함께 갱신한다.
    baselineRef.current = form
    photoBaselineRef.current = synced.list.map((photo) => photo.id).join(',')

    if (synced.message !== null || synced.failed > 0) {
      setPhotoError(
        synced.message ??
          `사진 ${synced.failed}장을 올리지 못했어요. 기록은 저장됐어요 — 아래에서 다시 시도할 수 있어요.`,
      )
      return
    }

    // F-03: 작성 결과를 바로 확인시킨다. 06(기록 상세)은 아직 자리표시자다.
    skipBlockRef.current = true
    navigate(`/records/${recordId}`, { replace: true, state: { toast: '기록을 저장했어요' } })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    // F-33: 중복 제출 방지. 버튼 비활성과 별개로 Enter 제출 경로도 막는다.
    if (!canSave) return
    void save(false, photos)
  }

  /** 감정·날씨 토글의 화살표 이동 (§6 radiogroup). 항목마다 ref를 두지 않는다 */
  function moveToggleFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const group = event.currentTarget
    const items = [...group.querySelectorAll<HTMLButtonElement>('button')]
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    if (current === -1) return
    event.preventDefault()
    const next = (current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  if (loadState.kind === 'loading') {
    return (
      <div className={styles.screen}>
        {/* §5 수정 초기 로딩: 폼 전체 스켈레톤 */}
        <div className={styles.skeleton} aria-hidden="true" />
        <p className="srOnly" role="status">
          불러오는 중
        </p>
      </div>
    )
  }

  if (loadState.kind === 'failed') {
    return (
      <div className={ui.centerBox}>
        <p>{loadState.message}</p>
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

  const noteLength = [...form.note].length

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={ui.title}>{routeRecordId === null ? '기록 작성' : '기록 수정'}</h1>
      </header>

      {draftOffer !== null && (
        <div className={ui.notice} role="status">
          <p>작성 중이던 내용이 있어요. 이어서 쓸까요?</p>
          <div className={ui.buttonRow}>
            <button
              type="button"
              className={ui.button}
              onClick={() => {
                window.localStorage.removeItem(draftKey)
                setDraftOffer(null)
              }}
            >
              새로 시작
            </button>
            <button
              type="button"
              className={`${ui.button} ${ui.buttonPrimary}`}
              onClick={() => {
                setForm(draftOffer)
                setDraftOffer(null)
              }}
            >
              이어서 쓰기
            </button>
          </div>
        </div>
      )}

      {errorBanner !== null && (
        <p className={ui.errorBanner} role="alert">
          {errorBanner}
        </p>
      )}

      {/* F-16 부분 실패: 기록은 저장됐고 사진만 남은 상태 */}
      {photoError !== null && (
        <div className={ui.errorBanner} role="alert">
          <p>{photoError}</p>
          <button
            type="button"
            className={ui.button}
            disabled={saving || !online}
            onClick={() => void save(false, photos)}
          >
            사진 다시 올리기
          </button>
        </div>
      )}

      {master?.stale === true && (
        <p className={ui.hint}>오프라인 — 저장된 역 정보로 표시 중이에요.</p>
      )}

      <form className={ui.form} onSubmit={handleSubmit}>
        <StationPicker
          stations={master?.stations ?? []}
          badgesByStationId={badgesByStationId}
          value={selectedStation}
          disabled={saving}
          onChange={(station) => setForm((prev) => ({ ...prev, stationId: station.id }))}
        />

        <div className={ui.field}>
          <label className={ui.label} htmlFor="visited-on">
            날짜 <span className={styles.required}>*</span>
          </label>
          <input
            id="visited-on"
            className={ui.input}
            type="date"
            value={form.visitedOn}
            required
            disabled={saving}
            // §2.3: 미래 날짜는 에러 문구보다 선택 자체를 막는 게 낫다 (AC-04).
            max={today}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, visitedOn: event.target.value }))
            }
          />
        </div>

        <div className={ui.field}>
          <span className={ui.label} id="mood-label">
            감정
          </span>
          {/* F-13의 "다시 누르면 해제"는 라디오 표준 동작이 아니지만, §6이 radiogroup 역할을
              지정했다. 역할은 그대로 두고 해제 동작만 더한다 — 스크린리더에는 "선택 없음"
              상태가 aria-checked=false 다섯 개로 정확히 전달된다. */}
          <div
            className={styles.toggleGroup}
            role="radiogroup"
            aria-labelledby="mood-label"
            onKeyDown={moveToggleFocus}
          >
            {MOODS.map((item) => (
              <button
                key={item.slug}
                type="button"
                role="radio"
                aria-checked={form.mood === item.slug}
                className={
                  form.mood === item.slug
                    ? `${styles.toggle} ${styles.toggleOn}`
                    : styles.toggle
                }
                disabled={saving}
                // F-13: 같은 항목을 다시 누르면 해제(NULL)된다. 잘못 눌렀을 때 되돌릴 방법이 있어야 한다.
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    mood: prev.mood === item.slug ? null : item.slug,
                  }))
                }
              >
                <span className={styles.toggleEmoji} aria-hidden="true">
                  {item.emoji}
                </span>
                {/* §6: 이모지만 두지 않는다 */}
                <span className={styles.toggleLabel}>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={ui.field}>
          <span className={ui.label} id="weather-label">
            날씨
          </span>
          <div
            className={styles.toggleGroup}
            role="radiogroup"
            aria-labelledby="weather-label"
            onKeyDown={moveToggleFocus}
          >
            {WEATHERS.map((item) => (
              <button
                key={item.slug}
                type="button"
                role="radio"
                aria-checked={form.weather === item.slug}
                className={
                  form.weather === item.slug
                    ? `${styles.toggle} ${styles.toggleOn}`
                    : styles.toggle
                }
                disabled={saving}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    weather: prev.weather === item.slug ? null : item.slug,
                  }))
                }
              >
                <span className={styles.toggleEmoji} aria-hidden="true">
                  {item.emoji}
                </span>
                <span className={styles.toggleLabel}>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <PhotoField
          photos={photos}
          onChange={setPhotos}
          disabled={saving}
          progress={saveState.kind === 'uploading' ? saveState : null}
        />

        <div className={ui.field}>
          <label className={ui.label} htmlFor="note">
            일기
          </label>
          <textarea
            id="note"
            className={`${ui.input} ${styles.textarea}`}
            value={form.note}
            rows={6}
            maxLength={MAX_NOTE}
            disabled={saving}
            placeholder="그날의 기억을 남겨보세요."
            onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
          />
          {/* F-24: 80%에 도달해야 카운터를 띄운다 */}
          {noteLength >= NOTE_COUNTER_FROM && (
            <p className={ui.hint} aria-live="polite">
              {noteLength} / {MAX_NOTE}자
            </p>
          )}
        </div>

        <TagField
          tags={form.tags}
          suggestions={suggestions}
          disabled={saving}
          onChange={(tags) => setForm((prev) => ({ ...prev, tags }))}
        />

        <div className={styles.saveBar}>
          {!online && <p className={ui.hint}>오프라인이라 저장할 수 없어요.</p>}
          {form.stationId === null && <p className={ui.hint}>역을 선택하면 저장할 수 있어요.</p>}
          <button
            type="submit"
            className={`${ui.button} ${ui.buttonPrimary}`}
            disabled={!canSave}
          >
            {saveState.kind === 'saving'
              ? '저장하는 중…'
              : saveState.kind === 'uploading'
                ? `사진 올리는 중 ${saveState.done}/${saveState.total}`
                : '저장'}
          </button>
        </div>
      </form>

      {/* 사진 상한은 상수 하나로 UI·DB가 같은 값을 본다 (§7 확장 포인트) */}
      <p className="srOnly">사진은 최대 {MAX_PHOTOS}장까지 올릴 수 있어요.</p>

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="작성 중인 내용이 있어요"
          confirmLabel="나가기"
          cancelLabel="계속 작성"
          danger
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        >
          <p>지금 나가면 입력한 내용이 사라져요.</p>
        </ConfirmDialog>
      )}

      {deletedDialog && (
        <ConfirmDialog
          title="이 기록은 삭제되었어요"
          confirmLabel="새 기록으로 저장"
          cancelLabel="닫기"
          onConfirm={() => {
            setDeletedDialog(false)
            // 원본 기록이 사라지면서 사진 행도 CASCADE로 함께 지워졌다. 기존 사진은 새 기록에
            // 다시 붙일 수 없으므로(파일은 남아 있지만 이 화면에 원본이 없다) 목록에서 뺀다.
            recordIdRef.current = null
            dbPhotosRef.current = new Map()
            const keptPhotos = photos.filter((photo) => photo.kind === 'new')
            setPhotos(keptPhotos)
            void save(true, keptPhotos)
          }}
          onCancel={() => setDeletedDialog(false)}
        >
          <p>작성 중이던 내용을 새 기록으로 저장할까요?</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
