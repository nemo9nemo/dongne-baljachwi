import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatVisitedOn } from '../../lib/format-date'
import { loadKakaoMapsSdk } from '../../lib/kakao-maps'
import type { KakaoCustomOverlay, KakaoMap, KakaoMarkerClusterer } from '../../lib/kakao-maps'
import { useLineMapData } from './line-map-data'
import lineMapStyles from './line-map.module.css'
import styles from './map-view.module.css'
import ui from '../../styles/ui.module.css'

/**
 * 지도 보기 (`docs/specs/07-map-view.md`). 노선도 헤더 토글의 다른 표현이다 — 독립 화면이
 * 아니라 **같은 데이터를 실제 지리 위에 다시 그리는 보조 뷰**다(§1).
 *
 * 마스터·방문 집계는 `useLineMapData()`로 노선도와 공유한다. 전환 시 네트워크 요청이
 * 0회여야 한다는 §4.1 요구사항이 이 훅의 존재 이유다 — 노선도를 먼저 거쳐 왔다면
 * (앱 기본 화면이 노선도이므로 항상 그렇다) 여기서는 캐시를 그대로 쓴다.
 *
 * 이번 라운드에 없는 것:
 * - **좌표 없는 기록 안내(§5 "지도에 표시할 수 없는 기록 N건")**: `station_master_public`의
 *   `lat`/`lng`는 스키마상 NOT NULL이라 실무에서 거의 발생하지 않는 경로다. 방어적으로
 *   필터만 하고 별도 안내 UI는 만들지 않았다.
 * - **클러스터링 임계 레벨(§9 미결정)**: 카카오맵 예제 기본값(6)을 임시로 둔다.
 */

/**
 * F-12 / AC-16: 지도 뷰포트 보존소.
 *
 * 노선도와 **독립적으로** 기억한다 — 좌표계가 다르므로 서로 변환하지 않는다(F-12).
 * 노선도 쪽(`LineMapScreen.tsx`의 `savedViewport`)과 같은 이유로 모듈 스코프다:
 * 토글로 노선도에 갔다 오면 이 컴포넌트는 언마운트되고 state·ref 는 모두 사라진다.
 * 새로고침까지 살릴 필요는 없어 sessionStorage 로 올리지 않는다 (AC-17 — 명세 동작이다).
 * 지도에는 호선 필터가 없으므로(F-13) 노선도와 달리 필터 일치 조건도 없다.
 */
let savedMapViewport: { lat: number; lng: number; level: number } | null = null

/** §2.2/AC-08: 기록 0건일 때의 폴백 뷰 */
const SEOUL_CITY_HALL = { lat: 37.5665, lng: 126.978 }
const EMPTY_VIEW_LEVEL = 8
/** F-06: 핀이 1개뿐이면 bounds 대신 이 레벨로 센터링한다(과도하게 확대되는 것 방지) */
const SINGLE_PIN_LEVEL = 5
/** §9 미결정 — 카카오맵 예제가 흔히 쓰는 값을 임시로 둔다 */
const CLUSTER_MIN_LEVEL = 6

type Pin = { stationId: string; name: string; lat: number; lng: number; visitCount: number; lastVisitedOn: string }

type SdkState = 'loading' | 'ready' | 'failed'

export function MapViewScreen() {
  const navigate = useNavigate()
  const { master, visits, reloadVisits } = useLineMapData()

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<KakaoMap | null>(null)
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null)
  const overlayRef = useRef<KakaoCustomOverlay | null>(null)
  const [sdkState, setSdkState] = useState<SdkState>('loading')
  // F-12 > F-06 (AC-16): 이 마운트가 "복원된" 마운트인지. 첫 렌더 시점의 보존값 유무로
  // 한 번만 정한다. 아래 마커 effect 의 자동 bounds 맞춤을 막는 데 쓴다 — 복원해 놓고
  // 곧바로 전체 핀에 맞춰버리면 복원한 의미가 없다.
  const restoredRef = useRef(savedMapViewport !== null)

  const masterData = master.kind === 'ready' ? master.master : null

  const pins = useMemo<Pin[]>(() => {
    if (masterData === null || visits.kind !== 'ready') return []
    const stationById = new Map(masterData.stations.map((s) => [s.id, s]))
    const list: Pin[] = []
    for (const row of visits.rows) {
      if (row.visit_count <= 0) continue
      const station = stationById.get(row.station_id)
      // 방어적 필터: 마스터 캐시가 갱신 중이면 방문 집계가 아는 station_id가 아직 마스터에
      // 없을 수 있다(둘이 별도 요청이라 도착 순서가 보장되지 않는다).
      if (station === undefined) continue
      list.push({
        stationId: row.station_id,
        name: station.name,
        lat: station.lat,
        lng: station.lng,
        visitCount: row.visit_count,
        lastVisitedOn: row.last_visited_on,
      })
    }
    return list
  }, [masterData, visits])

  // §2.2: SDK 로드 실패(키/도메인 오류 포함)는 노선도로 자동 복귀 + 토스트. 빈 화면을 남기지 않는다.
  useEffect(() => {
    if (masterData === null) return
    const container = containerRef.current
    if (container === null) return

    let cancelled = false
    void loadKakaoMapsSdk().then(
      (kakao) => {
        if (cancelled) return
        // F-12 > F-06·F-07: 보존된 뷰포트가 있으면 핀 bounds(F-06)든 기록 0건 기본 뷰
        // (F-07)든 초기화보다 복원이 우선이다. 생성 후
        // setCenter/setLevel 로 옮기지 않고 생성 옵션으로 주는 이유는, 옮기는 방식이면
        // 기본 위치가 한 프레임 보였다가 튀기 때문이다.
        const saved = savedMapViewport
        const center =
          saved !== null
            ? new kakao.LatLng(saved.lat, saved.lng)
            : pins.length === 0
              ? new kakao.LatLng(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lng)
              : new kakao.LatLng(pins[0]!.lat, pins[0]!.lng)
        const map = new kakao.Map(container, {
          center,
          level:
            saved !== null
              ? saved.level
              : pins.length === 0
                ? EMPTY_VIEW_LEVEL
                : SINGLE_PIN_LEVEL,
        })
        mapRef.current = map
        clustererRef.current = new kakao.MarkerClusterer({
          map,
          averageCenter: true,
          minLevel: CLUSTER_MIN_LEVEL,
        })
        kakao.event.addListener(map, 'click', () => {
          overlayRef.current?.setMap(null)
          overlayRef.current = null
        })
        setSdkState('ready')
      },
      (error: unknown) => {
        if (cancelled) return
        console.error('[map-view] 카카오맵 SDK 로드 실패', error)
        setSdkState('failed')
        navigate('/lines', { replace: true, state: { toast: '지도를 불러오지 못했어요' } })
      },
    )
    return () => {
      cancelled = true
    }
    // pins는 최초 센터링에만 쓴다(마운트 1회, 의존성에서 의도적으로 뺀다). 방문이 갱신될
    // 때마다 지도 인스턴스를 다시 만들지 않는다 — 아래 별도 effect가 마커만 갱신한다.
  }, [masterData, navigate])

  /**
   * F-12 / AC-16: 화면을 떠날 때 지도 뷰포트를 1회 읽어 보존한다.
   *
   * 카카오맵의 center/level 은 SDK 인스턴스 내부 상태라 React 렌더와 무관하다 —
   * 'center_changed' 를 구독해 매번 저장할 이유가 없고, 팬 중에 저장하면 그만큼
   * 이벤트 핸들러만 늘어난다. 언마운트 시 1회로 충분하다.
   */
  useEffect(
    () => () => {
      const map = mapRef.current
      if (map === null) return
      const center = map.getCenter()
      savedMapViewport = { lat: center.getLat(), lng: center.getLng(), level: map.getLevel() }
    },
    [],
  )

  // ── 마커/클러스터 갱신 (F-06/F-08) ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const clusterer = clustererRef.current
    if (map === null || clusterer === null || sdkState !== 'ready') return
    const kakao = window.kakao
    if (kakao === undefined) return

    clusterer.clear()
    if (pins.length === 0) return

    const bounds = new kakao.maps.LatLngBounds()
    const markers = pins.map((pin) => {
      const position = new kakao.maps.LatLng(pin.lat, pin.lng)
      bounds.extend(position)
      const marker = new kakao.maps.Marker({ position })
      kakao.maps.event.addListener(marker, 'click', () => {
        overlayRef.current?.setMap(null)
        const content = buildOverlayContent(pin, () => navigate(`/stations/${pin.stationId}`))
        const overlay = new kakao.maps.CustomOverlay({ position, content, yAnchor: 1.3, zIndex: 3 })
        overlay.setMap(map)
        overlayRef.current = overlay
      })
      return marker
    })
    clusterer.addMarkers(markers)

    // F-06: 핀 1개면 이미 SINGLE_PIN_LEVEL로 센터링돼 있으니 bounds로 다시 맞추지 않는다.
    // F-12 > F-06 (AC-16): 복원된 마운트에서는 아예 맞추지 않는다. 이 effect 는 방문 집계가
    // 갱신될 때도 도므로, 조건을 "첫 실행"으로 두면 나중 갱신에 사용자가 잡아둔 화면이 튄다.
    //
    // 07 §9 미결정: 복원된 뷰포트에 핀이 하나도 없으면(핀에서 멀리 떨어진 곳을 보다 나갔다
    // 돌아온 경우) 빈 지도가 그대로 복원되고, 노선도의 F-22 같은 "전체 핀 보기" 탈출구가
    // 지도에는 없다. 의도적으로 처리하지 않은 케이스 — 버튼을 둘지 결정되면 여기에 붙인다.
    if (pins.length > 1 && !restoredRef.current) map.setBounds(bounds)
  }, [pins, sdkState, navigate])

  const showEmpty = sdkState === 'ready' && pins.length === 0

  return (
    <div className={lineMapStyles.screen}>
      <header className={lineMapStyles.header}>
        <h1 className={lineMapStyles.title}>지도</h1>
        <div className={lineMapStyles.headerControls}>
          {/* F-13: 지도 보기에는 호선 필터를 두지 않는다 */}
          <Link className={lineMapStyles.toggleLink} to="/lines">
            노선도 보기
          </Link>
        </div>
      </header>

      {master.kind === 'failed' && (
        <div className={lineMapStyles.banner} role="alert">
          <span>역 정보를 불러오지 못했습니다.</span>
        </div>
      )}

      {visits.kind === 'failed' && (
        <div className={lineMapStyles.banner} role="alert">
          <span>방문 정보를 불러오지 못했어요.</span>
          <button type="button" className={lineMapStyles.bannerButton} onClick={reloadVisits}>
            다시 시도
          </button>
        </div>
      )}

      {/* §6 접근성: 지도는 시각적 매체다. 동일 정보에 도달하는 대체 경로(타임라인)를 안내한다. */}
      {sdkState === 'ready' && (
        <p className={ui.hint}>
          기록이 있는 역 {pins.length}곳이 지도에 표시됨. 목록으로 보려면{' '}
          <Link to="/timeline">타임라인</Link>을 이용하세요.
        </p>
      )}

      <div className={lineMapStyles.canvasWrap}>
        {master.kind === 'loading' && <div className={lineMapStyles.skeleton} aria-hidden="true" />}
        {master.kind === 'ready' && sdkState === 'loading' && (
          <div className={lineMapStyles.skeleton} aria-hidden="true" />
        )}
        <div ref={containerRef} className={styles.mapDiv} />

        {showEmpty && (
          <div className={styles.emptyOverlay}>
            <p>기록을 남기면 여기에 표시돼요.</p>
            <Link to="/lines" className={`${ui.button} ${ui.buttonPrimary}`}>
              노선도로 가기
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

/** 핀 정보창(F-05). 카카오 CustomOverlay는 순수 DOM을 받으므로 여기만 명령형이다 */
function buildOverlayContent(pin: Pin, onOpen: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = styles.overlay

  const title = document.createElement('p')
  title.className = styles.overlayTitle
  title.textContent = pin.name
  el.append(title)

  const meta = document.createElement('p')
  meta.className = styles.overlayMeta
  meta.textContent = `방문 ${pin.visitCount}회 · 마지막 ${formatVisitedOn(pin.lastVisitedOn).dateLabel}`
  el.append(meta)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = styles.overlayButton
  button.textContent = '역 상세 보기'
  button.addEventListener('click', onOpen)
  el.append(button)

  return el
}
