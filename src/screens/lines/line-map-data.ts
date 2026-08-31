import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../../auth/session-context'
import { supabase } from '../../lib/supabase'
import { screenCache, scopeToCouple } from '../../lib/screen-cache'
import type { VisitRow } from '../../lib/screen-cache'
import { loadStationMaster } from '../../lib/station-master'
import type { StationMaster } from '../../lib/station-master'

/**
 * 노선도(03)·지도 보기(07)·역 상세(04)·프로필(09)이 공유하는 마스터/방문 집계 로더.
 *
 * 07 §4.1의 요구사항이 이 파일의 존재 이유다: "노선도 → 지도 전환 시 네트워크 요청 0회".
 * `loadStationMaster()`는 캐시가 맞아도 버전 확인 왕복은 한다 — 그래서 화면이 그걸 또
 * 부르면 매번 요청이 나간다. 여기서는 **모듈 스코프 캐시**로 한 번 받은 값을 세션 동안
 * 재사용해서, 같은 값을 원하는 두 번째 화면은 아예 호출하지 않는다.
 *
 * 04(역 상세)도 이 훅의 `master`를 그대로 쓴다 — 노선도에서 역을 탭해 들어오면 헤더가
 * 네트워크 대기 없이 즉시 뜬다(04 §6 "첫 픽셀").
 *
 * 마스터는 여기 모듈 변수에, **방문 집계는 `lib/screen-cache.ts`에** 둔다. 마스터는 전원
 * 공개 데이터라 계정이 바뀌어도 유효하지만, 방문 집계는 커플 소유 데이터라 로그아웃·해제·
 * 기록 변경 시 반드시 버려져야 하기 때문이다(01 AC-15, 05 AC-18, 09 AC-19).
 */

/** 이 훅이 돌려주는 방문 집계 행. 정의는 캐시 보관소에 있다 */
export type { VisitRow } from '../../lib/screen-cache'

type MasterState =
  | { kind: 'loading' }
  | { kind: 'ready'; master: StationMaster }
  | { kind: 'failed' }

type VisitState =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: VisitRow[] }
  | { kind: 'failed' }

let cachedMaster: StationMaster | null = null

export function useLineMapData() {
  const session = useSession()
  const coupleId = session.couple?.id ?? null
  // 캐시를 읽기 **전에** 소유자를 맞춘다. 남의 집계를 되쓰면 스탬프가 다른 커플 것으로 뜬다.
  // 비교 한 번이라 렌더 경로에서 불러도 비용이 없다.
  scopeToCouple(coupleId)

  const [master, setMaster] = useState<MasterState>(
    cachedMaster !== null ? { kind: 'ready', master: cachedMaster } : { kind: 'loading' },
  )
  const [visits, setVisits] = useState<VisitState>(
    screenCache.visits !== null ? { kind: 'ready', rows: screenCache.visits } : { kind: 'loading' },
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
    if (!force && screenCache.visits !== null) {
      setVisits({ kind: 'ready', rows: screenCache.visits })
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
        screenCache.visits = data
        setVisits({ kind: 'ready', rows: data })
      })
  }, [])

  useEffect(() => loadMaster(), [loadMaster])
  // 커플이 바뀌면 scopeToCouple이 캐시를 비운 상태라 여기서 자동으로 다시 받는다.
  useEffect(() => loadVisits(), [loadVisits, coupleId])

  return {
    master,
    visits,
    reloadMaster: () => loadMaster(true),
    reloadVisits: () => loadVisits(true),
  }
}
