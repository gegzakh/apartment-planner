import polygonClipping, { type Polygon } from 'polygon-clipping'
import { add, mul, polygonArea, wallFrame } from './geometry'
import type { Plan, Vec2, Wall } from './types'

const ring = (pts: Vec2[]): Polygon => [[...pts, pts[0]].map(([x, y]) => [x, y] as [number, number])]

/** The one outline of a union, or null if it splits apart or encloses a real void (rooms have no holes). */
function single(mp: Polygon[]): Vec2[] | null {
  // pockets under 0.25 m² are pillars/shafts left by the old wall: floor under them is hidden anyway
  if (mp.length !== 1 || mp[0].slice(1).some((hole) => polygonArea(hole as Vec2[]) >= 0.25)) return null
  return simplify((mp[0][0] as Vec2[]).slice(0, -1))
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

/**
 * After walls are removed, rooms facing each other across a wall become one
 * room (keeping the larger room's name and finishes) and the strip where the
 * wall stood is floored.
 */
export function healRoomsAfterWallRemoval(d: Plan, removed: Wall[]) {
  for (const w of removed) {
    const { u, n } = wallFrame(w)
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    const h = w.thickness / 2 + 0.08
    // rectangle in wall coordinates: t along the wall, k across it
    const rect = (t0: number, t1: number, k0: number, k1: number) => {
      const at = (t: number, k: number) => add(add(w.a, mul(u, t)), mul(n, k))
      return ring([at(t0, k0), at(t1, k0), at(t1, k1), at(t0, k1)])
    }
    const probe = rect(-0.01, len + 0.01, -h, h)
    // each separate contact of a room with the wall: which side and which stretch
    const touching = d.rooms.flatMap((r) => {
      if (r.polygon.length < 3) return []
      const spans = polygonClipping.intersection(ring(r.polygon), probe).map((p) => {
        const pts = p[0] as Vec2[]
        const ts = pts.map((q) => (q[0] - w.a[0]) * u[0] + (q[1] - w.a[1]) * u[1])
        const ks = pts.reduce((m, q) => m + (q[0] - w.a[0]) * n[0] + (q[1] - w.a[1]) * n[1], 0)
        return { t0: Math.min(...ts), t1: Math.max(...ts), side: ks > 0 }
      })
      return spans.length ? [{ r, spans }] : []
    })
    // half the wall strip goes to the room on that side; where rooms face each other the whole strip joins them
    const fill = (x: (typeof touching)[number]) => x.spans.map((s) => (s.side ? rect(s.t0, s.t1, 0, h) : rect(s.t0, s.t1, -h, 0)))
    const group = touching.map((_, i) => i)
    const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])))
    const bridges: { i: number; poly: Polygon }[] = []
    touching.forEach((a, i) =>
      touching.forEach((b, j) => {
        if (j <= i) return
        for (const sa of a.spans)
          for (const sb of b.spans) {
            const t0 = Math.max(sa.t0, sb.t0)
            const t1 = Math.min(sa.t1, sb.t1)
            if (sa.side !== sb.side && t1 - t0 > 0.05) {
              group[root(j)] = root(i)
              bridges.push({ i, poly: rect(t0, t1, -h, h) })
            }
          }
      }),
    )
    const gone = new Set<string>()
    for (const g of new Set(touching.map((_, i) => root(i)))) {
      const members = touching.filter((_, i) => root(i) === g)
      const keep = members.reduce((m, x) => (polygonArea(x.r.polygon) > polygonArea(m.r.polygon) ? x : m)).r
      const parts = [...members.flatMap((x) => [ring(x.r.polygon), ...fill(x)]), ...bridges.filter((b) => root(b.i) === g).map((b) => b.poly)]
      const merged = members.length > 1 ? single(polygonClipping.union(parts[0], ...parts.slice(1))) : null
      if (merged) {
        keep.polygon = merged
        members.forEach((x) => x.r !== keep && gone.add(x.r.id))
        continue
      }
      for (const x of members) {
        const poly = single(polygonClipping.union(ring(x.r.polygon), ...fill(x)))
        if (poly) x.r.polygon = poly
      }
    }
    d.rooms = d.rooms.filter((r) => !gone.has(r.id))
  }
}
