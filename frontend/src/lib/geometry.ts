import type { Opening, Plan, Vec2, Wall } from './types'

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
export const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
export const len = (a: Vec2) => Math.hypot(a[0], a[1])
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l]
}
export const perp = (a: Vec2): Vec2 => [-a[1], a[0]]
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]

export function wallFrame(w: Wall) {
  const d = sub(w.b, w.a)
  const L = len(d)
  const u = norm(d)
  const n = perp(u)
  return { L, u, n, angle: Math.atan2(u[1], u[0]) }
}

export function wallCorners(w: Wall): Vec2[] {
  const { u, n } = wallFrame(w)
  const h = w.thickness / 2
  // small extension so adjoining walls overlap without seams
  const e = 0
  const a = sub(w.a, mul(u, e))
  const b = add(w.b, mul(u, e))
  return [add(a, mul(n, h)), add(b, mul(n, h)), sub(b, mul(n, h)), sub(a, mul(n, h))]
}

export function openingFrame(o: Opening, w: Wall) {
  const { u, n, angle, L } = wallFrame(w)
  const off = Math.max(o.width / 2, Math.min(L - o.width / 2, o.offset))
  const c = add(w.a, mul(u, off))
  return { c, u, n, angle, start: sub(c, mul(u, o.width / 2)), end: add(c, mul(u, o.width / 2)), offset: off }
}

export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a)
  const L2 = dot(ab, ab) || 1e-9
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2))
  const q = add(a, mul(ab, t))
  return { t, q, d: dist(p, q), along: t * Math.sqrt(L2) }
}

export function nearestWall(plan: Plan, p: Vec2, maxDist = 0.6) {
  let best: { wall: Wall; along: number; d: number } | null = null
  for (const w of plan.walls) {
    const r = projectOnSegment(p, w.a, w.b)
    if (r.d < maxDist && (!best || r.d < best.d)) best = { wall: w, along: r.along, d: r.d }
  }
  return best
}

export function polygonArea(pts: Vec2[]) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

export function polygonPerimeter(pts: Vec2[]) {
  let p = 0
  for (let i = 0; i < pts.length; i++) p += dist(pts[i], pts[(i + 1) % pts.length])
  return p
}

export function polygonCentroid(pts: Vec2[]): Vec2 {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    const f = x1 * y2 - x2 * y1
    a += f
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
  }
  if (Math.abs(a) < 1e-9) {
    const n = pts.length || 1
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

export function pointInPolygon(p: Vec2, pts: Vec2[]) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Point well inside a polygon (for labels): centroid if inside, else best interior sample. */
export function labelPoint(pts: Vec2[]): Vec2 {
  const c = polygonCentroid(pts)
  if (pointInPolygon(c, pts)) return c
  const b = bounds(pts)
  let best: Vec2 = c
  let bestD = -1
  for (let i = 1; i < 12; i++)
    for (let j = 1; j < 12; j++) {
      const p: Vec2 = [b.minX + ((b.maxX - b.minX) * i) / 12, b.minY + ((b.maxY - b.minY) * j) / 12]
      if (!pointInPolygon(p, pts)) continue
      let d = Infinity
      for (let k = 0; k < pts.length; k++) d = Math.min(d, projectOnSegment(p, pts[k], pts[(k + 1) % pts.length]).d)
      if (d > bestD) {
        bestD = d
        best = p
      }
    }
  return best
}

export function bounds(pts: Vec2[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

export function planBounds(plan: Plan) {
  const pts: Vec2[] = []
  for (const w of plan.walls) pts.push(w.a, w.b)
  for (const r of plan.rooms) pts.push(...r.polygon)
  for (const f of plan.furniture) pts.push([f.x, f.y])
  if (!pts.length) return { minX: 0, minY: 0, maxX: 10, maxY: 8 }
  const b = bounds(pts)
  return { minX: b.minX - 0.5, minY: b.minY - 0.5, maxX: b.maxX + 0.5, maxY: b.maxY + 0.5 }
}

export function runLength(points: Vec2[]) {
  let s = 0
  for (let i = 1; i < points.length; i++) s += dist(points[i - 1], points[i])
  return s
}

export const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v)

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export const fmt = (m: number, digits = 2) => `${m.toFixed(digits)} m`

/** Rotate a local point by deg around origin. */
export function rotate(p: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}
