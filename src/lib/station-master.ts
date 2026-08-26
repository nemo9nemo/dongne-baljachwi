import { supabase } from './supabase'
import { STORAGE_PREFIX } from './app-storage'

/**
 * 역 마스터 로딩 + 로컬 캐시 (02 §6, 03 §4.1).
 *
 * 노선도 진입 시 Supabase 왕복은 **2회**여야 한다 (03 §4.1 쿼리 계약):
 *   1. `app_settings.master_version` — 캐시가 맞으면 여기서 끝
 *   2. `couple_station_visits` (이건 이 모듈이 아니라 화면이 부른다)
 * 마스터 본체(944행)는 버전이 바뀔 때만 내려받는다.
 *
 * 방문 집계는 여기 들어오지 않는다 — 기록 추가 직후 스탬프가 즉시 반영되어야 하므로
 * 캐시 금지다 (03 §4.1).
 */

/** `lines` 한 행. `color_token`은 색상값이 아니라 tokens.css 변수 이름이다 (02 §4.1) */
export type LineRow = {
  /** `station_lines.line_id` 와 잇는 키. 05 F-09(역 검색 결과 호선 배지)에서 쓴다 */
  id: string
  code: string
  name: string
  sort_order: number
  color_token: string
  in_mvp_scope: boolean
  is_active: boolean
}

/** `station_master_public` 한 행 (02 §6) */
export type StationRow = {
  id: string
  code: string
  name: string
  name_short: string
  lat: number
  lng: number
  region_code: string
  is_transfer: boolean
  is_active: boolean
  /** 02 §9(2026-08-25): region_code(서울/인천/경기) 기준 역 단위 MVP 스코프.
   * `lines.in_mvp_scope`(노선 단위 OR 집계)와 달리 1호선·경춘선 같은 혼합 노선의 역외 역을
   * 걸러낼 수 있다. 09 F-09 커버리지 분모·F-14 추천 후보는 이 컬럼을 써야 한다. */
  in_mvp_scope: boolean
}

export type StationMaster = {
  /** `app_settings.master_version` 의 version. 캐시 무효화 키 (02 F-09) */
  version: number
  lines: LineRow[]
  stations: StationRow[]
  /** 서버 버전 확인에 실패해 캐시로 렌더 중인가 (03 §5 오프라인 행) */
  stale: boolean
}

const CACHE_KEY = `${STORAGE_PREFIX}station-master`
/** 캐시 레이아웃이 바뀌면 올린다. 옛 캐시를 파싱하다 죽지 않게 하는 용도.
 * 3 = station_lines에 `seq` 추가 (09 안 가본 역 추천).
 * 4 = stations에 in_mvp_scope 추가. */
const CACHE_SCHEMA = 4

type CachedMaster = { schema: number; version: number; lines: LineRow[]; stations: StationRow[] }

function readCache(): CachedMaster | null {
  const raw = window.localStorage.getItem(CACHE_KEY)
  if (raw === null) return null
  try {
    // localStorage 내용은 외부 입력이나 마찬가지다(다른 탭·이전 버전·사용자 편집).
    // 경계에서 unknown 으로 받아 최소한의 모양만 확인한다.
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const c = parsed as Partial<CachedMaster>
    if (c.schema !== CACHE_SCHEMA) return null
    if (typeof c.version !== 'number') return null
    if (!Array.isArray(c.lines) || !Array.isArray(c.stations)) return null
    if (c.stations.length === 0) return null
    return { schema: c.schema, version: c.version, lines: c.lines, stations: c.stations }
  } catch {
    return null
  }
}

/** PostgREST 는 응답 행 수에 상한(기본 1,000)이 있다. 전국 확장 시 1,073행이라 반드시 넘는다. */
const PAGE = 1000

export async function loadStationMaster(): Promise<StationMaster> {
  const cache = readCache()

  const versionRes = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'master_version')
    .maybeSingle()

  if (versionRes.error !== null) {
    // 캐시가 있으면 화면을 죽이지 않는다 (03 §5 오프라인 행).
    if (cache !== null) {
      return { version: cache.version, lines: cache.lines, stations: cache.stations, stale: true }
    }
    throw versionRes.error
  }

  // jsonb 라 타입이 unknown 이다. 배치가 아직 안 돌았으면 0 (02 마이그레이션 시드값).
  const value = versionRes.data?.value
  const version =
    typeof value === 'object' && value !== null && typeof (value as { version?: unknown }).version === 'number'
      ? (value as { version: number }).version
      : 0

  if (cache !== null && cache.version === version) {
    return { version, lines: cache.lines, stations: cache.stations, stale: false }
  }

  const linesRes = await supabase
    .from('lines')
    .select('id, code, name, sort_order, color_token, in_mvp_scope, is_active')
    .order('sort_order')
    .order('code')
  if (linesRes.error !== null) throw linesRes.error

  const stations: StationRow[] = []
  for (let from = 0; ; from += PAGE) {
    const page = await supabase
      .from('station_master_public')
      .select('id, code, name, name_short, lat, lng, region_code, is_transfer, is_active, in_mvp_scope')
      .order('code')
      .range(from, from + PAGE - 1)
    if (page.error !== null) throw page.error
    stations.push(...page.data)
    if (page.data.length < PAGE) break
  }

  const next: CachedMaster = { schema: CACHE_SCHEMA, version, lines: linesRes.data, stations }
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(next))
  } catch {
    // 용량 초과/사파리 프라이빗 모드. 캐시가 없어도 화면은 동작한다 — 다음 진입에서 다시 받는다.
  }

  return { version, lines: linesRes.data, stations, stale: false }
}

/**
 * `station_lines` 중 소속 관계 + `seq`. 좌표·역번호는 클라이언트가 쓸 일이 없어 받지 않는다.
 * `seq`는 09(프로필)의 안 가본 역 추천이 노선 내 거리를 재는 데 쓴다 (§4.3).
 */
export type StationLineRow = { station_id: string; line_id: string; seq: number }

const LINES_CACHE_KEY = `${STORAGE_PREFIX}station-lines`

type CachedStationLines = { schema: number; version: number; rows: StationLineRow[] }

/**
 * 역 ↔ 호선 소속 관계 (05 F-09 검색 결과 호선 배지).
 *
 * 마스터 본체와 **분리해서 지연 로드**한다. 이 관계는 기록 작성 화면의 역 검색에서만
 * 필요한데, `loadStationMaster`에 합치면 앱의 기본 화면인 노선도가 진입할 때마다
 * 안 쓰는 1,000행대 페이로드를 함께 받게 된다 (02 §6의 전송량 예산).
 *
 * 캐시 무효화 키는 마스터와 같은 `master_version`이다 — 배치가 역을 재적재하면
 * 소속 관계도 함께 바뀌기 때문이다.
 *
 * @param version {@link loadStationMaster}가 돌려준 마스터 버전
 */
export async function loadStationLines(version: number): Promise<StationLineRow[]> {
  const raw = window.localStorage.getItem(LINES_CACHE_KEY)
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        const c = parsed as Partial<CachedStationLines>
        if (c.schema === CACHE_SCHEMA && c.version === version && Array.isArray(c.rows)) {
          return c.rows
        }
      }
    } catch {
      // 깨진 캐시는 무시하고 새로 받는다.
    }
  }

  const rows: StationLineRow[] = []
  for (let from = 0; ; from += PAGE) {
    const page = await supabase
      .from('station_lines')
      .select('station_id, line_id, seq')
      .order('station_id')
      .range(from, from + PAGE - 1)
    if (page.error !== null) throw page.error
    rows.push(...page.data)
    if (page.data.length < PAGE) break
  }

  try {
    const next: CachedStationLines = { schema: CACHE_SCHEMA, version, rows }
    window.localStorage.setItem(LINES_CACHE_KEY, JSON.stringify(next))
  } catch {
    // 캐시 실패는 기능에 영향이 없다.
  }
  return rows
}
