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
 * - **뷰포트 상태 보존(F-12)**: 노선도 쪽부터가 아직 미구현이다(`LineMapScreen.tsx` 상단
 *   주석 "미구현: AC-08"). 지도 쪽만 먼저 만들면 반쪽짜리 복원이 되므로 함께 다음 라운드로 미룬다.
 * - **좌표 없는 기록 안내(§5 "지도에 표시할 수 없는 기록 N건")**: `station_master_public`의
 *   `lat`/`lng`는 스키마상 NOT NULL이라 실무에서 거의 발생하지 않는 경로다. 방어적으로
 *   필터만 하고 별도 안내 UI는 만들지 않았다.
 * - **클러스터링 임계 레벨(§9 미결정)**: 카카오맵 예제 기본값(6)을 임시로 둔다.
 */

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
        const center =
          pins.length === 0
            ? new kakao.LatLng(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lng)
            : new kakao.LatLng(pins[0]!.lat, pins[0]!.lng)
        const map = new kakao.Map(container, {
          center,
          level: pins.length === 0 ? EMPTY_VIEW_LEVEL : SINGLE_PIN_LEVEL,
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
    if (pins.length > 1) map.setBounds(bounds)
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
