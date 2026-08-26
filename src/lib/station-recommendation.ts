import type { LineRow, StationLineRow, StationRow } from './station-master'

/**
 * 안 가본 역 추천 (`docs/specs/09-couple-profile.md` §3.3/§4.3).
 *
 * 서버가 아니라 여기서 계산한다 — 마스터·방문 목록을 이미 클라이언트가 캐시로 들고 있어서
 * 추가 왕복이 0회이고, 규칙을 바꿀 때 마이그레이션이 아니라 배포 하나로 끝난다(§4.3 표).
 */

export type RecommendedStation = {
  stationId: string
  name: string
  /** F-20: 소속 호선(동명 노선은 한 번만) */
  lines: { code: string; name: string; colorToken: string }[]
}

type StationLineLink = { lineId: string; seq: number }

type Options = {
  stations: StationRow[]
  lines: LineRow[]
  stationLines: StationLineRow[]
  /** `couple_station_visits`의 station_id 집합 */
  visitedStationIds: ReadonlySet<string>
  /** F-17: `couple_id + 오늘 날짜(KST)`. 같은 시드면 항상 같은 결과 */
  seed: string
  count?: number
  maxPerLine?: number
}

const DEFAULT_COUNT = 4
/** F-18 */
const DEFAULT_MAX_PER_LINE = 2

/** FNV-1a. 시드 문자열을 32비트 정수로 접는다 — 암호학적 용도가 아니라 결정론적 셔플용. */
function hashString(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — 시드 하나로 재현 가능한 [0,1) 난수열을 만드는 작고 흔한 PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a === undefined || b === undefined) continue
    copy[i] = b
    copy[j] = a
  }
  return copy
}

export function recommendStations(options: Options): RecommendedStation[] {
  const count = options.count ?? DEFAULT_COUNT
  const maxPerLine = options.maxPerLine ?? DEFAULT_MAX_PER_LINE
  const rng = mulberry32(hashString(options.seed))

  const stationById = new Map(options.stations.map((s) => [s.id, s]))
  const lineById = new Map(options.lines.map((l) => [l.id, l]))

  const linksByStation = new Map<string, StationLineLink[]>()
  for (const link of options.stationLines) {
    const station = stationById.get(link.station_id)
    // F-14(02 §9 2026-08-25 정정): 후보는 station.in_mvp_scope && is_active 인 역만 본다.
    // 노선 단위 lines.in_mvp_scope(OR 집계)로 걸렀던 이전 방식은 1호선·경춘선 같은 혼합
    // 노선에서 역외 역(충남 3역·강원 경춘선 6역)까지 후보로 새어 들어갔다.
    if (station === undefined || !station.is_active || !station.in_mvp_scope) continue
    const list = linksByStation.get(link.station_id)
    if (list === undefined) linksByStation.set(link.station_id, [{ lineId: link.line_id, seq: link.seq }])
    else list.push({ lineId: link.line_id, seq: link.seq })
  }

  const candidateIds = [...linksByStation.keys()].filter((id) => !options.visitedStationIds.has(id))

  function badgesOf(stationId: string): RecommendedStation['lines'] {
    const seen = new Set<string>()
    const badges: RecommendedStation['lines'] = []
    for (const link of linksByStation.get(stationId) ?? []) {
      const line = lineById.get(link.lineId)
      if (line === undefined || seen.has(line.name)) continue
      seen.add(line.name)
      badges.push({ code: line.code, name: line.name, colorToken: line.color_token })
    }
    return badges
  }

  function toResult(stationId: string): RecommendedStation {
    return { stationId, name: stationById.get(stationId)?.name ?? '', lines: badgesOf(stationId) }
  }

  // F-16: 기록이 0건이면 ①②(거리)를 적용할 수 없다 — 후보 전체에서 시드 무작위.
  if (options.visitedStationIds.size === 0) {
    const shuffled = seededShuffle(candidateIds, rng)
    return applyPerLineCap(
      shuffled.map((id) => ({ id, lineId: linksByStation.get(id)?.[0]?.lineId })),
      maxPerLine,
      count,
    ).map(toResult)
  }

  // 노선별로, 그 노선에 있는 방문 역들의 seq 목록 (F-15 ①②의 입력)
  const visitedSeqByLine = new Map<string, number[]>()
  for (const stationId of options.visitedStationIds) {
    for (const link of linksByStation.get(stationId) ?? []) {
      const list = visitedSeqByLine.get(link.lineId)
      if (list === undefined) visitedSeqByLine.set(link.lineId, [link.seq])
      else list.push(link.seq)
    }
  }

  // 후보마다 (최소 거리, 그 거리를 만든 노선)을 구한다. 여러 노선에 걸치면 최솟값을 쓴다(§4.3-5).
  const scored = candidateIds.map((id) => {
    let distance = Infinity
    let bestLineId: string | undefined
    for (const link of linksByStation.get(id) ?? []) {
      const visitedSeqs = visitedSeqByLine.get(link.lineId)
      if (visitedSeqs === undefined) continue
      for (const seq of visitedSeqs) {
        const d = Math.abs(seq - link.seq)
        if (d < distance) {
          distance = d
          bestLineId = link.lineId
        }
      }
    }
    return { id, lineId: bestLineId, distance, tie: rng() }
  })

  // 거리 오름차순, 동률은 시드 무작위(F-15 ③)
  scored.sort((a, b) => a.distance - b.distance || a.tie - b.tie)

  return applyPerLineCap(scored, maxPerLine, count).map(toResult)
}

/** F-18: 같은(대표) 노선에서 최대 `maxPerLine`개까지만 채택한다. 상한 때문에 목표 개수를
 *  못 채우면 상한을 풀고 남은 후보로 채운다 — 추천 자체가 없는 것보다 낫다. */
function applyPerLineCap(
  ordered: { id: string; lineId: string | undefined }[],
  maxPerLine: number,
  count: number,
): string[] {
  const perLine = new Map<string, number>()
  const picked: string[] = []
  const overflow: string[] = []

  for (const item of ordered) {
    if (picked.length >= count) break
    const used = item.lineId === undefined ? 0 : (perLine.get(item.lineId) ?? 0)
    if (item.lineId !== undefined && used >= maxPerLine) {
      overflow.push(item.id)
      continue
    }
    picked.push(item.id)
    if (item.lineId !== undefined) perLine.set(item.lineId, used + 1)
  }

  for (const id of overflow) {
    if (picked.length >= count) break
    picked.push(id)
  }

  return picked
}
