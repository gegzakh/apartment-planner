import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ELECTRICAL_BY_TYPE, FLOOR_BY_KEY, FURNITURE_BY_TYPE, PLUMBING_BY_TYPE, RUN_STYLE } from '../lib/catalog'
import {
  add, dist, labelPoint, mul, nearestWall, openingFrame, planBounds, polygonArea, projectOnSegment, snap, sub, uid, wallCorners, wallFrame,
} from '../lib/geometry'
import { FINISH_BY_KEY } from '../lib/materials'
import { healRoomsAfterWallRemoval } from '../lib/rooms'
import { useStore } from '../lib/store'
import type { Fixture, Furniture, Opening, Plan, PipeKind, Vec2, Wall } from '../lib/types'

interface View { x: number; y: number; k: number }
type Drag =
  | { type: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { type: 'move'; kind: 'furniture' | 'electrical' | 'plumbing' | 'viewpoint'; id: string; off: Vec2 }
  | { type: 'wall'; id: string; start: Vec2; a: Vec2; b: Vec2 }
  | { type: 'wallEnd'; id: string; end: 'a' | 'b'; linked: { id: string; end: 'a' | 'b' }[] }
  | { type: 'opening'; id: string }
  | { type: 'roomVertex'; id: string; index: number }
  | { type: 'room'; id: string; start: Vec2; poly: Vec2[] }
  | { type: 'runVertex'; id: string; index: number }
  | { type: 'rotate'; id: string; kind: 'furniture' }

const WALL_FILL = '#3d3f44'

export function svgId() {
  return 'plan-svg'
}

export default function Editor2D() {
  const plan = useStore((s) => s.plan)
  const layers = useStore((s) => s.layers)
  const tool = useStore((s) => s.tool)
  const toolArg = useStore((s) => s.toolArg)
  const selection = useStore((s) => s.selection)
  const snapStep = useStore((s) => s.snapStep)
  const { update, select, set, notify } = useStore.getState()

  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 60 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const [cursor, setCursor] = useState<Vec2 | null>(null)
  const [draft, setDraft] = useState<Vec2[]>([])
  const [box, setBox] = useState<[Vec2, Vec2] | null>(null)
  const [space, setSpace] = useState(false)
  const fitted = useRef(false)

  // ---- sizing / fit ----
  useEffect(() => {
    const el = svgRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    const b = planBounds(useStore.getState().plan)
    const k = Math.min(size.w / (b.maxX - b.minX), size.h / (b.maxY - b.minY)) * 0.92
    setView({ k, x: (b.minX + b.maxX) / 2 - size.w / 2 / k, y: (b.minY + b.maxY) / 2 - size.h / 2 / k })
  }, [size])

  useEffect(() => {
    if (!fitted.current && size.w > 100) {
      fit()
      fitted.current = true
    }
  }, [size, fit])
  useEffect(() => {
    const h = () => fit()
    window.addEventListener('plan:fit', h)
    return () => window.removeEventListener('plan:fit', h)
  }, [fit])

  // ---- keyboard ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.code === 'Space') setSpace(true)
      if (e.key === 'Escape') {
        finishDraft()
        setDraft([])
        setBox(null)
        useStore.getState().setTool('select')
      }
      if (e.key === 'Enter') finishDraft()
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  })

  useEffect(() => setDraft([]), [tool, toolArg])

  const toWorld = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect()
    return [view.x + (e.clientX - r.left) / view.k, view.y + (e.clientY - r.top) / view.k]
  }

  const snapPt = (p: Vec2, from?: Vec2, free = false): Vec2 => {
    // endpoint snapping
    const tol = 10 / view.k
    for (const w of plan.walls) for (const q of [w.a, w.b]) if (dist(p, q) < tol) return [...q] as Vec2
    let out: Vec2 = [snap(p[0], snapStep), snap(p[1], snapStep)]
    if (from && !free) {
      const d = sub(out, from)
      if (Math.abs(d[0]) > Math.abs(d[1]) * 3) out = [out[0], from[1]]
      else if (Math.abs(d[1]) > Math.abs(d[0]) * 3) out = [from[0], out[1]]
    }
    return out
  }

  function finishDraft() {
    const st = useStore.getState()
    if (st.tool === 'room' && draft.length >= 3) {
      const id = uid('r')
      update((d) => void d.rooms.push({ id, name: 'Room', polygon: draft, floor: d.settings.defaultFloor }))
      select({ kind: 'room', id })
    }
    if (st.tool === 'run' && draft.length >= 2) {
      const kind = (st.toolArg || 'wire') as PipeKind
      const id = uid('run')
      update((d) => void d.runs.push({ id, kind, points: draft, z: RUN_STYLE[kind].z }))
      select({ kind: 'run', id })
    }
    setDraft([])
  }

  // ---- pointer handlers ----
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    const p = toWorld({ clientX: cx, clientY: cy })
    const k = Math.max(5, Math.min(800, view.k * factor))
    setView({ k, x: p[0] - (cx - r.left) / k, y: p[1] - (cy - r.top) / k })
  }
  const zoomRef = useRef(zoomAt)
  useEffect(() => {
    zoomRef.current = zoomAt
  })
  // native non-passive listeners so pinch / Ctrl+wheel zoom only the plan, never the whole page
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const d = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY))
      zoomRef.current(Math.exp(-d * (e.ctrlKey ? 0.008 : 0.0015)), e.clientX, e.clientY)
    }
    const zoomKey = (e: Event) => {
      const r = el.getBoundingClientRect()
      zoomRef.current((e as CustomEvent<number>).detail, r.left + r.width / 2, r.top + r.height / 2)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('plan:zoom', zoomKey)
    return () => {
      el.removeEventListener('wheel', wheel)
      window.removeEventListener('plan:zoom', zoomKey)
    }
  }, [])

  const linkedEnds = (w: Wall, end: 'a' | 'b') => {
    const p = w[end]
    const out: { id: string; end: 'a' | 'b' }[] = []
    for (const o of plan.walls) {
      if (o.id === w.id) continue
      if (dist(o.a, p) < 0.02) out.push({ id: o.id, end: 'a' })
      if (dist(o.b, p) < 0.02) out.push({ id: o.id, end: 'b' })
    }
    return out
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = toWorld(e)
    if (e.button === 1 || e.button === 2 || space || tool === 'pan') {
      setDrag({ type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y })
      return
    }
    if (tool === 'erase') {
      setBox([p, p])
      return
    }
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | null
    const kind = target?.dataset.kind
    const id = target?.dataset.id
    const handle = (e.target as Element).closest('[data-handle]') as HTMLElement | null

    if (tool === 'select') {
      if (handle) {
        const h = handle.dataset.handle!
        const hid = handle.dataset.id!
        if (h === 'a' || h === 'b') {
          const w = plan.walls.find((x) => x.id === hid)!
          setDrag({ type: 'wallEnd', id: hid, end: h, linked: e.altKey ? [] : linkedEnds(w, h) })
        } else if (h.startsWith('rv')) setDrag({ type: 'roomVertex', id: hid, index: +h.slice(2) })
        else if (h.startsWith('pv')) setDrag({ type: 'runVertex', id: hid, index: +h.slice(2) })
        else if (h === 'rot') setDrag({ type: 'rotate', id: hid, kind: 'furniture' })
        return
      }
      if (!kind || !id) {
        select(null)
        setDrag({ type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y })
        return
      }
      select({ kind: kind as never, id })
      if (kind === 'furniture' || kind === 'electrical' || kind === 'plumbing' || kind === 'viewpoint') {
        const coll = kind === 'viewpoint' ? plan.viewpoints : (plan[kind === 'furniture' ? 'furniture' : kind] as (Furniture | Fixture)[])
        const it = coll.find((x) => x.id === id)!
        setDrag({ type: 'move', kind, id, off: [it.x - p[0], it.y - p[1]] })
      } else if (kind === 'wall') {
        const w = plan.walls.find((x) => x.id === id)!
        setDrag({ type: 'wall', id, start: p, a: w.a, b: w.b })
      } else if (kind === 'opening') setDrag({ type: 'opening', id })
      else if (kind === 'room' && e.detail < 2) {
        const r = plan.rooms.find((x) => x.id === id)!
        setDrag({ type: 'room', id, start: p, poly: r.polygon })
      }
      return
    }

    if (tool === 'wall') {
      const sp = snapPt(p, draft[draft.length - 1], e.shiftKey)
      if (draft.length && dist(sp, draft[draft.length - 1]) > 0.05) {
        const a = draft[draft.length - 1]
        update((d) => void d.walls.push({ id: uid('w'), a, b: sp, thickness: Number(toolArg) || 0.12 }))
        if (draft.length > 1 && dist(sp, draft[0]) < 0.02) {
          setDraft([])
          return
        }
      }
      setDraft((dr) => [...dr, sp])
      return
    }
    if (tool === 'door' || tool === 'window' || tool === 'opening') {
      const hit = nearestWall(plan, p, 0.5)
      if (!hit) return notify('Click on a wall to place it')
      const isWin = tool === 'window'
      const o: Opening = {
        id: uid('o'), type: tool, wallId: hit.wall.id, offset: hit.along, width: isWin ? 1.2 : tool === 'door' ? 0.8 : 0.9,
        height: isWin ? 1.5 : 2.1, sill: isWin ? 0.85 : 0, hinge: 'start', swing: 1,
      }
      update((d) => void d.openings.push(o))
      select({ kind: 'opening', id: o.id })
      return
    }
    if (tool === 'room' || tool === 'run') {
      const sp = snapPt(p, draft[draft.length - 1], e.shiftKey)
      if (e.detail >= 2) return finishDraft()
      if (tool === 'room' && draft.length >= 3 && dist(sp, draft[0]) < 12 / view.k) return finishDraft()
      setDraft((dr) => [...dr, sp])
      return
    }
    if (tool === 'measure' || tool === 'calibrate') {
      const sp = snapPt(p, draft[0], e.shiftKey)
      if (draft.length === 1) {
        if (tool === 'calibrate') {
          const measured = dist(draft[0], sp)
          const ans = window.prompt(`Measured ${measured.toFixed(3)} m. Enter the real length in metres:`, measured.toFixed(2))
          const real = ans ? parseFloat(ans.replace(',', '.')) : NaN
          if (real > 0 && measured > 0) {
            calibrate(draft[0], real / measured)
            notify(`Scaled plan by ×${(real / measured).toFixed(3)}`)
          }
          setDraft([])
        } else setDraft([draft[0], sp])
      } else setDraft([sp])
      return
    }
    if (tool === 'furniture') {
      const def = FURNITURE_BY_TYPE[toolArg] ?? FURNITURE_BY_TYPE.cabinet
      const id = uid('f')
      const sp = snapPt(p)
      update((d) => void d.furniture.push({ id, type: def.type, x: sp[0], y: sp[1], rotation: 0, width: def.w, depth: def.d, height: def.h, color: def.color }))
      select({ kind: 'furniture', id })
      return
    }
    if (tool === 'electrical' || tool === 'plumbing') {
      const defs = tool === 'electrical' ? ELECTRICAL_BY_TYPE : PLUMBING_BY_TYPE
      const def = defs[toolArg] ?? Object.values(defs)[0]
      let pos = snapPt(p)
      let rot = 0
      const wallMounted = def.z > 0 && !['radiator'].includes(def.type) ? true : def.type === 'radiator'
      if (wallMounted) {
        const hit = nearestWall(plan, p, 0.4)
        if (hit) {
          const { u, n } = wallFrame(hit.wall)
          const base = add(hit.wall.a, mul(u, hit.along))
          const side = Math.sign((p[0] - base[0]) * n[0] + (p[1] - base[1]) * n[1]) || 1
          pos = add(base, mul(n, side * (hit.wall.thickness / 2 + 0.01)))
          rot = (Math.atan2(n[1] * side, n[0] * side) * 180) / Math.PI
        }
      }
      const id = uid(tool === 'electrical' ? 'e' : 'p')
      update((d) => void d[tool].push({ id, type: def.type, x: pos[0], y: pos[1], rotation: rot, z: def.z < 0 ? d.settings.wallHeight : def.z }))
      select({ kind: tool, id })
      return
    }
    if (tool === 'viewpoint') {
      const id = uid('vp')
      update((d) => void d.viewpoints.push({ id, name: `View ${d.viewpoints.length + 1}`, x: p[0], y: p[1], z: 1.6, yaw: 0 }))
      select({ kind: 'viewpoint', id })
      set({ tool: 'select' })
    }
  }

  function calibrate(origin: Vec2, f: number) {
    const S = (q: Vec2): Vec2 => [origin[0] + (q[0] - origin[0]) * f, origin[1] + (q[1] - origin[1]) * f]
    update((d: Plan) => {
      d.walls.forEach((w) => { w.a = S(w.a); w.b = S(w.b); w.thickness *= f })
      d.openings.forEach((o) => { o.offset *= f; o.width *= f })
      d.rooms.forEach((r) => (r.polygon = r.polygon.map(S)))
      d.furniture.forEach((it) => { [it.x, it.y] = S([it.x, it.y]); it.width *= f; it.depth *= f
        if (it.outline) it.outline = it.outline.replace(/-?\d+(\.\d+)?/g, (m) => (parseFloat(m) * f).toFixed(3)) })
      d.electrical.forEach((it) => ([it.x, it.y] = S([it.x, it.y])))
      d.plumbing.forEach((it) => ([it.x, it.y] = S([it.x, it.y])))
      d.runs.forEach((r) => (r.points = r.points.map(S)))
      d.viewpoints.forEach((v) => ([v.x, v.y] = S([v.x, v.y])))
      d.overlays.forEach((o) => { [o.x, o.y] = S([o.x, o.y]); o.width *= f; o.height *= f })
      if (d.settings.scale) d.settings.scale = Math.max(1, Math.round(d.settings.scale * f))
    })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toWorld(e)
    setCursor(p)
    if (box) setBox([box[0], p])
    if (!drag) return
    if (drag.type === 'pan') {
      setView((v) => ({ ...v, x: drag.vx - (e.clientX - drag.sx) / v.k, y: drag.vy - (e.clientY - drag.sy) / v.k }))
      return
    }
    const co = { coalesce: `${drag.type}:${'id' in drag ? drag.id : ''}` }
    if (drag.type === 'move') {
      const np = snapPt(add(p, drag.off))
      update((d) => {
        const coll = drag.kind === 'viewpoint' ? d.viewpoints : drag.kind === 'furniture' ? d.furniture : d[drag.kind]
        const it = (coll as { id: string; x: number; y: number; rotation?: number }[]).find((x) => x.id === drag.id)
        if (!it) return
        if ((drag.kind === 'electrical' || drag.kind === 'plumbing') && !e.shiftKey) {
          const fx = it as Fixture
          const hit = fx.z > 0.05 && fx.z < d.settings.wallHeight - 0.05 ? nearestWall(d, p, 0.35) : null
          if (hit) {
            const { u, n } = wallFrame(hit.wall)
            const base = add(hit.wall.a, mul(u, hit.along))
            const side = Math.sign((p[0] - base[0]) * n[0] + (p[1] - base[1]) * n[1]) || 1
            ;[it.x, it.y] = add(base, mul(n, side * (hit.wall.thickness / 2 + 0.01)))
            it.rotation = (Math.atan2(n[1] * side, n[0] * side) * 180) / Math.PI
            return
          }
        }
        it.x = np[0]
        it.y = np[1]
      }, co)
    } else if (drag.type === 'wall') {
      const dv: Vec2 = [snap(p[0] - drag.start[0], snapStep), snap(p[1] - drag.start[1], snapStep)]
      update((d) => {
        const w = d.walls.find((x) => x.id === drag.id)
        if (!w) return
        const oldA = w.a, oldB = w.b
        w.a = add(drag.a, dv)
        w.b = add(drag.b, dv)
        for (const o of d.walls) {
          if (o.id === w.id) continue
          if (dist(o.a, oldA) < 0.02) o.a = w.a
          else if (dist(o.a, oldB) < 0.02) o.a = w.b
          if (dist(o.b, oldA) < 0.02) o.b = w.a
          else if (dist(o.b, oldB) < 0.02) o.b = w.b
        }
      }, co)
    } else if (drag.type === 'wallEnd') {
      update((d) => {
        const w = d.walls.find((x) => x.id === drag.id)
        if (!w) return
        const other = drag.end === 'a' ? w.b : w.a
        const np = snapPt(p, other, e.shiftKey)
        w[drag.end] = np
        for (const l of drag.linked) {
          const o = d.walls.find((x) => x.id === l.id)
          if (o) o[l.end] = np
        }
      }, co)
    } else if (drag.type === 'opening') {
      update((d) => {
        const o = d.openings.find((x) => x.id === drag.id)
        const w = o && d.walls.find((x) => x.id === o.wallId)
        if (!o || !w) return
        const r = projectOnSegment(p, w.a, w.b)
        o.offset = snap(r.along, snapStep)
      }, co)
    } else if (drag.type === 'roomVertex') {
      update((d) => {
        const r = d.rooms.find((x) => x.id === drag.id)
        if (r) r.polygon[drag.index] = snapPt(p)
      }, co)
    } else if (drag.type === 'room') {
      const dv: Vec2 = [snap(p[0] - drag.start[0], snapStep), snap(p[1] - drag.start[1], snapStep)]
      if (Math.hypot(...dv) < 0.05) return
      update((d) => {
        const r = d.rooms.find((x) => x.id === drag.id)
        if (r) r.polygon = drag.poly.map((q) => add(q, dv))
      }, co)
    } else if (drag.type === 'runVertex') {
      update((d) => {
        const r = d.runs.find((x) => x.id === drag.id)
        if (r) r.points[drag.index] = snapPt(p, r.points[drag.index - 1], e.shiftKey)
      }, co)
    } else if (drag.type === 'rotate') {
      update((d) => {
        const f = d.furniture.find((x) => x.id === drag.id)
        if (!f) return
        let deg = (Math.atan2(p[1] - f.y, p[0] - f.x) * 180) / Math.PI + 90
        if (!e.shiftKey) deg = Math.round(deg / 15) * 15
        f.rotation = ((deg % 360) + 360) % 360
      }, co)
    }
  }

  const onPointerUp = () => {
    setDrag(null)
    if (box) {
      eraseBox(box[0], box[1])
      setBox(null)
    }
  }

  function eraseBox(a: Vec2, b: Vec2) {
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
    const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
    if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return
    const inside = (p: Vec2) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1
    const pick = <T extends { id: string }>(list: T[], hit: (t: T) => boolean) => new Set(list.filter(hit).map((t) => t.id))
    // hidden layers are protected
    const wallCorners = (w: Wall): Vec2[] => {
      const L = dist(w.a, w.b) || 1
      const nx = (-(w.b[1] - w.a[1]) / L) * (w.thickness / 2)
      const ny = ((w.b[0] - w.a[0]) / L) * (w.thickness / 2)
      return [w.a, w.b].flatMap((p): Vec2[] => [[p[0] + nx, p[1] + ny], [p[0] - nx, p[1] - ny]])
    }
    const footprint = (f: Furniture): Vec2[] => {
      const r = (f.rotation * Math.PI) / 180
      const c = Math.cos(r)
      const s = Math.sin(r)
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]): Vec2 => {
        const x = (i * f.width) / 2
        const y = (j * f.depth) / 2
        return [f.x + x * c - y * s, f.y + x * s + y * c]
      })
    }
    const walls = pick(plan.walls, (w) => layers.walls && wallCorners(w).every(inside))
    const openingEnds = (o: Opening): Vec2[] => {
      const w = wallsById[o.wallId]
      if (!w) return []
      const L = dist(w.a, w.b) || 1
      const u: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
      return [o.offset - o.width / 2, o.offset + o.width / 2].map((t): Vec2 => [w.a[0] + u[0] * t, w.a[1] + u[1] * t])
    }
    const openings = pick(plan.openings, (o) => walls.has(o.wallId) || (layers.openings && !!wallsById[o.wallId] && openingEnds(o).every(inside)))
    const rooms = pick(plan.rooms, (r) => layers.rooms && r.polygon.every(inside))
    const furniture = pick(plan.furniture, (f) => layers.furniture && footprint(f).every(inside))
    const electrical = pick(plan.electrical, (f) => layers.electrical && inside([f.x, f.y]))
    const plumbing = pick(plan.plumbing, (f) => layers.plumbing && inside([f.x, f.y]))
    const runs = pick(plan.runs, (r) => (r.kind === 'wire' ? layers.wiring : layers.pipes) && r.points.every(inside))
    const viewpoints = pick(plan.viewpoints, (v) => layers.viewpoints && inside([v.x, v.y]))
    const n = [walls, openings, rooms, furniture, electrical, plumbing, runs, viewpoints].reduce((s, x) => s + x.size, 0)
    if (!n) {
      notify('Nothing was fully inside the box')
      return
    }
    update((d) => {
      const removedWalls = d.walls.filter((x) => walls.has(x.id))
      d.walls = d.walls.filter((x) => !walls.has(x.id))
      d.openings = d.openings.filter((x) => !openings.has(x.id))
      d.rooms = d.rooms.filter((x) => !rooms.has(x.id))
      d.furniture = d.furniture.filter((x) => !furniture.has(x.id))
      d.electrical = d.electrical.filter((x) => !electrical.has(x.id))
      d.plumbing = d.plumbing.filter((x) => !plumbing.has(x.id))
      d.runs = d.runs.filter((x) => !runs.has(x.id))
      d.viewpoints = d.viewpoints.filter((x) => !viewpoints.has(x.id))
      if (layers.rooms) healRoomsAfterWallRemoval(d, removedWalls)
    })
    select(null)
    notify(`Deleted ${n} object${n === 1 ? '' : 's'} — Ctrl+Z to undo`)
  }

  // ---- derived ----
  const wallsById = useMemo(() => Object.fromEntries(plan.walls.map((w) => [w.id, w])), [plan.walls])
  const sel = selection
  const isSel = (kind: string, id: string) => sel?.kind === kind && sel.id === id
  const px = 1 / view.k
  const T = `translate(${-view.x * view.k} ${-view.y * view.k}) scale(${view.k})`
  const gridStep = view.k > 120 ? 0.1 : view.k > 25 ? 0.5 : 1

  const cursorCls = space || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair'
  const last = draft[draft.length - 1]
  const preview = cursor && last ? snapPt(cursor, last) : null

  return (
    <svg
      id={svgId()}
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={size.w}
      height={size.h}
      style={{ cursor: cursorCls, display: 'block', background: '#fbfaf7', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="pat-tile" width="0.6" height="0.6" patternUnits="userSpaceOnUse">
          <path d="M0.6 0 L0 0 0 0.6" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="0.01" />
        </pattern>
        <pattern id="pat-wood" width="1.2" height="0.18" patternUnits="userSpaceOnUse">
          <path d="M0 0.18 H1.2 M0.4 0 V0.18" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="0.008" />
        </pattern>
        <pattern id="pat-herringbone" width="0.3" height="0.3" patternUnits="userSpaceOnUse">
          <path d="M0 0.3 L0.15 0.15 L0.3 0.3 M0 0.15 L0.15 0 L0.3 0.15" fill="none" stroke="#000" strokeOpacity="0.14" strokeWidth="0.008" />
        </pattern>
        <pattern id="pat-stone" width="0.8" height="0.8" patternUnits="userSpaceOnUse">
          <path d="M0 0.8 L0.8 0 M0.8 0.8 L0 0.8 0 0" fill="none" stroke="#000" strokeOpacity="0.08" strokeWidth="0.008" />
        </pattern>
        <pattern id="pat-plain" width="1" height="1" patternUnits="userSpaceOnUse" />
      </defs>
      <g transform={T}>
        {layers.grid && (
          <g data-export="skip">
            <Grid view={view} size={size} step={gridStep} />
          </g>
        )}
        {layers.overlays &&
          plan.overlays.filter((o) => o.visible).map((o) => (
            <image key={o.id} href={o.url} x={o.x} y={o.y} width={o.width} height={o.height} opacity={o.opacity} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />
          ))}
        {layers.rooms &&
          plan.rooms.map((r) => {
            const fd = FLOOR_BY_KEY[r.floor ?? plan.settings.defaultFloor]
            const pts = r.polygon.map((p) => p.join(',')).join(' ')
            return (
              <g key={r.id} data-kind="room" data-id={r.id}>
                <polygon points={pts} fill={r.floorMat ? r.floorMat.color ?? FINISH_BY_KEY[r.floorMat.finish ?? '']?.color ?? '#ddd' : r.floorColor ?? fd?.color ?? '#ddd'} fillOpacity={0.55} />
                <polygon points={pts} fill={`url(#pat-${fd?.pattern ?? 'plain'})`} stroke={isSel('room', r.id) ? '#2f80ed' : 'none'} strokeWidth={2 * px} />
              </g>
            )
          })}
        {layers.walls &&
          plan.walls.map((w) => (
            <polygon key={w.id} data-kind="wall" data-id={w.id} points={wallCorners(w).map((p) => p.join(',')).join(' ')}
              fill={isSel('wall', w.id) ? '#2f80ed' : WALL_FILL} stroke={isSel('wall', w.id) ? '#2f80ed' : WALL_FILL} strokeWidth={0.6 * px} />
          ))}
        {layers.openings && plan.openings.map((o) => wallsById[o.wallId] && (
          <OpeningShape key={o.id} o={o} w={wallsById[o.wallId]} selected={isSel('opening', o.id)} px={px} />
        ))}
        {layers.furniture && plan.furniture.map((f) => <FurnitureShape key={f.id} f={f} selected={isSel('furniture', f.id)} px={px} />)}
        {layers.pipes && plan.runs.filter((r) => r.kind !== 'wire').map((r) => <RunShape key={r.id} r={r} selected={isSel('run', r.id)} px={px} />)}
        {layers.wiring && plan.runs.filter((r) => r.kind === 'wire').map((r) => <RunShape key={r.id} r={r} selected={isSel('run', r.id)} px={px} />)}
        {layers.plumbing && plan.plumbing.map((f) => <FixtureShape key={f.id} f={f} kind="plumbing" selected={isSel('plumbing', f.id)} px={px} />)}
        {layers.electrical && plan.electrical.map((f) => <FixtureShape key={f.id} f={f} kind="electrical" selected={isSel('electrical', f.id)} px={px} />)}
        {layers.dimensions && plan.walls.map((w) => <WallDimension key={w.id} w={w} px={px} />)}
        {layers.labels &&
          plan.rooms.map((r) => {
            const c = labelPoint(r.polygon)
            const fs = Math.max(0.16, Math.min(0.3, 13 * px))
            return (
              <g key={r.id} style={{ pointerEvents: 'none' }}>
                <text x={c[0]} y={c[1]} fontSize={fs} textAnchor="middle" fontWeight={600} fill="#2b2d31">{r.name}</text>
                <text x={c[0]} y={c[1] + fs * 1.2} fontSize={fs * 0.85} textAnchor="middle" fill="#55595f">{polygonArea(r.polygon).toFixed(2)} m²</text>
              </g>
            )
          })}
        {layers.viewpoints &&
          plan.viewpoints.map((v) => (
            <g key={v.id} data-kind="viewpoint" data-id={v.id} transform={`translate(${v.x} ${v.y})`} data-export="skip">
              <circle r={10 * px} fill={isSel('viewpoint', v.id) ? '#2f80ed' : '#9b51e0'} stroke="#fff" strokeWidth={2 * px} />
              <text y={4 * px} fontSize={10 * px} textAnchor="middle" fill="#fff" fontWeight={700}>360</text>
            </g>
          ))}
        <CompareGhost px={px} />
        <SelectionHandles px={px} />
        {/* drafts */}
        {draft.length > 0 && (
          <g style={{ pointerEvents: 'none' }} data-export="skip">
            <polyline points={[...draft, ...(preview && (tool === 'wall' || tool === 'room' || tool === 'run') ? [preview] : [])].map((p) => p.join(',')).join(' ')}
              fill={tool === 'room' ? 'rgba(47,128,237,0.12)' : 'none'} stroke="#2f80ed" strokeWidth={tool === 'wall' ? Number(toolArg) || 0.12 : 2 * px} strokeOpacity={tool === 'wall' ? 0.5 : 1} />
            {draft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4 * px} fill="#2f80ed" />)}
            {preview && last && (
              <text x={(last[0] + preview[0]) / 2} y={(last[1] + preview[1]) / 2 - 8 * px} fontSize={12 * px} fill="#2f80ed" textAnchor="middle" fontWeight={600}>
                {dist(last, preview).toFixed(2)} m
              </text>
            )}
          </g>
        )}
        {box && (
          <rect
            x={Math.min(box[0][0], box[1][0])} y={Math.min(box[0][1], box[1][1])}
            width={Math.abs(box[1][0] - box[0][0])} height={Math.abs(box[1][1] - box[0][1])}
            fill="rgba(235, 87, 87, 0.12)" stroke="#eb5757" strokeWidth={1.5 * px} strokeDasharray={`${6 * px} ${4 * px}`}
          />
        )}
        {(tool === 'measure' || tool === 'calibrate') && draft.length > 0 && cursor && (
          <MeasureLine a={draft[0]} b={draft[1] ?? snapPt(cursor, draft[0])} px={px} />
        )}
      </g>
    </svg>
  )
}

function Grid({ view, size, step }: { view: View; size: { w: number; h: number }; step: number }) {
  const x0 = Math.floor(view.x / step) * step
  const y0 = Math.floor(view.y / step) * step
  const x1 = view.x + size.w / view.k
  const y1 = view.y + size.h / view.k
  const lines: React.ReactElement[] = []
  let i = 0
  for (let x = x0; x <= x1 && i < 600; x += step, i++)
    lines.push(<line key={`x${i}`} x1={x} y1={y0} x2={x} y2={y1} stroke="#000" strokeOpacity={Math.abs(x % 1) < 1e-6 ? 0.1 : 0.04} strokeWidth={1 / view.k} />)
  for (let y = y0; y <= y1 && i < 1200; y += step, i++)
    lines.push(<line key={`y${i}`} x1={x0} y1={y} x2={x1} y2={y} stroke="#000" strokeOpacity={Math.abs(y % 1) < 1e-6 ? 0.1 : 0.04} strokeWidth={1 / view.k} />)
  return <g style={{ pointerEvents: 'none' }}>{lines}</g>
}

function OpeningShape({ o, w, selected, px }: { o: Opening; w: Wall; selected: boolean; px: number }) {
  const { c, angle } = openingFrame(o, w)
  const t = w.thickness
  const hw = o.width / 2
  const stroke = selected ? '#2f80ed' : '#2b2d31'
  const deg = (angle * 180) / Math.PI
  const sw = Math.max(1.2 * px, 0.012)
  let symbol: React.ReactElement | null = null
  if (o.type === 'door') {
    const hx = o.hinge === 'end' ? hw : -hw
    const s = o.swing ?? 1
    const tipX = hx
    const tipY = s * o.width
    const endX = -hx
    const sweep = (o.hinge === 'end') === (s > 0) ? 0 : 1
    symbol = (
      <g>
        <line x1={hx} y1={s * t / 2} x2={tipX} y2={tipY + (s * t) / 2} stroke={stroke} strokeWidth={sw * 2} />
        <path d={`M ${tipX} ${tipY + (s * t) / 2} A ${o.width} ${o.width} 0 0 ${sweep} ${endX} ${(s * t) / 2}`} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={`${4 * px} ${3 * px}`} />
      </g>
    )
  } else if (o.type === 'window') {
    symbol = (
      <g>
        <rect x={-hw} y={-t / 2} width={o.width} height={t} fill="#dff0fb" stroke={stroke} strokeWidth={sw} />
        <line x1={-hw} y1={0} x2={hw} y2={0} stroke={stroke} strokeWidth={sw} />
      </g>
    )
  }
  return (
    <g data-kind="opening" data-id={o.id} transform={`translate(${c[0]} ${c[1]}) rotate(${deg})`}>
      <rect x={-hw} y={-t / 2 - 0.01} width={o.width} height={t + 0.02} fill="#fbfaf7" />
      <line x1={-hw} y1={-t / 2} x2={-hw} y2={t / 2} stroke={stroke} strokeWidth={sw} />
      <line x1={hw} y1={-t / 2} x2={hw} y2={t / 2} stroke={stroke} strokeWidth={sw} />
      {symbol}
      {selected && <rect x={-hw} y={-t / 2} width={o.width} height={t} fill="none" stroke="#2f80ed" strokeWidth={2 * px} />}
    </g>
  )
}

function FurnitureShape({ f, selected, px }: { f: Furniture; selected: boolean; px: number }) {
  const def = FURNITURE_BY_TYPE[f.type]
  const w = f.width
  const d = f.depth
  const stroke = selected ? '#2f80ed' : '#5a5e66'
  const sw = Math.max(1 * px, 0.008)
  const glyph = (() => {
    switch (f.type) {
      case 'bed':
      case 'bed_single': {
        const pw = w > 1.2 ? w / 2 - 0.08 : w - 0.16
        return (
          <g>
            <rect x={-w / 2 + 0.06} y={-d / 2 + 0.08} width={pw} height={0.32} rx={0.05} fill="#fff" stroke={stroke} strokeWidth={sw} />
            {w > 1.2 && <rect x={0.02} y={-d / 2 + 0.08} width={pw} height={0.32} rx={0.05} fill="#fff" stroke={stroke} strokeWidth={sw} />}
            <line x1={-w / 2} y1={-d / 2 + 0.55} x2={w / 2} y2={-d / 2 + 0.55} stroke={stroke} strokeWidth={sw} />
          </g>
        )
      }
      case 'toilet':
        return <ellipse cx={0} cy={0.08} rx={w / 2 - 0.02} ry={d / 2 - 0.15} fill="#fff" stroke={stroke} strokeWidth={sw} />
      case 'basin':
      case 'kitchen_sink':
        return <ellipse cx={0} cy={0.03} rx={w / 2 - 0.08} ry={d / 2 - 0.1} fill="#fff" stroke={stroke} strokeWidth={sw} />
      case 'bathtub':
        return <rect x={-w / 2 + 0.08} y={-d / 2 + 0.08} width={w - 0.16} height={d - 0.16} rx={0.25} fill="#fff" stroke={stroke} strokeWidth={sw} />
      case 'stove':
        return <g>{[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], i) => <circle key={i} cx={(a * w) / 4.5} cy={(b * d) / 4.5} r={Math.min(w, d) / 7} fill="none" stroke={stroke} strokeWidth={sw} />)}</g>
      case 'fridge': {
        const r = Math.min(w, d) / 4
        return <path d={`M${-r} 0 L${r} 0 M0 ${-r} L0 ${r} M${-r * 0.7} ${-r * 0.7} L${r * 0.7} ${r * 0.7} M${r * 0.7} ${-r * 0.7} L${-r * 0.7} ${r * 0.7}`} stroke={stroke} strokeWidth={sw} />
      }
      case 'oven_tower': {
        const r = Math.min(w, d) / 4
        return <path d={`M${-w / 2 + 0.05} ${-d / 2 + 0.05} L${w / 2 - 0.05} ${-d / 2 + 0.05} L${w / 2 - 0.05} ${d / 2 - 0.05} L${-w / 2 + 0.05} ${d / 2 - 0.05} Z M${r * 0.3} ${-r} L${-r * 0.4} ${r * 0.1} L${r * 0.4} ${-r * 0.1} L${-r * 0.3} ${r}`} fill="none" stroke={stroke} strokeWidth={sw} />
      }
      case 'oven': {
        const r = Math.min(w, d) / 4
        return <path d={`M${r * 0.3} ${-r} L${-r * 0.4} ${r * 0.1} L${r * 0.4} ${-r * 0.1} L${-r * 0.3} ${r}`} fill="none" stroke={stroke} strokeWidth={sw} />
      }
      case 'dishwasher': {
        const r = Math.min(w, d) / 5
        return <path d={`M0 ${-r * 1.4} L${r * 0.75} ${r * 0.1} A${r * 0.8} ${r * 0.8} 0 1 1 ${-r * 0.75} ${r * 0.1} Z`} fill="none" stroke={stroke} strokeWidth={sw} />
      }
      case 'washing_machine':
        return <circle r={Math.min(w, d) * 0.32} fill="#fff" stroke={stroke} strokeWidth={sw} />
      case 'wardrobe':
      case 'cabinet':
        return <path d={`M${-w / 2} ${-d / 2} L${w / 2} ${d / 2} M${w / 2} ${-d / 2} L${-w / 2} ${d / 2}`} stroke={stroke} strokeWidth={sw * 0.7} strokeOpacity={0.6} />
      case 'sofa':
      case 'sofa_corner':
        return <rect x={-w / 2 + 0.12} y={-d / 2 + 0.22} width={w - 0.24} height={d - 0.26} fill="none" stroke={stroke} strokeWidth={sw} />
      case 'table_round':
      case 'plant':
        return null
      default:
        return null
    }
  })()
  const round = f.type === 'table_round' || f.type === 'plant'
  return (
    <g data-kind="furniture" data-id={f.id} transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`}>
      {f.outline && f.type === 'generic' ? (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="#fff" fillOpacity={0.01} />
          <path d={f.outline} fill="none" stroke={stroke} strokeWidth={sw} />
        </>
      ) : round ? (
        <ellipse rx={w / 2} ry={d / 2} fill={f.type === 'plant' ? '#9cc59a' : (f.color ?? def?.color ?? '#ccc')} fillOpacity={0.45} stroke={stroke} strokeWidth={sw} />
      ) : (
        <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={0.02} fill={f.color ?? def?.color ?? '#ccc'} fillOpacity={0.35} stroke={stroke} strokeWidth={sw} />
      )}
      {glyph}
      {selected && <rect x={-w / 2 - 0.03} y={-d / 2 - 0.03} width={w + 0.06} height={d + 0.06} fill="none" stroke="#2f80ed" strokeWidth={2 * px} strokeDasharray={`${5 * px} ${3 * px}`} />}
    </g>
  )
}

function FixtureShape({ f, kind, selected, px }: { f: Fixture; kind: 'electrical' | 'plumbing'; selected: boolean; px: number }) {
  const def = (kind === 'electrical' ? ELECTRICAL_BY_TYPE : PLUMBING_BY_TYPE)[f.type]
  const r = Math.max(0.09, 9 * px)
  const color = def?.color ?? '#888'
  const isLight = f.type.includes('light') || f.type === 'led_strip'
  return (
    <g data-kind={kind} data-id={f.id} transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`}>
      {kind === 'electrical' && isLight ? (
        <g>
          <circle r={r} fill="#fffbe6" stroke={color} strokeWidth={r * 0.18} />
          <path d={`M${-r * 0.7} ${-r * 0.7} L${r * 0.7} ${r * 0.7} M${r * 0.7} ${-r * 0.7} L${-r * 0.7} ${r * 0.7}`} stroke={color} strokeWidth={r * 0.15} />
        </g>
      ) : (
        <g>
          <rect x={-r} y={-r * 0.75} width={r * 2} height={r * 1.5} rx={r * 0.3} fill="#fff" stroke={color} strokeWidth={r * 0.18} />
          <text y={r * 0.32} fontSize={r * (def?.symbol.length > 2 ? 0.7 : 0.9)} textAnchor="middle" fill={color} fontWeight={700} style={{ pointerEvents: 'none' }}>{def?.symbol ?? '?'}</text>
        </g>
      )}
      {selected && <circle r={r * 1.5} fill="none" stroke="#2f80ed" strokeWidth={2 * px} />}
    </g>
  )
}

function RunShape({ r, selected, px }: { r: { id: string; kind: PipeKind; points: Vec2[] }; selected: boolean; px: number }) {
  const st = RUN_STYLE[r.kind]
  const pts = r.points.map((p) => p.join(',')).join(' ')
  return (
    <g data-kind="run" data-id={r.id}>
      <polyline points={pts} fill="none" stroke="transparent" strokeWidth={10 * px} />
      <polyline points={pts} fill="none" stroke={selected ? '#2f80ed' : st.color} strokeWidth={Math.max(2.2 * px, st.radius * 1.4)} strokeDasharray={st.dash} strokeLinejoin="round" />
    </g>
  )
}

function WallDimension({ w, px }: { w: Wall; px: number }) {
  const { L, n, angle } = wallFrame(w)
  if (L < 0.4) return null
  const off = w.thickness / 2 + 14 * px
  const a = add(w.a, mul(n, off))
  const b = add(w.b, mul(n, off))
  const m = mul(add(a, b), 0.5)
  let deg = (angle * 180) / Math.PI
  if (deg > 90 || deg <= -90) deg += 180
  return (
    <g style={{ pointerEvents: 'none' }} opacity={0.75}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#8a6d3b" strokeWidth={0.8 * px} />
      <line x1={a[0] - n[0] * 4 * px} y1={a[1] - n[1] * 4 * px} x2={a[0] + n[0] * 4 * px} y2={a[1] + n[1] * 4 * px} stroke="#8a6d3b" strokeWidth={0.8 * px} />
      <line x1={b[0] - n[0] * 4 * px} y1={b[1] - n[1] * 4 * px} x2={b[0] + n[0] * 4 * px} y2={b[1] + n[1] * 4 * px} stroke="#8a6d3b" strokeWidth={0.8 * px} />
      <text transform={`translate(${m[0]} ${m[1]}) rotate(${deg})`} y={-3 * px} fontSize={10 * px} textAnchor="middle" fill="#8a6d3b">{L.toFixed(2)}</text>
    </g>
  )
}

function MeasureLine({ a, b, px }: { a: Vec2; b: Vec2; px: number }) {
  const m = mul(add(a, b), 0.5)
  return (
    <g style={{ pointerEvents: 'none' }} data-export="skip">
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#eb5757" strokeWidth={2 * px} strokeDasharray={`${6 * px} ${4 * px}`} />
      <circle cx={a[0]} cy={a[1]} r={4 * px} fill="#eb5757" />
      <circle cx={b[0]} cy={b[1]} r={4 * px} fill="#eb5757" />
      <rect x={m[0] - 34 * px} y={m[1] - 24 * px} width={68 * px} height={18 * px} rx={4 * px} fill="#eb5757" />
      <text x={m[0]} y={m[1] - 11 * px} fontSize={12 * px} fill="#fff" textAnchor="middle" fontWeight={700}>{dist(a, b).toFixed(2)} m</text>
    </g>
  )
}

function SelectionHandles({ px }: { px: number }) {
  const plan = useStore((s) => s.plan)
  const sel = useStore((s) => s.selection)
  const tool = useStore((s) => s.tool)
  if (!sel || tool !== 'select') return null
  const H = (p: Vec2, h: string, id: string, color = '#2f80ed') => (
    <circle key={h} data-handle={h} data-id={id} cx={p[0]} cy={p[1]} r={6 * px} fill="#fff" stroke={color} strokeWidth={2 * px} style={{ cursor: 'move' }} />
  )
  if (sel.kind === 'wall') {
    const w = plan.walls.find((x) => x.id === sel.id)
    if (!w) return null
    return <g data-export="skip">{H(w.a, 'a', w.id)}{H(w.b, 'b', w.id)}</g>
  }
  if (sel.kind === 'room') {
    const r = plan.rooms.find((x) => x.id === sel.id)
    if (!r) return null
    return <g data-export="skip">{r.polygon.map((p, i) => H(p, `rv${i}`, r.id))}</g>
  }
  if (sel.kind === 'run') {
    const r = plan.runs.find((x) => x.id === sel.id)
    if (!r) return null
    return <g data-export="skip">{r.points.map((p, i) => H(p, `pv${i}`, r.id))}</g>
  }
  if (sel.kind === 'furniture') {
    const f = plan.furniture.find((x) => x.id === sel.id)
    if (!f) return null
    const rad = (f.rotation * Math.PI) / 180
    const p: Vec2 = [f.x + Math.sin(rad) * (f.depth / 2 + 24 * px), f.y - Math.cos(rad) * (f.depth / 2 + 24 * px)]
    return <g data-export="skip">{H(p, 'rot', f.id, '#27ae60')}</g>
  }
  return null
}

function CompareGhost({ px }: { px: number }) {
  const compare = useStore((s) => s.compareWith)
  const versions = useStore((s) => s.versions)
  const v = versions.find((x) => x.id === compare)
  if (!v) return null
  return (
    <g style={{ pointerEvents: 'none' }} data-export="skip">
      {v.plan.walls.map((w) => (
        <polygon key={w.id} points={wallCorners(w).map((p) => p.join(',')).join(' ')} fill="#eb5757" fillOpacity={0.18} stroke="#eb5757" strokeWidth={1.5 * px} strokeDasharray={`${5 * px} ${3 * px}`} />
      ))}
      {v.plan.furniture.map((f) => (
        <rect key={f.id} x={-f.width / 2} y={-f.depth / 2} width={f.width} height={f.depth} transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`} fill="none" stroke="#eb5757" strokeWidth={1.2 * px} strokeDasharray={`${4 * px} ${3 * px}`} />
      ))}
    </g>
  )
}
