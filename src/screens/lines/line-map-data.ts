import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadStationMaster } from '../../lib/station-master'
import type { StationMaster } from '../../lib/station-master'

/**
 * 노선도(03)·지도 보기(07)·역 상세(04)가 공유하는 마스터/방문 집계 로더.
 *
 * 07 §4.1의 요구사항이 이 파일의 존재 이유다: "노선도 → 지도 전환 시 네트워크 요청 0회".
 * `loadStationMaster()`는 캐시가 맞아도 버전 확인 왕복은 한다 — 그래서 화면이 그걸 또
 * 부르면 매번 요청이 나간다. 여기서는 **모듈 스코프 캐시**로 한 번 받은 값을 세션 동안
 * 재사용해서, 같은 값을 원하는 두 번째 화면은 아예 호출하지 않는다.
 *
 * 04(역 상세)도 이 훅의 `master`를 그대로 쓴다 — 노선도에서 역을 탭해 들어오면 헤더가
 * 네트워크 대기 없이 즉시 뜬다(04 §6 "첫 픽셀").
 */

export type VisitRow = { station_id: string; visit_count: number; last_visited_on: string }

type MasterState =
  | { kind: 'loading' }
  | { kind: 'ready'; master: StationMaster }
  | { kind: 'failed' }

type VisitState =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: VisitRow[] }
  | { kind: 'failed' }

let cachedMaster: StationMaster | null = null
let cachedVisits: VisitRow[] | null = null

export function useLineMapData() {
  const [master, setMaster] = useState<MasterState>(
    cachedMaster !== null ? { kind: 'ready', master: cachedMaster } : { kind: 'loading' },
  )
  const [visits, setVisits] = useState<VisitState>(
    cachedVisits !== null ? { kind: 'ready', rows: cachedVisits } : { kind: 'loading' },
  )

  const loadMaster = useCallback((force = false) => {
    if (!force && cachedMaster !== null) {
      setMaster({ kind: 'ready', master: cachedMaster })
      return
    }
    setMaster({ kind: 'loading' })
    loadStationMaster().then(
      (m) => {
        cachedMaster = m
        setMaster({ kind: 'ready', master: m })
      },
      () => setMaster({ kind: 'failed' }),
    )
  }, [])

  const loadVisits = useCallback((force = false) => {
    if (!force && cachedVisits !== null) {
      setVisits({ kind: 'ready', rows: cachedVisits })
      return
    }
    setVisits({ kind: 'loading' })
    // RLS(security_invoker 뷰)가 내 커플 행만 돌려준다 — 클라이언트가 couple_id 를 걸지 않는다.
    supabase
      .from('couple_station_visits')
      .select('station_id, visit_count, last_visited_on')
      .then(({ data, error }) => {
        if (error !== null || data === null) {
          setVisits({ kind: 'failed' })
          return
        }
        cachedVisits = data
        setVisits({ kind: 'ready', rows: data })
      })
  }, [])

  useEffect(() => loadMaster(), [loadMaster])
  useEffect(() => loadVisits(), [loadVisits])

  return {
    master,
    visits,
    reloadMaster: () => loadMaster(true),
    reloadVisits: () => loadVisits(true),
  }
}
