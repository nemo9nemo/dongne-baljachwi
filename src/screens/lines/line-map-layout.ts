/** 스펙 15: 화면 픽셀로 판단하며 기기 너비에 따라 달라지는 고정 줌 상한을 쓰지 않는다. */
export const DETAIL_SCALE = 1
export const MAX_SCREEN_SCALE = 3
export const TOUCH_RADIUS = 22
export type Transform = { k: number; tx: number; ty: number }
export type Box = { x: number; y: number; width: number; height: number }
export type LabelStation = {
  code: string; x: number; y: number; name: string; dimmed: boolean
  labelAnchor: 'top' | 'bottom' | 'left' | 'right'
  labelLines: string[]; labelPriority?: number; isTransfer: boolean
  labelOffset?: { x: number; y: number }
}
export type PlacedLabel = { code: string; x: number; y: number; width: number; lines: string[] }

export function maxZoom(baseScale: number) {
  return Math.max(1, MAX_SCREEN_SCALE / Math.max(baseScale, 0.0001))
}

export function clampTransform(t: Transform, width: number, height: number, maximum: number) {
  t.k = Math.max(1, Math.min(maximum, t.k))
  const mx = width * .12, my = height * .12
  t.tx = Math.min(mx, Math.max(width - mx - t.k * width, t.tx))
  t.ty = Math.min(my, Math.max(height - my - t.k * height, t.ty))
}

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function stationCandidates<T extends { x: number; y: number }>(stations: T[], x: number, y: number, scale: number) {
  return stations.map(station => ({ station, distance: Math.hypot(station.x - x, station.y - y) * scale }))
    .filter(item => item.distance <= TOUCH_RADIUS)
    .sort((a, b) => a.distance - b.distance)
}

/** 팬의 매 프레임 대신 조작이 멈출 때 보이는 라벨끼리만 충돌을 검사한다. */
export function placeLabels(
  stations: LabelStation[], transform: Transform, baseScale: number,
  viewport: { width: number; height: number; offsetX: number; offsetY: number }, selectedCode: string | null,
): PlacedLabel[] {
  const scale = baseScale * transform.k
  const visible = stations.map(s => ({ s,
    px: viewport.offsetX + (s.x * transform.k + transform.tx) * baseScale,
    py: viewport.offsetY + (s.y * transform.k + transform.ty) * baseScale,
  })).filter(p => p.px >= -100 && p.py >= -40 && p.px <= viewport.width + 100 && p.py <= viewport.height + 40)
  // 전체 보기에서는 주요 역의 이름을 우선한다. 상세 보기에서는 일반역 심볼도 피한다.
  const occupied: Box[] = scale >= DETAIL_SCALE
    ? visible.map(p => ({ x: p.px - 5, y: p.py - 5, width: 10, height: 10 })) : []
  const priority = (s: LabelStation) => (s.code === selectedCode ? 100 : 0) + (s.labelPriority ?? 0) * 10 + (s.isTransfer ? 3 : 0) + (!s.dimmed ? 1 : 0)
  const candidates = visible.filter(({ s }) => s.code === selectedCode || (!s.dimmed && (scale >= DETAIL_SCALE || (s.labelPriority ?? 0) > 0)))
    .sort((a, b) => priority(b.s) - priority(a.s) || a.s.code.localeCompare(b.s.code))
  const placed: PlacedLabel[] = []
  for (const { s, px, py } of candidates) {
    const width = Math.max(...s.labelLines.map(line => [...line].reduce((w, ch) => w + (/[\uac00-\ud7a3]/.test(ch) ? 13 : 7.5), 0))) + 6
    const height = s.labelLines.length * 16 + 2
    const gap = s.isTransfer ? 14 : 10
    const choices: Record<LabelStation['labelAnchor'], { x: number; y: number }> = {
      top: { x: -width / 2, y: -gap - height }, bottom: { x: -width / 2, y: gap },
      left: { x: -gap - width, y: -height / 2 }, right: { x: gap, y: -height / 2 },
    }
    const anchors = [...new Set([s.labelAnchor, 'right', 'left', 'top', 'bottom'] as const)]
    let best: { x: number; y: number } | undefined
    for (const anchor of anchors) {
      const c = s.labelOffset ?? choices[anchor]
      const box = { x: px + c.x - 2, y: py + c.y - 2, width: width + 4, height: height + 4 }
      if (box.x < 2 || box.y < 2 || box.x + box.width > viewport.width - 2 || box.y + box.height > viewport.height - 2) continue
      if (occupied.some(o => intersects(box, o))) continue
      best = c; occupied.push(box); break
    }
    if (!best && s.code === selectedCode) best = choices.top
    if (best) placed.push({ code: s.code, x: best.x, y: best.y + 13, width, lines: s.labelLines })
  }
  return placed
}
