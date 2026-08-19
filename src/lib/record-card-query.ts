import { supabase } from './supabase'
import { signPhotoUrls } from './photo-storage'
import type { Mood, Weather } from './database.types'

/**
 * `RecordCard` 조회 (04-station-detail.md §4.1, §7 "타임라인이 그대로 재사용"의 계약).
 *
 * 04(역 상세)는 아직 화면이 없지만, 08(타임라인)이 먼저 이 shape가 필요해져 여기서
 * 미리 공용으로 뽑아 둔다. 04가 만들어지면 `stationId` 옵션으로 필터만 걸면 된다 —
 * 카드 표현이 갈라지지 않는 게 두 스펙의 명시적 요구사항이다.
 *
 * 이 프로젝트는 아직 PostgREST 임베드 조회(`select('a, b(c)')`)를 쓰지 않는다
 * (`database.types.ts` 상단 주석). 그래서 본문 → 태그/사진을 `.in(record_id, ids)`
 * 2회로 나눠 받고 클라이언트에서 합친다 — 페이지당 20건이라 N+1이 아니라 상수 3회다.
 */

const PAGE_SIZE = 20

export type RecordCard = {
  id: string
  stationId: string
  /** `YYYY-MM-DD` */
  visitedOn: string
  mood: Mood | null
  weather: Weather | null
  /** 04 §4.1: 원래는 서버가 앞 200자만 보내야 하지만, 전용 뷰 없이는 PostgREST가 자를
   *  방법이 없어 전문을 받아 클라이언트에서 자른다 (알려진 단순화 — 전용 뷰는 별도 작업). */
  noteExcerpt: string | null
  authorId: string
  photoCount: number
  coverPhoto: { storagePath: string; width: number; height: number; url: string | null } | null
  /** F-11: 최대 3개 */
  tags: string[]
  totalTagCount: number
}

export type CardCursor = { visitedOn: string; id: string }

export type RecordCardPage = {
  cards: RecordCard[]
  nextCursor: CardCursor | null
  hasMore: boolean
}

type FetchOptions = {
  /** 08 F-19: 매칭은 tag_norm 기준(대소문자 무시) */
  tagNorm?: string | null
  /** 04가 이 모듈을 쓸 때 걸 필터. 08은 쓰지 않는다 */
  stationId?: string | null
  cursor?: CardCursor | null
}

/** `(visited_on, id) < (cursor)` — `ORDER BY visited_on DESC, id DESC` 키셋 조건 (F-04) */
function cursorFilter(cursor: CardCursor): string {
  return `visited_on.lt.${cursor.visitedOn},and(visited_on.eq.${cursor.visitedOn},id.lt.${cursor.id})`
}

export async function fetchRecordCardPage(options: FetchOptions): Promise<RecordCardPage> {
  const tagNorm = options.tagNorm ?? null
  const stationId = options.stationId ?? null
  const cursor = options.cursor ?? null

  // 태그 필터가 있으면 후보 record_id를 먼저 구한다. couple_tag_usage.usage_count로
  // 이미 규모가 짐작되는 값이라(수백 건 이하) id만 받는 이 조회는 가볍다.
  let candidateIds: string[] | null = null
  if (tagNorm !== null) {
    const tagRes = await supabase.from('record_tags').select('record_id').eq('tag_norm', tagNorm)
    if (tagRes.error !== null) throw tagRes.error
    candidateIds = (tagRes.data ?? []).map((row) => row.record_id)
    if (candidateIds.length === 0) return { cards: [], nextCursor: null, hasMore: false }
  }

  let query = supabase
    .from('records')
    .select('id, station_id, visited_on, mood, weather, note, author_id')

  if (stationId !== null) query = query.eq('station_id', stationId)
  if (candidateIds !== null) query = query.in('id', candidateIds)
  if (cursor !== null) query = query.or(cursorFilter(cursor))

  const recordsRes = await query
    .order('visited_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE)
  if (recordsRes.error !== null) throw recordsRes.error

  const rows = recordsRes.data ?? []
  if (rows.length === 0) return { cards: [], nextCursor: null, hasMore: false }
  const ids = rows.map((row) => row.id)

  const [tagRes, photoRes] = await Promise.all([
    supabase.from('record_tags').select('record_id, tag').in('record_id', ids),
    supabase
      .from('record_photos')
      .select('record_id, storage_path, sort_order, width, height')
      .in('record_id', ids),
  ])
  if (tagRes.error !== null) throw tagRes.error
  if (photoRes.error !== null) throw photoRes.error

  const tagsByRecord = new Map<string, string[]>()
  for (const row of tagRes.data ?? []) {
    const list = tagsByRecord.get(row.record_id)
    if (list === undefined) tagsByRecord.set(row.record_id, [row.tag])
    else list.push(row.tag)
  }

  type PhotoRow = { storage_path: string; sort_order: number; width: number; height: number }
  const photosByRecord = new Map<string, PhotoRow[]>()
  for (const row of photoRes.data ?? []) {
    const list = photosByRecord.get(row.record_id)
    if (list === undefined) photosByRecord.set(row.record_id, [row])
    else list.push(row)
  }

  // F-04: 대표 사진 = sort_order가 가장 작은 사진. 뷰포트에 들어온 카드만 서명하는 게
  // 스펙 이상이지만(§6), 페이지당 최대 20장이라 한 번에 배치 서명해도 비용이 작다
  // (05/06 화면도 같은 단순화를 쓴다).
  const coverOf = (recordId: string): PhotoRow | null => {
    const photos = photosByRecord.get(recordId)
    if (photos === undefined || photos.length === 0) return null
    return photos.reduce((min, p) => (p.sort_order < min.sort_order ? p : min))
  }
  const coverPaths = ids.map(coverOf).filter((p): p is PhotoRow => p !== null).map((p) => p.storage_path)
  const signed = await signPhotoUrls(coverPaths)

  const cards: RecordCard[] = rows.map((row) => {
    const tags = tagsByRecord.get(row.id) ?? []
    const cover = coverOf(row.id)
    return {
      id: row.id,
      stationId: row.station_id,
      visitedOn: row.visited_on,
      mood: row.mood,
      weather: row.weather,
      noteExcerpt: row.note === null ? null : row.note.slice(0, 200),
      authorId: row.author_id,
      photoCount: photosByRecord.get(row.id)?.length ?? 0,
      coverPhoto:
        cover === null
          ? null
          : {
              storagePath: cover.storage_path,
              width: cover.width,
              height: cover.height,
              url: signed.get(cover.storage_path) ?? null,
            },
      tags: tags.slice(0, 3),
      totalTagCount: tags.length,
    }
  })

  const last = rows[rows.length - 1]
  return {
    cards,
    nextCursor: last === undefined ? null : { visitedOn: last.visited_on, id: last.id },
    // 정확히 PAGE_SIZE개가 왔으면 다음 페이지가 있다고 가정한다. 틀려도 빈 응답 1회로
    // 끝난다 — offset 방식과 달리 틀린 추정의 비용이 요청 1회뿐이다.
    hasMore: rows.length === PAGE_SIZE,
  }
}
