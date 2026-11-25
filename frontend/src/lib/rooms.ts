import polygonClipping, { type Polygon } from 'polygon-clipping'
import { add, mul, polygonArea, sub, wallFrame } from './geometry'
import type { Plan, Vec2, Wall } from './types'

const ring = (pts: Vec2[]): Polygon => [[...pts, pts[0]].map(([x, y]) => [x, y] as [number, number])]

/** Wall footprint widened a little so it overlaps the floors that stop at its faces. */
function strip(w: Wall, pad = 0.08): Vec2[] {
  const { u, n } = wallFrame(w)
  const h = w.thickness / 2 + pad
  const a = sub(w.a, mul(u, 0.01))
  const b = add(w.b, mul(u, 0.01))
  return [add(a, mul(n, h)), add(b, mul(n, h)), sub(b, mul(n, h)), sub(a, mul(n, h))]
}

function simplify(pts: Vec2[]): Vec2[] {
  const out = pts.filter((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length]
    const b = pts[(i + 1) % pts.length]
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
    return Math.abs(cross) > 1e-4
  })
  return out.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])
}

function outer(mp: Polygon[]): Vec2[] | null {
  if (!mp.length) return null
  const best = mp.reduce((m, p) => (polygonArea(p[0] as Vec2[]) > polygonArea(m[0] as Vec2[]) ? p : m))
  return simplify((best[0] as Vec2[]).slice(0, -1))
}

/**
 * After walls are removed, floors on either side become one room (keeping the
 * larger room's name and finishes) and the strip where the wall stood is floored.
 */
export function healRoomsAfterWallRemoval(d: Plan, removed: Wall[]) {
  for (const w of removed) {
    const { u, n } = wallFrame(w)
    const probe = ring(strip(w, 0.08))
    const s = ring(strip(w, 0.03))
    // each room touching the wall: which side it is on and which stretch of the wall it runs along
    const touching = d.rooms.flatMap((r) => {
      if (r.polygon.length < 3) return []
      const pts = polygonClipping.intersection(ring(r.polygon), probe).flatMap((p) => p[0] as Vec2[])
      if (!pts.length) return []
      const ts = pts.map((p) => (p[0] - w.a[0]) * u[0] + (p[1] - w.a[1]) * u[1])
      const side = pts.reduce((m, p) => m + (p[0] - w.a[0]) * n[0] + (p[1] - w.a[1]) * n[1], 0) > 0
      return [{ r, side, t0: Math.min(...ts), t1: Math.max(...ts) }]
    })
    // rooms facing each other across the removed wall become one room
    const group = touching.map((_, i) => i)
    const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])))
    touching.forEach((a, i) =>
      touching.forEach((b, j) => {
        if (j > i && a.side !== b.side && Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0) > 0.05) group[root(j)] = root(i)
      }),
    )
    const gone = new Set<string>()
    for (const g of new Set(touching.map((_, i) => root(i)))) {
      const rooms = touching.filter((_, i) => root(i) === g).map((x) => x.r)
      const keep = rooms.reduce((m, r) => (polygonArea(r.polygon) > polygonArea(m.polygon) ? r : m))
      const reach = polygonClipping.intersection(s, polygonClipping.union(grow(keep.polygon, w), ...rooms.map((r) => grow(r.polygon, w))))
      const merged = polygonClipping.union(reach, ...rooms.map((r) => ring(r.polygon)))
      if (merged.length === 1) {
        const poly = outer(merged)
        if (!poly) continue
        keep.polygon = poly
        rooms.filter((r) => r !== keep).forEach((r) => gone.add(r.id))
      } else {
        for (const r of rooms) {
          const poly = outer(polygonClipping.union(ring(r.polygon), polygonClipping.intersection(s, grow(r.polygon, w))))
          if (poly) r.polygon = poly
        }
      }
    }
    d.rooms = d.rooms.filter((r) => !gone.has(r.id))
  }
}

/** Band across the wall covering the stretch of wall the room runs along. */
function grow(poly: Vec2[], w: Wall): Polygon {
  const { u, n } = wallFrame(w)
  const ts = poly.map((p) => (p[0] - w.a[0]) * u[0] + (p[1] - w.a[1]) * u[1])
  const t0 = Math.min(...ts)
  const t1 = Math.max(...ts)
  const h = w.thickness + 1
  const at = (t: number, k: number) => add(add(w.a, mul(u, t)), mul(n, k))
  return ring([at(t0, h), at(t1, h), at(t1, -h), at(t0, -h)])
}
