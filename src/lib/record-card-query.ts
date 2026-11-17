import { supabase } from './supabase'
import { signThumbnailUrls } from './photo-storage'
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
  placeName?: string | null
  id: string
  stationId: string
  /** `YYYY-MM-DD` */
  visitedOn: string
  mood: Mood | null
  weather: Weather | null
  /** 04 §4.1: 일기 앞 200자. 절단은 `record_cards` 뷰(`left(note, 200)`)가 하므로
   *  네트워크·캐시에 전문이 실리지 않는다. 전문이 필요하면 06이 `records`를 단건 조회한다. */
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

export type FetchOptions = {
  query?: string | null
  start?: string | null
  end?: string | null
  jump?: string | null
  /** 08 F-19: 매칭은 tag_norm 기준(대소문자 무시) */
  tagNorm?: string | null
  /** 04가 이 모듈을 쓸 때 걸 필터. 08은 쓰지 않는다 */
  stationId?: string | null
  cursor?: CardCursor | null
}

/** `(visited_on, id) < (cursor)` — `ORDER BY visited_on DESC, id DESC` 키셋 조건 (F-04) */
export async function fetchRecordCardPage(options: FetchOptions): Promise<RecordCardPage> {
  const tagNorm = options.tagNorm ?? null
  const stationId = options.stationId ?? null
  const cursor = options.cursor ?? null

  // D10: 서버에서 태그 EXISTS·검색·기간·키셋을 함께 적용하고 일기 발췌문만 반환한다.
  const recordsRes = await supabase.rpc('query_record_cards', {
    p_query: options.query ?? null, p_station_id: stationId, p_tag_norm: tagNorm,
    p_start: options.start ?? null, p_end: options.end ?? null, p_jump: options.jump ?? null,
    p_cursor_date: cursor?.visitedOn ?? null, p_cursor_id: cursor?.id ?? null, p_limit: PAGE_SIZE + 1,
  })
  if (recordsRes.error !== null) throw recordsRes.error

  if (!Array.isArray(recordsRes.data)) throw new Error('기록 목록 응답을 확인하지 못했어요.')
  const hasMore = recordsRes.data.length > PAGE_SIZE
  const rows = recordsRes.data.slice(0, PAGE_SIZE)
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
  // 스펙 이상이지만(§6), 페이지당 최대 20장이라 한 번에 발급해도 비용이 작다.
  // 원본이 아니라 **카드 폭에 맞춰 축소된 변환 이미지**를 요청한다 (04 §6).
  const coverOf = (recordId: string): PhotoRow | null => {
    const photos = photosByRecord.get(recordId)
    if (photos === undefined || photos.length === 0) return null
    return photos.reduce((min, p) => (p.sort_order < min.sort_order ? p : min))
  }
  const coverPaths = ids.map(coverOf).filter((p): p is PhotoRow => p !== null).map((p) => p.storage_path)
  const signed = await signThumbnailUrls(coverPaths)

  const cards: RecordCard[] = rows.map((row) => {
    const tags = tagsByRecord.get(row.id) ?? []
    const cover = coverOf(row.id)
    return {
      id: row.id,
      stationId: row.station_id,
      visitedOn: row.visited_on,
      mood: row.mood,
      weather: row.weather,
      noteExcerpt: row.note_excerpt,
      placeName: row.place_name,
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
    hasMore,
  }
}
