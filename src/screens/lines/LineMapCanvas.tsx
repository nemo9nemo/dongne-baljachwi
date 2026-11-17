import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LabelStation, PlacedLabel, Transform, Box } from './line-map-layout'
import { clampTransform, DETAIL_SCALE, maxZoom, placeLabels, stationCandidates } from './line-map-layout'
import styles from './line-map.module.css'

export type MapStation = LabelStation & {
  id: string
  visitCount: number | null
  color: string
  colors: string[]
}
export type MapLine = { code: string; points: string; color: string; dimmed: boolean }
export type LineMapTransform = Transform
export type LineMapCanvasHandle = {
  reset: () => void
  zoomBy: (factor: number) => void
  fitTo: (box: Box) => void
  focusOn: (code: string) => void
  getTransform: () => Transform
  setTransform: (value: Transform) => void
}
type Props = {
  width: number; height: number; lines: MapLine[]; stations: MapStation[]
  riverPoints?: string
  onSelectStation: (id: string) => void
  onAmbiguous: (stations: MapStation[]) => void
  ref?: React.Ref<LineMapCanvasHandle>
}

/** 스펙 15: 선은 공통 변환, 글자·환승 표시는 CSS 픽셀 크기를 유지한다. */
export function LineMapCanvas({ width, height, lines, stations, riverPoints, onSelectStation, onAmbiguous, ref }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const layerRef = useRef<SVGGElement>(null)
  const tf = useRef<Transform>({ k: 1, tx: 0, ty: 0 })
  const metrics = useRef({ base: 1, width: 1, height: 1, offsetX: 0, offsetY: 0 })
  const frame = useRef(0)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [labels, setLabels] = useState<PlacedLabel[]>([])
  const [detail, setDetail] = useState(false)
  const [activeCode, setActiveCode] = useState<string | null>(null)
  const current = useRef({ stations, activeCode })
  current.current = { stations, activeCode }
  const byCode = useMemo(() => new Map(stations.map(s => [s.code, s])), [stations])

  const refreshLabels = useCallback(() => {
    const m = metrics.current
    setLabels(placeLabels(current.current.stations, tf.current, m.base, m, current.current.activeCode))
    setDetail(m.base * tf.current.k >= DETAIL_SCALE)
  }, [])
  const apply = useCallback(() => {
    const { k, tx, ty } = tf.current
    const scale = Math.max(.0001, metrics.current.base * k)
    layerRef.current?.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`)
    svgRef.current?.style.setProperty('--map-inverse-scale', String(1 / scale))
    svgRef.current?.style.setProperty('--map-glyph-scale', String(Math.min(1, .4 + scale * .6) / scale))
    svgRef.current?.style.setProperty('--map-line-width', `${Math.min(3.5, Math.max(1.25, scale * 3))}px`)
    if (settle.current !== null) clearTimeout(settle.current)
    // 팬 중에는 SVG 루트/CSS 변수만 바꾸고 충돌 검사는 조작이 잦아든 뒤 수행한다.
    settle.current = setTimeout(refreshLabels, 90)
  }, [refreshLabels])
  const commit = useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => { frame.current = 0; apply() })
  }, [apply])
  const clamp = useCallback(() => clampTransform(tf.current, width, height, maxZoom(metrics.current.base)), [width, height])

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => {
      const rect = svg.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const base = Math.min(rect.width / width, rect.height / height)
      metrics.current = { base, width: rect.width, height: rect.height,
        offsetX: (rect.width - width * base) / 2, offsetY: (rect.height - height * base) / 2 }
      clamp(); apply(); refreshLabels()
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [width, height, clamp, apply, refreshLabels])
  useEffect(() => { refreshLabels() }, [stations, activeCode, refreshLabels])
  useEffect(() => () => {
    cancelAnimationFrame(frame.current); frame.current = 0
    if (settle.current !== null) clearTimeout(settle.current)
  }, [])

  const zoomAt = useCallback((factor: number, x: number, y: number) => {
    const t = tf.current
    const next = Math.max(1, Math.min(maxZoom(metrics.current.base), t.k * factor))
    t.tx = x - (x - t.tx) / t.k * next
    t.ty = y - (y - t.ty) / t.k * next
    t.k = next; clamp(); commit()
  }, [clamp, commit])
  const focusOn = useCallback((code: string) => {
    const station = current.current.stations.find(s => s.code === code)
    if (!station) return
    tf.current = { k: 1.8 / metrics.current.base, tx: 0, ty: 0 }
    tf.current.tx = width / 2 - station.x * tf.current.k
    tf.current.ty = height / 2 - station.y * tf.current.k
    setActiveCode(code); clamp(); commit()
  }, [width, height, clamp, commit])
  useImperativeHandle(ref, () => ({
    reset: () => { tf.current = { k: 1, tx: 0, ty: 0 }; setActiveCode(null); commit() },
    zoomBy: factor => zoomAt(factor, width / 2, height / 2),
    fitTo: box => {
      const k = Math.min(width / Math.max(1, box.width), height / Math.max(1, box.height))
      tf.current = { k, tx: width / 2 - (box.x + box.width / 2) * k, ty: height / 2 - (box.y + box.height / 2) * k }
      setActiveCode(null); clamp(); commit()
    },
    focusOn,
    getTransform: () => ({ ...tf.current }),
    setTransform: value => { tf.current = { ...value }; clamp(); commit() },
  }), [width, height, clamp, commit, focusOn, zoomAt])

  const toDiagram = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect(), m = metrics.current
    return { x: (clientX - rect.left - m.offsetX) / m.base, y: (clientY - rect.top - m.offsetY) / m.base }
  }, [])
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? metrics.current.height : 1
      const p = toDiagram(e.clientX, e.clientY)
      zoomAt(Math.exp(-e.deltaY * unit / 400), p.x, p.y)
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [toDiagram, zoomAt])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef({ moved: 0, pinch: 0, hadPinch: false })
  function pointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return
    svgRef.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) gesture.current = { moved: 0, pinch: 0, hadPinch: false }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y)
      gesture.current.hadPinch = true
    }
  }
  function pointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const previous = pointers.current.get(e.pointerId)
    if (!previous) return
    const t = tf.current
    if (pointers.current.size === 1) {
      gesture.current.moved += Math.hypot(e.clientX - previous.x, e.clientY - previous.y)
      t.tx += (e.clientX - previous.x) / metrics.current.base
      t.ty += (e.clientY - previous.y) / metrics.current.base
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const p = toDiagram((a.x + b.x) / 2, (a.y + b.y) / 2)
      if (gesture.current.pinch > 0) zoomAt(distance / gesture.current.pinch, p.x, p.y)
      gesture.current.pinch = distance
    }
    clamp(); commit()
  }
  function cancelPointer(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId)
    gesture.current.moved = 9
    gesture.current.pinch = 0
  }
  function pointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const tracked = pointers.current.has(e.pointerId)
    const wasSingle = pointers.current.size === 1
    pointers.current.delete(e.pointerId)
    gesture.current.pinch = 0
    if (!tracked || !wasSingle || gesture.current.hadPinch || gesture.current.moved > 8) return
    const p = toDiagram(e.clientX, e.clientY), t = tf.current
    const matches = stationCandidates(stations, (p.x - t.tx) / t.k, (p.y - t.ty) / t.k, metrics.current.base * t.k)
    if (!matches.length) return
    if (matches.length === 1 || (matches[0].distance < 5 && matches[1].distance - matches[0].distance > 8)) {
      onSelectStation(matches[0].station.id); return
    }
    if (t.k < maxZoom(metrics.current.base) * .9) {
      setActiveCode(matches[0].station.code)
      zoomAt(2, p.x, p.y)
    } else onAmbiguous(matches.map(m => m.station))
  }
  function moveStationFocus(e: React.KeyboardEvent<SVGSVGElement>) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
    e.preventDefault()
    const currentStation = byCode.get(activeCode ?? '') ?? stations.find(s => !s.dimmed)
    if (!currentStation) return
    const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
    const sign = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
    const next = stations.filter(s => s.code !== currentStation.code && !s.dimmed)
      .map(s => { const dx = s.x - currentStation.x, dy = s.y - currentStation.y
        return { s, forward: (horizontal ? dx : dy) * sign, score: Math.hypot(dx, dy) + Math.abs(horizontal ? dy : dx) * 2 } })
      .filter(v => v.forward > 0).sort((a, b) => a.score - b.score)[0]?.s
    if (!next) return
    focusOn(next.code)
    requestAnimationFrame(() => svgRef.current?.querySelector<SVGGElement>(`[data-station-code="${next.code}"]`)?.focus())
  }
  const tabCode = activeCode ?? stations.find(s => !s.dimmed && (s.labelPriority ?? 0) > 0)?.code ?? stations[0]?.code

  return <svg ref={svgRef} className={styles.canvas} viewBox={`0 0 ${width} ${height}`}
    preserveAspectRatio="xMidYMid meet" role="group" aria-label="지하철 노선도. 역 검색 또는 방향키로 역을 찾을 수 있습니다."
    data-detail={detail} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
    onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer} onKeyDown={moveStationFocus}>
    <g ref={layerRef}>
      {riverPoints && <polyline points={riverPoints} className={styles.river} fill="none" strokeWidth={55} strokeLinejoin="round" strokeLinecap="round" />}
      {lines.map(line => <polyline key={line.code} points={line.points} className={`${styles.routeLine} ${line.dimmed ? styles.lineDimmed : ''}`}
        fill="none" stroke={line.color} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />)}
      {stations.map(st => <g key={st.code} transform={`translate(${st.x} ${st.y})`} data-station-code={st.code}
        className={`${styles.station} ${st.dimmed ? styles.stationDimmed : ''}`} tabIndex={st.code === tabCode ? 0 : -1} role="link"
        aria-label={`${st.name}, ${st.visitCount === null ? '방문 정보 미확인' : st.visitCount ? `${st.visitCount}회 방문` : '미방문'}`}
        onFocus={() => setActiveCode(st.code)} onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectStation(st.id) }
        }}>
        <g className={styles.fixedGlyph}>
          {st.code === activeCode && <circle r={13} className={styles.selectionRing} />}
          {st.colors.length > 1 ? <>
            <rect x={-st.colors.length * 3.5 - 1.5} y={-5.5} width={st.colors.length * 7 + 3} height={11} rx={5.5} className={styles.transferBody} />
            {st.colors.map((color, i) => <circle key={color} cx={(i - (st.colors.length - 1) / 2) * 7} r={2.5} fill={color} />)}
          </> : <circle r={3.5} className={styles.stationBody} stroke={st.color} strokeWidth={2} />}
          {st.visitCount !== null && st.visitCount > 0 && <g transform="translate(6 -8)">
            <circle r={5.5} className={styles.visitMark} />
            <path d="M -2.5 0 L -0.5 2 L 3 -2" className={styles.visitCheck} />
          </g>}
          {detail && st.visitCount !== null && st.visitCount >= 2 && <g transform="translate(14 -13)">
            <rect x={-4} y={-10} width={st.visitCount > 99 ? 29 : st.visitCount > 9 ? 22 : 15} height={16} rx={7} className={styles.countBadge} />
            <text x={3} y={2} className={styles.badgeText}>{st.visitCount > 99 ? '99+' : st.visitCount}</text>
          </g>}
        </g>
      </g>)}
      <g aria-hidden="true" className={styles.labelLayer}>
        {labels.map(label => { const station = byCode.get(label.code)
          if (!station) return null
          return <g key={label.code} transform={`translate(${station.x} ${station.y})`}>
            <g className={styles.fixedLabel}>
              <text x={label.x} y={label.y} className={`${styles.label} ${label.code === activeCode ? styles.selectedLabel : ''}`}>
                {label.lines.map((text, i) => <tspan key={i} x={label.x} dy={i ? 16 : 0}>{text}</tspan>)}
              </text>
            </g>
          </g>
        })}
      </g>
    </g>
  </svg>
}
