/**
 * 노선도 도식 좌표 (정적 자산) — `03-line-map.md` §4.2 / ADR-003.
 *
 * ## 왜 JSON + 얇은 TS 래퍼인가
 * 좌표는 DB가 아니라 리포지토리에서 버전 관리한다(ADR-003). 조인 키는 uuid가 아니라
 * `stations.code` / `lines.code` 라는 문자열 자연키다. 사람이 PR 에서 diff 를 읽고
 * 손으로 고칠 수 있어야 하기 때문이다.
 * 데이터를 JSON 으로 둔 이유는 CI 검증 스크립트(`scripts/verify-line-map.mjs`)가
 * Node 에서 타입 스트리핑 없이 그대로 읽어야 해서다. 이 파일은 그 JSON 에 타입을
 * 씌우고 렌더러가 쓸 조회용 구조만 만든다.
 *
 * ## 좌표계
 * `viewBox` 는 항상 원점 (0,0) 에서 시작하고, 콘텐츠 bbox + 라벨 여백 80 단위로 잡혀 있다.
 * 즉 **변환 없이 그대로 그리면 그게 전체 보기**다 (F-09). 팬/줌은 이 위에 얹는 변환
 * 하나로만 처리한다 (§6 성능 제약).
 *
 * ## 2호선 파일럿 배치 규칙 (이 파일을 손으로 고칠 사람에게)
 * - 본선 43역은 타원 루프 위에 **호길이 균등**으로 놓았다. `station_lines.seq` 순서 자체가
 *   이미 위상적으로 올바른 경로라, 균등 배치만으로 자기교차 없는 루프가 나온다.
 * - 루프의 회전 방향(시계)과 종횡비(1.35:1, 동서로 김)만 실제 지리를 참고했다. 시작 각도는
 *   43역의 실제 방위각과의 원형 평균 오차가 최소가 되는 값으로 잡았다(최대 오차 약 26°).
 *   좌표 자체는 위경도가 아니다 — 위경도로 그리면 노선도가 아니라 점 지도가 된다(ADR-003).
 * - 성수지선/신정지선은 분기역에서 루프 **바깥쪽**으로 뻗는 직선 가지다.
 *   실제 성수지선(성수→신설동)은 지리적으로 루프 안쪽(북서)으로 들어가지만, 도식에서는
 *   바깥으로 뺐다. 안쪽으로 넣으면 나머지 노선이 추가될 때 루프 내부가 엉킨다.
 *   대신 실제 방위의 "북쪽" 성분만 남겨 북동으로 올렸다.
 * - 역 간격은 약 66 단위다. 라벨 글자 크기(13)와 이 간격의 비가 라벨 겹침을 결정하므로,
 *   좌표를 손보더라도 간격은 이 근처로 유지한다.
 */

import doc from './metro-seoul.json'

/** 라벨을 역 심볼의 어느 쪽에 붙일지. 도식상 바깥쪽을 향한다. */
export type LabelAnchor = 'top' | 'bottom' | 'left' | 'right'

export type LineMapStation = {
  /** `stations.code` (uuid 아님) */
  stationCode: string
  x: number
  y: number
  labelAnchor: LabelAnchor
}

export type LineMapLine = {
  /** `lines.code` */
  lineCode: string
  /** 도식 좌표계 폴리라인. 순환선은 마지막 점이 첫 점과 같다 */
  polyline: [number, number][]
  /** 이 선 위 역 순서. `station_lines.seq` 순서와 일치해야 한다 (CI 검증) */
  stationCodes: string[]
}

export type LineMapDocument = {
  viewBox: { width: number; height: number }
  lines: LineMapLine[]
  stations: LineMapStation[]
}

/**
 * 수도권 권역 도식.
 *
 * §7 확장 포인트: 전국 확장 시 권역별 파일로 쪼개고 여기를 동적 import 로 바꾼다.
 * 지금은 2호선 50역뿐이라(gzip 2KB 미만) 정적 import 로 두는 편이 첫 렌더가 빠르다.
 */
export const lineMap = doc as LineMapDocument

/** 역 코드 → 도식 좌표. 렌더러가 마스터(DB)와 조인할 때 쓴다. */
export const stationGeometryByCode: ReadonlyMap<string, LineMapStation> = new Map(
  lineMap.stations.map((s) => [s.stationCode, s]),
)

/**
 * 역 코드 → 그 역을 그리는 노선 코드.
 * 환승역이 여러 도식 노선에 걸리면 먼저 선언된 노선이 심볼 색을 가져간다.
 * (F-04 대로 환승역은 색이 아니라 형태로 구분되므로 어느 쪽을 골라도 의미가 바뀌지 않는다.)
 */
export const lineCodeByStationCode: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const line of lineMap.lines) {
    for (const code of line.stationCodes) {
      if (!map.has(code)) map.set(code, line.lineCode)
    }
  }
  return map
})()
