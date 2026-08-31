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
 * ## 배치 규칙 (이 파일을 손으로 고칠 사람에게)
 * MVP 33개 노선 646역 전부가 `scripts/seed-line-map.mjs`의 3개 패스로 생성됐다
 * (`03-line-map.md` §9). 손으로 고치는 것도 가능하지만, 스크립트를 다시 돌리면 덮어써진다 —
 * 규칙 자체를 바꿔야 하는 수정이면 스크립트를 고치는 쪽이 맞다.
 * - **선분 각도는 0°/45°/90°다** (옥토리니어, 2026-08-31). 747개 선분 중 691개가 격자 위에
 *   정확히 놓이고, 나머지는 확정된 환승역 사이에 자유도가 없어 최대 12°까지 어긋난다.
 *   좌표를 손보더라도 이 각도 규칙을 깨지 않는 편이 좋다 — 하나만 비스듬해도 눈에 띈다.
 * - 2호선 본선은 닫힌 8각형이다(`polyline`의 마지막 점 = 첫 점). 성수지선/신정지선은
 *   분기 지점에서 루프 **바깥쪽**으로 뻗는 가지다 — 안쪽으로 넣으면 루프 내부가 엉킨다.
 * - 서로 다른 역은 최소 26 단위 떨어져 있다(역 원 지름 22 + 여유). 선분 길이 하한도 같은 값.
 * - `polyline`은 역 좌표만으로 이루어져 있다(`polyline.length === stationCodes.length`,
 *   순환선만 닫힘 점 +1). 역 사이에 곡선 보간점을 넣지 않는다.
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
 * 지금은 33개 노선 646역으로 gzip 14KB라(§6 예산 100KB) 정적 import 로 두는 편이 첫 렌더가 빠르다.
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
