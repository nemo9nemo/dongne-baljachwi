import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { readStateString, recordReturnPath } from '../../lib/router-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '../../auth/session-context'
import { STORAGE_PREFIX } from '../../lib/app-storage'
import { supabase } from '../../lib/supabase'
import { getEditSnapshot, recordFailureMessage, saveRecord, syncRecordPhotos } from '../../lib/record-rpc'
import type { RecordFailure } from '../../lib/record-rpc'
import { persistPendingWrite, readPendingWrite, recordWriteKey } from '../../lib/record-write-journal'
import type { PendingRecordWrite, RecordForm } from '../../lib/record-write-journal'
import { loadStationLines, loadStationMaster } from '../../lib/station-master'
import type { StationMaster, StationRow } from '../../lib/station-master'
import type { EditSnapshot, RecordPhotoInput } from '../../lib/database.types'
import { MOODS, WEATHERS, isMood, isWeather } from '../../lib/mood-weather'
import { invalidateRecordCaches } from '../../lib/screen-cache'
import { todayKst } from '../../lib/format-date'
import { fetchRecordCardPage, type RecordCard as RecordCardData } from '../../lib/record-card-query'
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

/** D01–D04: 본문과 사진 목록을 각각 버전 검사하며, 미확인 요청은 같은 ID로 확인한다. */

/** F-24 / 00 §4.5 CHECK (2026-08-15 결정) */
const MAX_NOTE = 1000
/** F-24: 항상 카운터를 띄우면 "짧게 써야 한다"는 압박을 준다. 80%부터만 보여준다 */
const NOTE_COUNTER_FROM = Math.floor(MAX_NOTE * 0.8)

/** §6: 모바일에서 전량 병렬 업로드는 실패율을 올린다 */
const UPLOAD_CONCURRENCY = 2

type FormValue = RecordForm

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string }

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'uploading'; done: number; total: number }

export function RecordEditorScreen() {
  const session = useSession()
  const { recordId } = useParams()
  // 계정/공간/기록 변경 시 이전 폼과 비동기 작업이 다음 편집기에 들어가지 않게 한다.
  return <RecordEditor key={JSON.stringify([session.userId, session.couple?.id, recordId])} />
}

function snapshotForm(snapshot: EditSnapshot): FormValue {
  const row = snapshot.record
  return { stationId: row.station_id, visitedOn: row.visited_on, mood: row.mood,
    weather: row.weather, note: row.note ?? '', tags: snapshot.tags, placeName: row.place_name ?? '' }
}

async function snapshotPhotos(snapshot: EditSnapshot): Promise<EditorPhoto[]> {
  const signed = await signPhotoUrls(snapshot.photos.map(photo => photo.storage_path)).catch(() => new Map<string,string>())
  return snapshot.photos.map(photo => ({ kind: 'existing', id: photo.id, storagePath: photo.storage_path,
    width: photo.width, height: photo.height, byteSize: photo.byte_size, contentType: photo.content_type,
    dbSortOrder: photo.sort_order, url: signed.get(photo.storage_path) ?? null }))
}

function photoInputs(list: EditorPhoto[], coupleId: string, recordId: string): RecordPhotoInput[] {
  return list.map((photo, sort_order) => photo.kind === 'existing'
    ? { id: photo.id, storage_path: photo.storagePath, sort_order, width: photo.width,
        height: photo.height, byte_size: photo.byteSize, content_type: photo.contentType }
    : { id: photo.id, storage_path: photoStoragePath(coupleId, recordId, photo.id), sort_order,
        width: photo.prepared.width, height: photo.prepared.height, byte_size: photo.prepared.byteSize, content_type: photo.prepared.contentType })
}

function RecordEditor() {
  const location = useLocation()
  const backTo = recordReturnPath(readStateString(location.state, 'from'))
  const params = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const session = useSession()

  const routeRecordId = params.recordId ?? null
  const coupleId = session.couple?.id ?? null
  const today = todayKst()
  const writeKey = recordWriteKey(session.userId ?? '', coupleId ?? '', routeRecordId)
  const [pending, setPending] = useState(() => readPendingWrite(writeKey))
  const initialPendingRef = useRef(pending)
  const recoveredAtMountRef = useRef(pending !== null)
  const pendingRef = useRef(pending)
  const confirmedBodyRef = useRef<Extract<PendingRecordWrite, { kind: 'body' }> | null>(null)
  const [preparing, setPreparing] = useState(0)
  const preparingRef = useRef(0)
  const busyRef = useRef(false)
  const aliveRef = useRef(true)
  const loadGenerationRef = useRef(0)
  const revisionRef = useRef<number | null>(null)
  const uploadedRef = useRef(new Map<string, string>())
  const [conflict, setConflict] = useState<EditSnapshot | 'unloaded' | null>(null)
  const [latestPhotos, setLatestPhotos] = useState<EditorPhoto[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [needsPhotoSelection, setNeedsPhotoSelection] = useState(false)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false; loadGenerationRef.current += 1 }
  }, [])

  const [form, setForm] = useState<FormValue>(() => {
    const prefilledDate = searchParams.get('date')
    return {
      // §7 진입 경로: 프리필 파라미터만 다르고 폼은 동일하다. 04(역 상세)의 "이 역에 기록
      // 추가"와 09(프로필)의 추천 칩이 `/records/new?stationId=...`로 넘겨준다.
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
  const [previousVisits, setPreviousVisits] = useState<RecordCardData[]>([])
  useEffect(() => {
    let alive = true
    setPreviousVisits([])
    if (form.stationId !== null) void fetchRecordCardPage({ stationId: form.stationId }).then(page => {
      if (alive) setPreviousVisits(page.cards.filter(card => card.id !== routeRecordId).slice(0, 3))
    }, () => {})
    return () => { alive = false }
  }, [form.stationId, routeRecordId])

  /** 변경 감지의 기준값. 저장에 성공하면 여기를 갱신해 dirty를 내린다 */
  const baselineRef = useRef<FormValue>(form)
  /** 사진 목록의 기준 지문(순서 포함). 사진 변경도 이탈 확인 대상이다 */
  const photoBaselineRef = useRef<string>('')
  /**
   * 지금까지 만들어진 기록 id. 신규 저장이 성공한 뒤 사진에서 실패해 재시도할 때
   * 이 값이 없으면 **기록이 하나 더 생긴다**.
   */
  const recordIdRef = useRef(routeRecordId ?? initialPendingRef.current?.args.p_record_id ?? crypto.randomUUID())
  /** 이탈 확인을 건너뛸 때. 저장 성공 직후의 이동이 막히면 안 된다 */
  const skipBlockRef = useRef(false)

  const draftKey = `${STORAGE_PREFIX}record-draft.${session.userId}.${coupleId}.${routeRecordId ?? 'new'}`
  const formLive = useRef(form)
  formLive.current = form
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key !== draftKey || !event.newValue || event.newValue === JSON.stringify(formLive.current)) return
      try {
        const raw: unknown = JSON.parse(event.newValue)
        if (typeof raw !== 'object' || raw === null) return
        const draft = raw as Partial<FormValue>
        if (typeof draft.visitedOn !== 'string' || typeof draft.note !== 'string' || !Array.isArray(draft.tags)) return
        setDraftOffer({ stationId: typeof draft.stationId === 'string' ? draft.stationId : null,
          visitedOn: draft.visitedOn, note: draft.note, placeName: typeof draft.placeName === 'string' ? draft.placeName : '',
          mood: isMood(draft.mood) ? draft.mood : null, weather: isWeather(draft.weather) ? draft.weather : null,
          tags: draft.tags.filter((tag): tag is string => typeof tag === 'string') })
        setNotice('다른 탭에서 초안이 변경됐어요. 현재 입력을 유지하거나 초안을 불러올 수 있어요.')
      } catch { /* 다른 탭의 잘못된 초안이 현재 폼을 훼손하지 않게 한다. */ }
    }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [draftKey])

  function updatePending(value: PendingRecordWrite | null) {
    pendingRef.current = value
    if (!persistPendingWrite(writeKey, value ?? confirmedBodyRef.current) && value !== null) {
      setNotice('이 브라우저에서 저장 요청을 보관하지 못했어요. 결과를 확인할 때까지 화면을 유지해주세요.')
    }
    setPending(value)
  }

  async function installSnapshot(snapshot: EditSnapshot) {
    const list = await snapshotPhotos(snapshot)
    if (!aliveRef.current) return
    const value = snapshotForm(snapshot)
    setForm(value)
    baselineRef.current = value
    recordIdRef.current = snapshot.record.id
    revisionRef.current = snapshot.record.revision
    setPhotos(list)
    photoBaselineRef.current = list.map(photo => photo.id).join(',')
    return list
  }

  // D01: 하나라도 실패하면 폼을 저장 가능 상태로 열지 않는다.
  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    const current = () => aliveRef.current && generation === loadGenerationRef.current
    setLoadState({ kind: 'loading' })
    try {
      const [loaded, snapshot] = await Promise.all([
        loadStationMaster(),
        routeRecordId === null ? Promise.resolve(null) : getEditSnapshot(routeRecordId),
      ])
      const list = snapshot === null ? [] : await snapshotPhotos(snapshot)
      if (!current()) return
      setMaster(loaded)
      if (snapshot !== null) {
        const value = snapshotForm(snapshot)
        baselineRef.current = value
        setForm(initialPendingRef.current?.form ?? value)
        revisionRef.current = snapshot.record.revision
        setPhotos(list)
        photoBaselineRef.current = list.map(photo => photo.id).join(',')
      } else if (initialPendingRef.current !== null) setForm(initialPendingRef.current.form)
      setLoadState({ kind: 'ready' })
      void loadStationLines(loaded.version).then(value => { if (current()) setLineLinks(value) }, () => {})
      void supabase.from('couple_tag_usage').select('tag, usage_count').order('usage_count', { ascending: false }).limit(200)
        .then(({ data }) => { if (current() && data !== null) setSuggestions(data.map(row => row.tag)) })
    } catch {
      if (current()) setLoadState({ kind: 'failed', message: '기록과 태그·사진을 모두 불러오지 못했어요. 다시 시도해주세요.' })
    }
  }, [routeRecordId])

  useEffect(() => { void load(); return () => { loadGenerationRef.current += 1 } }, [load])

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
    photoFingerprint !== photoBaselineRef.current || photoError !== null || preparing > 0 || pending !== null || saveState.kind !== 'idle'

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
    try {
      const raw = window.localStorage.getItem(draftKey)
      if (raw === null) return
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return
      const draft = parsed as Partial<FormValue>
      if (typeof draft.visitedOn !== 'string' || !Array.isArray(draft.tags)) return
      const restored: FormValue = {
        stationId: typeof draft.stationId === 'string' ? draft.stationId : null,
        visitedOn: draft.visitedOn,
        // localStorage는 외부 입력이다(다른 탭·이전 버전·사용자 편집). 캐스팅으로 통과시키면
        // 없는 슬러그가 폼에 들어와 저장 시점에야 서버 CHECK로 터진다.
        mood: isMood(draft.mood) ? draft.mood : null,
        weather: isWeather(draft.weather) ? draft.weather : null,
        note: typeof draft.note === 'string' ? draft.note : '',
        placeName: typeof draft.placeName === 'string' ? draft.placeName : '',
        tags: draft.tags.filter((tag): tag is string => typeof tag === 'string'),
      }
      // 초안이 현재 폼과 같으면 물어볼 이유가 없다.
      if (JSON.stringify(restored) !== JSON.stringify(baselineRef.current)) {
        setDraftOffer(restored)
      }
    } catch {
      // 초안 저장소가 차단되어도 서버 저장과 화면 입력은 유지한다.
    }
    // 의존성에 form/baseline을 **의도적으로 넣지 않는다**. 진입 시 1회만 물어봐야 하는데
    // form이 들어가면 타이핑할 때마다 제안 배너가 되살아난다.
  }, [loadState.kind, draftKey])

  useEffect(() => {
    if (loadState.kind !== 'ready' || !dirty || pending !== null || draftOffer !== null) return
    // 키 입력마다 직렬화하면 긴 일기에서 입력이 끊긴다 (§6 입력 지연 50ms).
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(form))
      } catch {
        // 용량 초과. 초안은 보조 기능이라 실패해도 폼은 그대로 동작한다.
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [form, dirty, loadState.kind, draftKey, pending, draftOffer])

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

  const saving = saveState.kind !== 'idle' || pending !== null
  // `stationId`가 있어도 마스터에 없는 역(URL로 들어온 오타·삭제된 역)이면 저장할 수 없다 —
  // 서버 FK가 거부할 요청을 보내 놓고 실패 배너로 알리는 것보다 버튼을 막고 사유를 보여준다.
  const canSave = selectedStation !== null && online && !saving && preparing === 0 && conflict === null && !needsPhotoSelection && loadState.kind === 'ready'

  // ── 저장: 응답 유실 시 불변 요청을 유지하고, 사진 재시도는 본문을 건드리지 않는다.
  function failed(failure: RecordFailure, photoStage = false) {
    if (failure.code !== 'NETWORK' && failure.code !== 'UNKNOWN') updatePending(null)
    if (failure.code === 'RECORD_CONFLICT') setConflict('unloaded')
    if (failure.code === 'RECORD_NOT_FOUND') setDeletedDialog(true)
    const message = pendingRef.current !== null
      ? '저장 결과를 확인하지 못했어요. 같은 요청의 결과를 확인해주세요.'
      : recordFailureMessage(failure)
    if (photoStage) setPhotoError('글은 저장됐어요. ' + message)
    else setErrorBanner(message)
  }

  async function syncPhotos(list: EditorPhoto[]): Promise<boolean> {
    if (coupleId === null || revisionRef.current === null) return false
    if (pendingRef.current?.kind !== 'photos' && list.map(photo => photo.id).join(',') === photoBaselineRef.current) return true
    const needed = list.filter(photo => photo.kind === 'new' && !uploadedRef.current.has(photo.id))
    let done = 0
    setSaveState({ kind: 'uploading', done, total: needed.length })
    const queue = [...needed]
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, needed.length) }, async () => {
      for (;;) {
        const photo = queue.shift()
        if (photo === undefined || photo.kind !== 'new' || !aliveRef.current) return
        const path = photoStoragePath(coupleId, recordIdRef.current, photo.id)
        const ok = await uploadPhoto(path, photo.prepared).catch(() => false)
        if (ok) uploadedRef.current.set(photo.id, path)
        done += 1
        if (aliveRef.current) setSaveState({ kind: 'uploading', done, total: needed.length })
      }
    }))
    if (!aliveRef.current) return false
    const missing = list.filter(photo => photo.kind === 'new' && !uploadedRef.current.has(photo.id))
    if (missing.length > 0) {
      setPhotos(list.map(photo => photo.kind === 'new' ? { ...photo, failed: !uploadedRef.current.has(photo.id) } : photo))
      setPhotoError('글은 저장됐어요. 사진 ' + missing.length + '장을 올리지 못해 기존 사진 목록을 유지했어요. 사진만 다시 시도해주세요.')
      return false
    }
    const rows = photoInputs(list, coupleId, recordIdRef.current)
    const operation: PendingRecordWrite = pendingRef.current?.kind === 'photos' ? pendingRef.current : {
      kind: 'photos', form: structuredClone(form), args: { p_record_id: recordIdRef.current,
        p_operation_id: crypto.randomUUID(), p_expected_revision: revisionRef.current, p_photos: rows },
    }
    updatePending(operation)
    const result = await syncRecordPhotos(operation.args)
    if (!aliveRef.current) return false
    if (!result.ok) { failed(result.failure, true); return false }
    revisionRef.current = result.data.revision
    const next: EditorPhoto[] = list.map((photo, index) => photo.kind === 'existing'
      ? { ...photo, dbSortOrder: index }
      : { kind: 'existing', id: photo.id, storagePath: uploadedRef.current.get(photo.id)!,
          width: photo.prepared.width, height: photo.prepared.height, byteSize: photo.prepared.byteSize,
          contentType: photo.prepared.contentType, url: photo.previewUrl, dbSortOrder: index })
    setPhotos(next)
    photoBaselineRef.current = next.map(photo => photo.id).join(',')
    confirmedBodyRef.current = null
    updatePending(null)
    invalidateRecordCaches()
    // 응답이 확인되기 전에는 원본을 지우지 않는다. 실패 객체는 D07 정리 대상으로 남긴다.
    void removePhotoObjects(result.data.removed_paths).catch(() => {})
    return true
  }

  async function save(photosOnly: boolean, list: EditorPhoto[]) {
    if (busyRef.current || preparingRef.current > 0 || !online || needsPhotoSelection || conflict !== null || loadState.kind !== 'ready' || form.stationId === null || coupleId === null) return
    busyRef.current = true
    setSaveState({ kind: 'saving' })
    setErrorBanner(null)
    setPhotoError(null)
    try {
      if (!photosOnly && pendingRef.current?.kind !== 'photos') {
        const operation: PendingRecordWrite = pendingRef.current?.kind === 'body' ? pendingRef.current : {
          kind: 'body', form: structuredClone(form), newPhotoCount: list.filter(photo => photo.kind === 'new').length,
          photoPlan: photoInputs(list, coupleId, recordIdRef.current),
          args: { p_record_id: recordIdRef.current, p_operation_id: crypto.randomUUID(),
            p_create: revisionRef.current === null, p_expected_revision: revisionRef.current,
            p_station_id: form.stationId, p_visited_on: form.visitedOn, p_mood: form.mood,
            p_weather: form.weather, p_note: form.note.trim() === '' ? null : form.note, p_tags: [...form.tags], p_place_name: form.placeName?.trim() || null },
        }
        updatePending(operation)
        const result = await saveRecord(operation.args)
        if (!aliveRef.current) return
        if (!result.ok) { failed(result.failure); return }
        recordIdRef.current = result.data.record_id
        revisionRef.current = result.data.revision
        baselineRef.current = operation.form
        confirmedBodyRef.current = operation
        updatePending(null)
        // 사진 단계가 끝나기 전 새로고침해도 신규 기록 ID와 사진 편집 의도를 복구한다.
        invalidateRecordCaches()
        try { localStorage.removeItem(draftKey) } catch { /* 초안 정리 실패가 사진 저장을 막지 않게 한다. */ }
      }
      if (!await syncPhotos(list) || !aliveRef.current) return
      confirmedBodyRef.current = null
      persistPendingWrite(writeKey, null)
      if (JSON.stringify(form) !== JSON.stringify(baselineRef.current)) {
        setNotice('사진은 저장됐어요. 변경한 글은 전체 저장 버튼으로 저장해주세요.')
        return
      }
      try { localStorage.removeItem(draftKey) } catch { /* 서버 성공을 유지한다. */ }
      skipBlockRef.current = true
      navigate('/records/' + recordIdRef.current, { replace: true, state: { toast: '기록을 저장했어요', saved: true, from: backTo } })
    } catch {
      if (aliveRef.current) setErrorBanner('저장을 마치지 못했어요. 입력을 유지했으니 저장 결과를 확인해주세요.')
    } finally {
      busyRef.current = false
      if (aliveRef.current) setSaveState({ kind: 'idle' })
    }
  }

  async function recoverPending() {
    const operation = pendingRef.current
    if (operation === null || busyRef.current || preparingRef.current > 0 || !online) return
    if (!recoveredAtMountRef.current) { await save(operation.kind === 'photos', photos); return }
    busyRef.current = true
    setSaveState({ kind: 'saving' })
    try {
      const result = operation.kind === 'body' ? await saveRecord(operation.args) : await syncRecordPhotos(operation.args)
      if (!aliveRef.current) return
      if (!result.ok) { failed(result.failure, operation.kind === 'photos'); return }
      const snapshot = await getEditSnapshot(operation.args.p_record_id)
      const loaded = await installSnapshot(snapshot)
      if (!aliveRef.current) return
      // 새로고침 후에도 전송 당시 글은 보존한다. 사진 Blob은 보관하지 않았음을 명시한다.
      setForm(operation.form)
      confirmedBodyRef.current = operation.kind === 'body' ? operation : null
      updatePending(null)
      recoveredAtMountRef.current = false
      if (snapshot.record.revision !== result.data.revision) { setConflict(snapshot); setLatestPhotos(loaded ?? []) }
      setNotice('저장 결과를 확인했어요. 전송했던 글을 유지했어요.')
      if (operation.kind === 'body') {
        const byId = new Map((loaded ?? []).map(photo => [photo.id, photo]))
        setPhotos(operation.photoPlan.flatMap(photo => byId.has(photo.id) ? [byId.get(photo.id)!] : []))
        if (operation.newPhotoCount > 0) {
          setNeedsPhotoSelection(true)
          setPhotoError('글은 저장됐어요. 새로고침으로 사진 파일이 없어졌어요. 사진을 다시 선택해주세요.')
        }
      }
      invalidateRecordCaches()
      if ('removed_paths' in result.data) void removePhotoObjects(result.data.removed_paths).catch(() => {})
    } catch {
      if (aliveRef.current) setErrorBanner('저장 요청은 유지했어요. 연결을 확인한 뒤 결과 확인을 다시 시도해주세요.')
    } finally { busyRef.current = false; if (aliveRef.current) setSaveState({ kind: 'idle' }) }
  }

  async function previewLatest() {
    try {
      const snapshot = await getEditSnapshot(recordIdRef.current)
      const list = await snapshotPhotos(snapshot)
      if (aliveRef.current) { setConflict(snapshot); setLatestPhotos(list) }
    } catch { if (aliveRef.current) setErrorBanner('최신 내용을 불러오지 못했어요. 내 입력은 유지했어요.') }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (canSave) void save(false, photos)
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
        <Button type="button" variant="default" onClick={() => void load()}>
          다시 시도
        </Button>
        <Button type="button" onClick={() => navigate(-1)}>돌아가기</Button>
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
          <p className={ui.hint}>글과 선택 정보만 복원돼요. 사진 파일은 다시 선택해주세요.</p>
          <div className={ui.buttonRow}>
            <Button
              type="button"
              disabled={saving}
              onClick={() => {
                try { window.localStorage.removeItem(draftKey) } catch { /* 초안 삭제는 보조 기능이다. */ }
                setDraftOffer(null)
              }}
            >
              새로 시작
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={saving}
              onClick={() => {
                setForm(draftOffer)
                setDraftOffer(null)
              }}
            >
              이어서 쓰기
            </Button>
          </div>
        </div>
      )}

      {notice !== null && <p className={ui.notice} role="status">{notice}</p>}
      {pending !== null && (
        <div className={ui.notice} role="status">
          <p>저장 결과 확인이 필요한 요청이 있어요. 같은 요청으로 확인하면 기록이 중복되지 않아요.</p>
          <Button type="button" disabled={saveState.kind !== 'idle' || !online} onClick={() => void recoverPending()}>저장 결과 확인</Button>
        </div>
      )}
      {conflict !== null && (
        <div className={ui.notice} role="alert">
          <p>다른 곳에서 변경된 기록이 있어요. 내 입력을 보존했어요.</p>
          {conflict === 'unloaded' ? <Button type="button" onClick={() => void previewLatest()}>최신 내용 확인</Button> : <>
            <details open><summary>내 입력과 서버 최신 내용 비교</summary>
              <p>내 입력: {form.visitedOn} · {selectedStation?.name ?? '역 정보 확인 필요'} · 태그 {form.tags.join(', ')} · 사진 {photos.length}장</p>
              <p>감정: {MOODS.find(item => item.slug === form.mood)?.label ?? '선택 없음'} · 날씨: {WEATHERS.find(item => item.slug === form.weather)?.label ?? '선택 없음'}</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{form.note || '일기 없음'}</p>
              <p>서버 최신: {conflict.record.visited_on} · {stationById.get(conflict.record.station_id)?.name ?? '역 정보 확인 필요'} · 태그 {conflict.tags.join(', ')} · 사진 {conflict.photos.length}장</p>
              <p>감정: {MOODS.find(item => item.slug === conflict.record.mood)?.label ?? '선택 없음'} · 날씨: {WEATHERS.find(item => item.slug === conflict.record.weather)?.label ?? '선택 없음'}</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{conflict.record.note || '일기 없음'}</p>
              <ol className={styles.photoGrid} aria-label="서버 최신 사진 순서">
                {latestPhotos.map((photo, index) => <li className={styles.photoItem} key={photo.id}>
                  {photo.kind === 'existing' && photo.url !== null
                    ? <img className={styles.photoThumb} src={photo.url} alt={'서버 사진 ' + (index + 1)} />
                    : <div className={styles.photoFallback}>사진 {index + 1} · 미리보기 없음</div>}
                  <span className={styles.photoBadge}>{index + 1}</span>
                </li>)}
              </ol>
            </details>
            <p>내 입력을 적용하면 사진 목록도 현재 화면의 목록으로 저장해요. 버튼을 누른 뒤 전체 저장으로 확정해주세요.</p>
            <Button type="button" onClick={() => {
              revisionRef.current = conflict.record.revision
              baselineRef.current = snapshotForm(conflict)
              photoBaselineRef.current = conflict.photos.map(photo => photo.id).join(',')
              setConflict(null); setErrorBanner(null); setPhotoError(null)
            }}>내 입력을 최신 버전에 적용</Button>
            <Button type="button" onClick={() => {
              void installSnapshot(conflict).then(() => { if (aliveRef.current) { setConflict(null); setErrorBanner(null); setPhotoError(null) } })
            }}>서버 내용으로 바꾸기</Button>
          </>}
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
          <Button type="button" disabled={saving || !online || preparing > 0 || conflict !== null || needsPhotoSelection} onClick={() => void save(true, photos)}>
            사진 다시 올리기
          </Button>
          {needsPhotoSelection && <Button type="button" onClick={() => { setNeedsPhotoSelection(false); setPhotoError(null) }}>새 사진 없이 계속</Button>}
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
          <Input
            id="visited-on"
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
          <label className={ui.label} htmlFor="place-name">장소 이름 <span className={ui.hint}>선택</span></label>
          <Input id="place-name" value={form.placeName ?? ''} disabled={saving} placeholder="카페 이름이나 산책 장소" onChange={event => setForm(prev => ({ ...prev, placeName: [...event.target.value].slice(0, 80).join('') }))} />
        </div>
        {previousVisits.length > 0 && <details className={ui.hint}><summary>이 역의 지난 기록 {previousVisits.length}건</summary>{previousVisits.map(card => <p key={card.id}>{card.visitedOn} · {card.placeName || card.noteExcerpt || '지난 방문'}</p>)}</details>}
        <PhotoField
          photos={photos}
          onChange={(list) => { setPhotos(list); if (list.some(photo => photo.kind === 'new')) setNeedsPhotoSelection(false) }}
          onPreparingChange={(count) => { preparingRef.current = count; setPreparing(count) }}
          disabled={saving}
          progress={saveState.kind === 'uploading' ? saveState : null}
        />

        <div className={ui.field}>
          <label className={ui.label} htmlFor="note">
            일기
          </label>
          <Textarea
            id="note"
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

        <details className={styles.optionalFields}>
          <summary>감정 · 날씨 · 태그 (선택)</summary>
          <div className={styles.optionalContent}>
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

            <TagField
              tags={form.tags}
              suggestions={suggestions}
              disabled={saving}
              onChange={(tags) => setForm((prev) => ({ ...prev, tags }))}
            />

          </div>
        </details>

        <div className={styles.saveBar}>
          {preparing > 0 && <p className={ui.hint} role="status">사진 {preparing}장 준비 중… 준비가 끝나면 저장할 수 있어요.</p>}
          {!online && <p className={ui.hint}>오프라인이라 저장할 수 없어요.</p>}
          {selectedStation === null && <p className={ui.hint}>역을 선택하면 저장할 수 있어요.</p>}
          <Button type="submit" variant="default" disabled={!canSave}>
            {saveState.kind === 'saving'
              ? '저장하는 중…'
              : saveState.kind === 'uploading'
                ? `사진 올리는 중 ${saveState.done}/${saveState.total}`
                : '저장'}
          </Button>
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
          <p>사진 파일은 초안에 보관하지 않아요. 준비·업로드 중이거나 저장 결과 확인 전이라면 이 화면에서 먼저 마쳐주세요.</p>
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
            recordIdRef.current = crypto.randomUUID()
            revisionRef.current = null
            uploadedRef.current.clear()
            confirmedBodyRef.current = null
            photoBaselineRef.current = ''
            updatePending(null)
            setConflict(null)
            const keptPhotos = photos.filter((photo) => photo.kind === 'new')
            setPhotos(keptPhotos)
            void save(false, keptPhotos)
          }}
          onCancel={() => setDeletedDialog(false)}
        >
          <p>작성 중이던 내용을 새 기록으로 저장할까요?</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
