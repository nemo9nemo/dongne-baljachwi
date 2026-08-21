import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { LabelAnchor } from '../../data/line-map'
import styles from './line-map.module.css'

/**
 * 노선도 SVG 캔버스 — 그리기 + 팬/줌만 한다. 데이터 로딩·필터 판단은 LineMapScreen 몫이다.
 *
 * ## 성능 설계 (03 §6)
 * - 팬/줌은 **개별 요소 좌표를 다시 계산하지 않는다.** 루트 `<g>` 의 transform 하나만
 *   바꾼다. 그래서 이 컴포넌트는 줌/이동 중에 리렌더하지 않는다 — 변환 상태는 ref 에
 *   두고 rAF 에서 setAttribute 로 직접 쓴다. state 로 올리면 포인터무브마다 1,100개
 *   역 노드가 재조정(reconcile)돼 60fps 를 못 지킨다.
 * - React state 로 승격하는 것은 **라벨 표시 여부 하나뿐**이다. 라벨은 임계 배율 아래에서
 *   DOM 에서 아예 제거해야 하므로(숨김이 아니라) 리렌더가 불가피하고, 임계값을 넘나드는
 *   순간에만 일어난다. 숫자 뱃지도 같은 플래그에 묶여 있다 — 읽히지 않는 배율에서는
 *   뱃지도 DOM 에 없다.
 */

/** 화면 좌표 배율(1 사용자단위당 CSS px)이 이 값을 넘으면 라벨을 그린다 (F-07 / AC-07).
 *  13단위 글자가 약 11 CSS px 로 찍히는 지점이다. 이보다 아래에서는 읽을 수 없다. */
const LABEL_MIN_SCREEN_SCALE = 0.85

/** F-18: 전체 보기(=1) ~ 8배. viewBox 가 곧 전체 보기라 하한이 정확히 1이다. */
const MIN_ZOOM = 1
const MAX_ZOOM = 8

/** F-19: 노선도 경계 밖으로 날아가지 않도록 허용하는 여백 (viewBox 크기 대비 비율) */
const PAN_MARGIN_RATIO = 0.12

/** 탭 판정 반경 (CSS px). F-20 의 44×44 터치 타깃 절반. */
const TAP_RADIUS_PX = 22
/** 이 거리(CSS px)를 넘겨 움직이면 탭이 아니라 팬으로 본다. */
const TAP_SLOP_PX = 8

/**
 * F-03: 방문 횟수 → 채움 농도 클래스. 5회 단위로 한 단계, **10회가 노선 원색**이다.
 * 계단 값과 대비 근거는 `line-map.module.css` 의 "역 심볼 채움" 주석에 있다.
 *
 * 클래스 문자열을 모듈 로드 시 한 번만 만들어 두는 이유: 이 함수는 역 수만큼(전국
 * 확장 시 1,100회) 렌더마다 호출된다. 매번 템플릿 문자열을 이어 붙이면 그만큼
 * 문자열이 새로 생기고, className 이 매번 다른 인스턴스가 되어 비교도 무의미해진다.
 */
const FILL_STEPS = [
  `${styles.symbol} ${styles.symbolPale2}`,
  `${styles.symbol} ${styles.symbolPale1}`,
  styles.symbol,
  `${styles.symbol} ${styles.symbolDeep1}`,
  `${styles.symbol} ${styles.symbolDeep2}`,
  `${styles.symbol} ${styles.symbolDeep3}`,
] as const

function fillClass(visitCount: number): string {
  if (visitCount <= 0) return styles.symbolEmpty!
  // 1~4 → 0, 5~9 → 1, ... 25 이상은 마지막 단계에서 상한(끝없이 짙어지지 않는다).
  return FILL_STEPS[Math.min(Math.floor(visitCount / 5), FILL_STEPS.length - 1)]!
}

const STATION_R = 11
const TRANSFER_R = 14
const LINE_WIDTH = 9
const LABEL_FONT = 13
const LABEL_LINE_HEIGHT = 15
const LABEL_GAP = 9
const BADGE_R = 10

export type MapStation = {
  /** `stations.code`. React key 이자 좌표 조인 키 */
  code: string
  /** `stations.id`. 역 상세 라우팅에 쓴다 */
  id: string
  name: string
  x: number
  y: number
  labelAnchor: LabelAnchor
  isTransfer: boolean
  /** 0이면 미방문(빈 원). 1 이상이면 5회 단위 농도 단계로 채운다(F-03) — 10회가 기준색.
   *  F-05: 2 이상이면 확대 시 숫자 뱃지도 붙는다 */
  visitCount: number
  /** `var(--line-2)` 같은 완성된 CSS 색 표현식. 테두리 색이자 채움 농도의 기준색이다 */
  color: string
  /** F-12: 선택되지 않은 호선. 흐리게 그리되 탭은 그대로 받는다 (F-13) */
  dimmed: boolean
  /** 라벨 줄바꿈 결과. 매 렌더 문자열을 쪼개지 않도록 화면 쪽에서 미리 계산해 넘긴다 */
  labelLines: string[]
}

export type MapLine = {
  code: string
  points: string
  color: string
  dimmed: boolean
}

/**
 * 뷰포트 변환. 도식 좌표에 `translate(tx ty) scale(k)` 순서로 적용된다.
 *
 * - `k`: 배율. 1이 전체 보기, 상한 8 (F-18)
 * - `tx`/`ty`: 이동량. **도식 좌표계 단위**이지 CSS px 가 아니다
 */
export type LineMapTransform = { k: number; tx: number; ty: number }

export type LineMapCanvasHandle = {
  /** F-22: 전체 보기로 리셋 */
  reset: () => void
  /** 버튼 줌 (F-17). factor > 1 이면 확대 */
  zoomBy: (factor: number) => void
  /** F-14: 주어진 도식 좌표 박스가 화면에 차도록 이동/확대 */
  fitTo: (box: { x: number; y: number; width: number; height: number }) => void
  /**
   * F-21 / AC-08: 현재 변환값 **사본**. 내부 상태는 제자리에서 변형되므로 사본이 아니면
   * 보관하는 쪽이 계속 흔들리는 값을 들게 된다.
   */
  getTransform: () => LineMapTransform
  /**
   * F-21 / AC-08: 보관해 둔 변환값을 그대로 되돌린다. 값은 clampTransform 을 거치므로
   * 줌/팬 범위(F-18/F-19) 밖이거나 리사이즈로 의미가 달라진 값이 들어와도 안전하다.
   */
  setTransform: (t: LineMapTransform) => void
}

type Props = {
  /** 도식 좌표계 크기. 변환 없이 그린 상태가 곧 전체 보기다 */
  width: number
  height: number
  lines: MapLine[]
  stations: MapStation[]
  /** 역 탭/Enter 시 호출. 인자는 `stations.id` */
  onSelectStation: (stationId: string) => void
  ref?: React.Ref<LineMapCanvasHandle>
}

function clampTransform(
  t: { k: number; tx: number; ty: number },
  width: number,
  height: number,
): void {
  t.k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k))
  const mx = width * PAN_MARGIN_RATIO
  const my = height * PAN_MARGIN_RATIO
  t.tx = Math.min(mx, Math.max(width - mx - t.k * width, t.tx))
  t.ty = Math.min(my, Math.max(height - my - t.k * height, t.ty))
}

export function LineMapCanvas({
  width,
  height,
  lines,
  stations,
  onSelectStation,
  ref,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const layerRef = useRef<SVGGElement>(null)

  // 변환 상태. 의도적으로 state 가 아니다 (위 주석 참조).
  const tf = useRef({ k: 1, tx: 0, ty: 0 })
  // preserveAspectRatio="meet" 가 적용한 기본 배율(사용자단위 → CSS px). 리사이즈 때만 갱신.
  const baseScale = useRef(1)
  const frame = useRef(0)
  const [labelsOn, setLabelsOn] = useState(false)
  // 드래그 중 rAF 마다 setState 를 부르지 않기 위한 현재값 사본. 임계값을 실제로
  // 넘나든 프레임에서만 리렌더가 일어난다.
  const labelsOnRef = useRef(false)

  const syncLabels = () => {
    const next = baseScale.current * tf.current.k >= LABEL_MIN_SCREEN_SCALE
    if (next === labelsOnRef.current) return
    labelsOnRef.current = next
    setLabelsOn(next)
  }

  const commit = () => {
    if (frame.current !== 0) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const layer = layerRef.current
      if (layer === null) return
      const { k, tx, ty } = tf.current
      layer.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`)
      syncLabels()
    })
  }

  useEffect(() => {
    const svg = svgRef.current
    if (svg === null) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box === undefined || box.width === 0) return
      baseScale.current = Math.min(box.width / width, box.height / height)
      syncLabels()
    })
    observer.observe(svg)
    return () => observer.disconnect()
    // syncLabels 는 ref 만 읽고 쓰므로 매 렌더 새로 만들어져도 동작이 같다.
  }, [width, height])

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      // 핸들을 반드시 0으로 되돌린다. StrictMode 는 마운트 직후 이펙트를 한 번
      // 정리했다가 **같은 ref 객체로** 다시 붙이므로, 여기서 지우지 않으면 취소된
      // 핸들 번호가 남아 이후 모든 commit() 이 "이미 예약됨"으로 오판하고 빠져나간다
      // (= 팬/줌이 통째로 죽는다). 실제로 겪은 버그다.
      frame.current = 0
    },
    [],
  )

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        tf.current = { k: 1, tx: 0, ty: 0 }
        commit()
      },
      zoomBy: (factor) => {
        const t = tf.current
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor))
        // 화면 중앙을 고정점으로 삼는다.
        const cx = width / 2
        const cy = height / 2
        t.tx = cx - ((cx - t.tx) / t.k) * next
        t.ty = cy - ((cy - t.ty) / t.k) * next
        t.k = next
        clampTransform(t, width, height)
        commit()
      },
      fitTo: (box) => {
        const t = tf.current
        t.k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(width / box.width, height / box.height)))
        t.tx = width / 2 - (box.x + box.width / 2) * t.k
        t.ty = height / 2 - (box.y + box.height / 2) * t.k
        clampTransform(t, width, height)
        commit()
      },
      getTransform: () => ({ ...tf.current }),
      setTransform: (t) => {
        tf.current = { k: t.k, tx: t.tx, ty: t.ty }
        clampTransform(tf.current, width, height)
        commit()
      },
    }),
    // commit/clampTransform 은 ref 만 만지므로 의존성이 아니다.
    [width, height],
  )

  /**
   * 클라이언트 좌표 → 도식 좌표. preserveAspectRatio="xMidYMid meet" 의 레터박스를 되돌린다.
   * useCallback 인 이유는 아래 wheel 이펙트의 의존성이기 때문이다 — 매 렌더 새로 만들면
   * 리스너를 떼었다 붙이는 일이 렌더마다 일어난다.
   */
  const toDiagram = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (rect === undefined) return { x: 0, y: 0 }
      const s = Math.min(rect.width / width, rect.height / height)
      return {
        x: (clientX - rect.left - (rect.width - width * s) / 2) / s,
        y: (clientY - rect.top - (rect.height - height * s) / 2) / s,
      }
    },
    [width, height],
  )

  // 휠 줌. React 는 wheel 을 루트에 **passive** 로 붙이므로 onWheel 안의 preventDefault 가
  // 무시된다(페이지가 같이 스크롤된다). 그래서 직접 non-passive 로 등록한다.
  useEffect(() => {
    const svg = svgRef.current
    if (svg === null) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const t = tf.current
      // deltaMode 0=px, 1=line, 2=page. 트랙패드/휠/브라우저마다 단위가 달라 정규화한다.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * Math.exp((-e.deltaY * unit) / 400)))
      const p = toDiagram(e.clientX, e.clientY)
      t.tx = p.x - ((p.x - t.tx) / t.k) * next
      t.ty = p.y - ((p.y - t.ty) / t.k) * next
      t.k = next
      clampTransform(t, width, height)
      commit()
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [width, height, toDiagram])

  // 포인터 상태도 ref 다. 드래그 중 리렌더가 일어나면 안 된다.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef({ moved: 0, pinchDist: 0 })

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    svgRef.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) gesture.current.moved = 0
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
    }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId)
    if (prev === undefined) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const s = Math.min(rect.width / width, rect.height / height)
    const t = tf.current

    if (pointers.current.size === 1) {
      gesture.current.moved += Math.hypot(e.clientX - prev.x, e.clientY - prev.y)
      t.tx += (e.clientX - prev.x) / s
      t.ty += (e.clientY - prev.y) / s
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      const before = gesture.current.pinchDist
      gesture.current.pinchDist = dist
      if (before > 0) {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * (dist / before)))
        const p = toDiagram((a!.x + b!.x) / 2, (a!.y + b!.y) / 2)
        t.tx = p.x - ((p.x - t.tx) / t.k) * next
        t.ty = p.y - ((p.y - t.ty) / t.k) * next
        t.k = next
      }
      gesture.current.moved = TAP_SLOP_PX + 1
    }

    clampTransform(t, width, height)
    commit()
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const wasSingle = pointers.current.size === 1
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) gesture.current.pinchDist = 0
    if (!wasSingle || gesture.current.moved > TAP_SLOP_PX) return

    // F-24: 겹쳐서 모호할 때 선택 UI 를 띄우지 않고 **가장 가까운 역 1개**를 고른다.
    // 역마다 히트 영역 <circle> 을 두지 않는 이유는 두 가지다.
    //  (1) 축소 상태에서 44px 히트 영역은 역 간격보다 커서 서로 겹친다 — 그러면 SVG 는
    //      '가장 가까운' 것이 아니라 '가장 위에 있는' 것을 집는다.
    //  (2) 배율에 따라 히트 반경을 바꾸려면 요소마다 속성을 다시 써야 한다 (§6 위반).
    const p = toDiagram(e.clientX, e.clientY)
    const t = tf.current
    const rect = svgRef.current?.getBoundingClientRect()
    const s = rect === undefined ? 1 : Math.min(rect.width / width, rect.height / height)
    const limit = TAP_RADIUS_PX / (s * t.k)
    let best: MapStation | null = null
    let bestD = Infinity
    for (const st of stations) {
      const dx = (st.x * t.k + t.tx - p.x) / t.k
      const dy = (st.y * t.k + t.ty - p.y) / t.k
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = st
      }
    }
    if (best !== null && Math.sqrt(bestD) <= limit) onSelectStation(best.id)
  }

  return (
    <svg
      ref={svgRef}
      className={styles.canvas}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="지하철 노선도"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <g ref={layerRef}>
        {lines.map((line) => (
          <polyline
            key={line.code}
            className={line.dimmed ? styles.lineDimmed : undefined}
            points={line.points}
            fill="none"
            stroke={line.color}
            strokeWidth={LINE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {stations.map((st) => (
          <g
            key={st.code}
            className={st.dimmed ? `${styles.station} ${styles.stationDimmed}` : styles.station}
            // 채움 색은 CSS 가 계산한다 (color-mix 비율이 라이트/다크에서 다르므로
            // JS 로는 테마 전환을 따라갈 수 없다). 노선색만 변수로 내려보낸다.
            style={{ '--station-color': st.color } as React.CSSProperties}
            tabIndex={0}
            role="link"
            // AC-13: 색/형태에 의존하지 않는 대체 정보. 미방문도 명시적으로 읽어준다.
            aria-label={
              st.visitCount > 0
                ? `${st.name}, ${st.visitCount}회 방문`
                : `${st.name}, 미방문`
            }
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onSelectStation(st.id)
            }}
          >
            {/* F-04: 환승역은 방문 여부와 무관하게 바깥 링을 하나 더 두른다.
                최종 형태는 디자이너 몫이라 지금은 크기·링 차이만으로 구분한다. */}
            {st.isTransfer && (
              <circle
                cx={st.x}
                cy={st.y}
                r={TRANSFER_R}
                fill="var(--color-surface)"
                stroke={st.color}
                strokeWidth={2}
              />
            )}
            {/* F-03: 방문=채운 스탬프 / 미방문=테두리만. 색이 아니라 채움 여부가 신호다.
                채운 경우의 농도는 방문 횟수 단계를 나타낸다 (fillClass). */}
            <circle
              className={fillClass(st.visitCount)}
              cx={st.x}
              cy={st.y}
              r={STATION_R}
              stroke={st.color}
              strokeWidth={3}
            />

            {/* F-05: 2회 이상에만 숫자 뱃지. 단, **라벨 임계 배율 이상에서만** 그린다.
                대략의 빈도는 이제 채움 농도가 말해주므로, 숫자가 읽히지도 않는 축소
                상태에서 점만 찍어두면 같은 정보를 두 번 말하면서 노선도만 지저분해진다.
                정확한 횟수가 필요한 사용자는 확대하거나(=숫자 노출) 스크린리더의
                aria-label("N회 방문")로 도달한다. */}
            {labelsOn && st.visitCount >= 2 && (
              <>
                <circle
                  cx={st.x + 13}
                  cy={st.y - 13}
                  r={BADGE_R}
                  fill="var(--color-primary)"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
                <text
                  className={styles.badgeText}
                  x={st.x + 13}
                  y={st.y - 13 + 4}
                  textAnchor="middle"
                >
                  {/* F-06: 상한 99 */}
                  {st.visitCount > 99 ? '99+' : st.visitCount}
                </text>
              </>
            )}

            {labelsOn && <StationLabel station={st} />}
          </g>
        ))}
      </g>
    </svg>
  )
}

/** 라벨 한 덩어리. 앵커 방향에 따라 기준점과 정렬이 달라진다. */
function StationLabel({ station }: { station: MapStation }) {
  const n = station.labelLines.length
  const r = station.isTransfer ? TRANSFER_R : STATION_R
  let x = station.x
  let firstBaseline: number
  let anchor: 'start' | 'middle' | 'end' = 'middle'

  if (station.labelAnchor === 'top') {
    firstBaseline = station.y - r - LABEL_GAP - (n - 1) * LABEL_LINE_HEIGHT
  } else if (station.labelAnchor === 'bottom') {
    firstBaseline = station.y + r + LABEL_GAP + LABEL_FONT * 0.8
  } else {
    // 좌/우는 세로 중앙 정렬. 0.35em 이 대문자/한글 기준선 보정값이다.
    firstBaseline = station.y - ((n - 1) * LABEL_LINE_HEIGHT) / 2 + LABEL_FONT * 0.35
    x = station.x + (station.labelAnchor === 'right' ? r + LABEL_GAP : -(r + LABEL_GAP))
    anchor = station.labelAnchor === 'right' ? 'start' : 'end'
  }

  return (
    <text className={styles.label} x={x} y={firstBaseline} textAnchor={anchor}>
      {station.labelLines.map((line, i) => (
        <tspan key={line + i} x={x} dy={i === 0 ? 0 : LABEL_LINE_HEIGHT}>
          {line}
        </tspan>
      ))}
    </text>
  )
}
