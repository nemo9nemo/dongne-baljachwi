/**
 * 카카오맵 JS SDK 지연 로더 (07-map-view.md F-14, §4.4).
 *
 * SDK는 타입 정의가 공식 배포되지 않는다. 여기서 실제로 쓰는 표면만 최소한으로 타이핑한다
 * (`any` 대신 이 파일 안에서만 쓰는 좁은 인터페이스로 좁힌다 — CLAUDE.md "any 금지").
 *
 * 스크립트 태그는 **이 함수가 처음 호출될 때만** 주입한다. 지도 보기(07)로 전환하기 전에는
 * 아무도 이 모듈의 함수를 부르지 않으므로, 노선도(기본 화면)의 초기 로드에는 카카오맵
 * 네트워크 요청이 전혀 섞이지 않는다 (F-14/AC-10).
 */

export type KakaoLatLng = { getLat: () => number; getLng: () => number }

export type KakaoMap = {
  setBounds: (bounds: KakaoLatLngBounds) => void
  setCenter: (latlng: KakaoLatLng) => void
  getCenter: () => KakaoLatLng
  setLevel: (level: number) => void
  getLevel: () => number
}

export type KakaoLatLngBounds = { extend: (latlng: KakaoLatLng) => void }

export type KakaoMarker = {
  setMap: (map: KakaoMap | null) => void
  getPosition: () => KakaoLatLng
}

export type KakaoCustomOverlay = {
  setMap: (map: KakaoMap | null) => void
}

export type KakaoMarkerClusterer = {
  addMarkers: (markers: KakaoMarker[]) => void
  clear: () => void
}

/** `window.kakao.maps` 네임스페이스. 지도 인스턴스를 조작하는 헬퍼가 인자로 받는다 */
export type KakaoMapsNamespace = {
  load: (callback: () => void) => void
  LatLng: new (lat: number, lng: number) => KakaoLatLng
  LatLngBounds: new () => KakaoLatLngBounds
  Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap
  Marker: new (options: { position: KakaoLatLng; map?: KakaoMap }) => KakaoMarker
  CustomOverlay: new (options: {
    position: KakaoLatLng
    content: HTMLElement | string
    yAnchor?: number
    zIndex?: number
  }) => KakaoCustomOverlay
  MarkerClusterer: new (options: {
    map: KakaoMap
    averageCenter?: boolean
    minLevel?: number
  }) => KakaoMarkerClusterer
  event: {
    addListener: (
      target: KakaoMap | KakaoMarker,
      type: string,
      handler: (...args: never[]) => void,
    ) => void
  }
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMapsNamespace }
  }
}

const SDK_SRC = 'https://dapi.kakao.com/v2/maps/sdk.js'

let sdkPromise: Promise<KakaoMapsNamespace> | null = null

/**
 * SDK를 (필요하면) 로드하고 `kakao.maps` 네임스페이스를 돌려준다.
 *
 * `autoload=false` + `kakao.maps.load()`인 이유: 스크립트가 도착한 시점과 지도 관련
 * 클래스들이 실제로 초기화되는 시점이 다르다 — autoload를 켜면 그 사이 경합이 생긴다.
 *
 * @throws 스크립트 로드 자체가 실패하면(키/도메인 오류 포함) reject한다.
 *   호출부(§2.2)가 노선도로 자동 복귀 + 토스트로 처리해야 한다.
 */
export function loadKakaoMapsSdk(): Promise<KakaoMapsNamespace> {
  if (sdkPromise !== null) return sdkPromise

  sdkPromise = new Promise((resolve, reject) => {
    const appKey = import.meta.env.VITE_KAKAO_MAP_APP_KEY ?? ''
    if (appKey === '') {
      reject(new Error('VITE_KAKAO_MAP_APP_KEY가 설정되지 않았다'))
      return
    }

    const existing = window.kakao
    if (existing !== undefined) {
      existing.maps.load(() => resolve(existing.maps))
      return
    }

    const script = document.createElement('script')
    script.src = `${SDK_SRC}?appkey=${appKey}&autoload=false&libraries=clusterer`
    script.async = true
    script.onload = () => {
      const kakao = window.kakao
      if (kakao === undefined) {
        reject(new Error('카카오맵 SDK 로드 후에도 window.kakao가 없다'))
        return
      }
      kakao.maps.load(() => resolve(kakao.maps))
    }
    script.onerror = () => reject(new Error('카카오맵 SDK 스크립트 로드 실패 (키/도메인 미등록 가능성)'))
    document.head.appendChild(script)
  })

  // 실패하면 재시도할 수 있도록 캐시를 비운다 — 실패를 계속 재생하면 §2.2의 "재시도"가 막힌다.
  sdkPromise.catch(() => {
    sdkPromise = null
  })

  return sdkPromise
}
