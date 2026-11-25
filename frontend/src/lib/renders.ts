import * as THREE from 'three'
import { labelPoint, pointInPolygon, wallCorners } from './geometry'
import { useStore } from './store'
import { threeRef } from './three-ref'
import type { Plan, Room, Vec2 } from './types'

export interface Shot {
  id: string
  roomId: string
  name: string
  /** plan coordinates: x, y on the floor, z = eye height */
  pos: [number, number, number]
  target: [number, number, number]
  fov: number
}

const EYE = 1.55
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']
/** Compass name of a plan direction (plan up = north). */
function compass(dx: number, dy: number) {
  const a = Math.atan2(dy, dx)
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]
}

function inset(p: Vec2, c: Vec2, d: number): Vec2 {
  const dx = c[0] - p[0],
    dy = c[1] - p[1]
  const L = Math.hypot(dx, dy) || 1
  return [p[0] + (dx / L) * d, p[1] + (dy / L) * d]
}

function inFurniture(plan: Plan, p: Vec2, margin: number) {
  return plan.furniture.some((f) => {
    if ((f.elevation ?? 0) > EYE || f.height < 1.0) return false
    const a = (-f.rotation * Math.PI) / 180
    const dx = p[0] - f.x,
      dy = p[1] - f.y
    const lx = dx * Math.cos(a) - dy * Math.sin(a),
      ly = dx * Math.sin(a) + dy * Math.cos(a)
    return Math.abs(lx) < f.width / 2 + margin && Math.abs(ly) < f.depth / 2 + margin
  })
}

type Seg = [Vec2, Vec2]

/** Everything that blocks a camera's view at eye height: walls and tall furniture (doors are closed for renders). */
function obstacles(plan: Plan): Seg[] {
  const segs: Seg[] = []
  const box = (pts: Vec2[]) => pts.forEach((a, i) => segs.push([a, pts[(i + 1) % pts.length]]))
  for (const w of plan.walls) box(wallCorners(w))
  for (const f of plan.furniture) {
    if (f.height < 1.3 || (f.elevation ?? 0) > 1.2) continue
    const a = (f.rotation * Math.PI) / 180,
      ca = Math.cos(a),
      sa = Math.sin(a)
    box(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => [f.x + (x * f.width * ca - y * f.depth * sa) / 2, f.y + (x * f.width * sa + y * f.depth * ca) / 2] as Vec2),
    )
  }
  return segs
}

const MAX_RAY = 8
/** Distance from `p` along angle `a` to the first obstacle. */
function ray(segs: Seg[], p: Vec2, a: number) {
  const dx = Math.cos(a),
    dy = Math.sin(a)
  let best = MAX_RAY
  for (const [s, e] of segs) {
    const ex = e[0] - s[0],
      ey = e[1] - s[1]
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-9) continue
    const qx = s[0] - p[0],
      qy = s[1] - p[1]
    const t = (qx * ey - qy * ex) / den
    const v = (qx * dy - qy * dx) / den
    if (t > 0 && v >= 0 && v <= 1 && t < best) best = t
  }
  return best
}

/** How open a view is: mean free distance over the horizontal field of view, penalising a blocked centre. */
function viewScore(segs: Seg[], p: Vec2, yaw: number, hfov: number) {
  const N = 17
  let sum = 0,
    centre = MAX_RAY
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1) - 0.5
    const d = Math.min(ray(segs, p, yaw + k * hfov), 6)
    sum += d
    if (Math.abs(k) < 0.2) centre = Math.min(centre, d)
  }
  return (sum / N) * Math.min(1, centre / 1.5)
}

/** Free space all around a spot, so the camera never sits inside a wall's near-clip range. */
function clearance(segs: Seg[], p: Vec2) {
  let m = MAX_RAY
  for (let i = 0; i < 12; i++) m = Math.min(m, ray(segs, p, (i / 12) * Math.PI * 2))
  return m
}

const HFOV = 2 * Math.atan(Math.tan((70 * Math.PI) / 360) * (16 / 9))

/** Best eye spot and look direction near `p`: tries a few insets and yaws around `yaw0`. */
function bestView(plan: Plan, poly: Vec2[], segs: Seg[], p: Vec2, toward: Vec2, yaw0: number, spread: number) {
  let best: { pos: Vec2; yaw: number; score: number } | null = null
  const dx = toward[0] - p[0],
    dy = toward[1] - p[1]
  const L = Math.hypot(dx, dy) || 1
  for (const strict of [true, false]) {
    if (best) break
    for (const d of [0, 0.25, 0.5, 0.8]) {
      const q: Vec2 = [p[0] + (dx / L) * d, p[1] + (dy / L) * d]
      if (!pointInPolygon(q, poly) || (strict && (inFurniture(plan, q, 0.15) || clearance(segs, q) < 0.3))) continue
      for (let k = -spread; k <= spread + 1e-6; k += Math.PI / 36) {
        const score = viewScore(segs, q, yaw0 + k, HFOV) - d * 0.3 - Math.abs(k) * 0.4
        if (!best || score > best.score) best = { pos: q, yaw: yaw0 + k, score }
      }
    }
  }
  return best
}

/** Camera positions that show a room from every corner and from the middle of each long side, aimed at the most open view. */
export function roomShots(plan: Plan, room: Room): Shot[] {
  const c = labelPoint(room.polygon)
  const poly = room.polygon
  const segs = obstacles(plan)
  const out: Shot[] = []
  const views: { pos: Vec2; yaw: number }[] = []
  const distinct = (pos: Vec2, yaw: number) => !views.some((v) => Math.hypot(v.pos[0] - pos[0], v.pos[1] - pos[1]) < 0.6 && Math.abs(Math.atan2(Math.sin(v.yaw - yaw), Math.cos(v.yaw - yaw))) < 0.35)
  const cands: {
    id: string
    name: (yaw: number) => string
    v: { pos: Vec2; yaw: number; score: number }
  }[] = []
  const add = (id: string, name: (yaw: number) => string, v: { pos: Vec2; yaw: number; score: number } | null) => {
    if (v) cands.push({ id, name, v })
  }
  const emit = () => {
    const top = Math.max(0, ...cands.map((x) => x.v.score))
    for (const { id, name, v } of cands) {
      if (v.score < Math.min(1.0, top * 0.5) || !distinct(v.pos, v.yaw)) continue
      views.push(v)
      out.push({
        id,
        roomId: room.id,
        name: name(v.yaw),
        pos: [v.pos[0], v.pos[1], EYE],
        target: [v.pos[0] + Math.cos(v.yaw) * 4, v.pos[1] + Math.sin(v.yaw) * 4, 1.2],
        fov: 70,
      })
    }
  }
  const look = (yaw: number) => compass(Math.cos(yaw), Math.sin(yaw))
  const corners = poly
    .map((p, i) => {
      const a = poly[(i + poly.length - 1) % poly.length],
        b = poly[(i + 1) % poly.length]
      const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])
      return { p, cross }
    })
    .filter((v) => pointInPolygon(inset(v.p, c, 0.4), poly))
  const sign = Math.sign(corners.reduce((s, v) => s + v.cross, 0)) || 1
  const convex = corners
    .filter((v) => Math.sign(v.cross) === sign)
    .map((v) => ({ ...v, d: Math.hypot(v.p[0] - c[0], v.p[1] - c[1]) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 4)
  convex.forEach(({ p }, i) => {
    const q = inset(p, c, 0.45)
    add(`${room.id}-c${i}`, (y) => `Corner ${i + 1} → looking ${look(y)}`, bestView(plan, poly, segs, q, c, Math.atan2(c[1] - p[1], c[0] - p[0]), Math.PI / 4))
  })
  const sides = poly
    .map((a, i) => ({ a, b: poly[(i + 1) % poly.length] }))
    .map(({ a, b }) => ({ a, b, L: Math.hypot(b[0] - a[0], b[1] - a[1]) }))
    .filter((s) => s.L > 1.2)
    .sort((x, y) => y.L - x.L)
    .slice(0, 4)
  sides.forEach(({ a, b }, i) => {
    const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    let n: Vec2 = [-(b[1] - a[1]), b[0] - a[0]]
    const L = Math.hypot(n[0], n[1]) || 1
    n = [n[0] / L, n[1] / L]
    if (!pointInPolygon([m[0] + n[0] * 0.3, m[1] + n[1] * 0.3], poly)) n = [-n[0], -n[1]]
    const q: Vec2 = [m[0] + n[0] * 0.35, m[1] + n[1] * 0.35]
    add(`${room.id}-s${i}`, (y) => `From ${compass(-n[0], -n[1])} wall → looking ${look(y)}`, bestView(plan, poly, segs, q, [m[0] + n[0] * 5, m[1] + n[1] * 5], Math.atan2(n[1], n[0]), Math.PI / 6))
  })
  emit()
  const top = convex.map(({ p }) => bestView(plan, poly, segs, inset(p, c, 0.3), c, Math.atan2(c[1] - p[1], c[0] - p[0]), Math.PI / 6)).sort((x, y) => (y?.score ?? 0) - (x?.score ?? 0))[0]
  if (top)
    out.push({
      id: `${room.id}-top`,
      roomId: room.id,
      name: 'Overview from high corner',
      pos: [top.pos[0], top.pos[1], 2.2],
      target: [top.pos[0] + Math.cos(top.yaw) * 4, top.pos[1] + Math.sin(top.yaw) * 4, 0.5],
      fov: 80,
    })
  for (const v of plan.viewpoints) {
    if (!pointInPolygon([v.x, v.y], poly)) continue
    const yaw = (v.yaw * Math.PI) / 180
    out.push({
      id: `${room.id}-vp-${v.id}`,
      roomId: room.id,
      name: `Viewpoint: ${v.name}`,
      pos: [v.x, v.y, v.z],
      target: [v.x + Math.cos(yaw) * 5, v.y + Math.sin(yaw) * 5, v.z - 0.3],
      fov: 70,
    })
  }
  return out
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

/**
 * Renders shots with ceilings on, cutaway off and soft room lights added, then restores the live view.
 * Calls `onShot` with each finished image.
 */
export async function renderShots(shots: Shot[], w: number, h: number, onShot: (s: Shot, blob: Blob) => void, cancelled = () => false) {
  const st = useStore.getState()
  const hadXray = st.xray
  const sel = st.selection
  if (hadXray || sel) {
    st.set({ xray: false, selection: null })
    await nextFrame()
    await nextFrame()
  }
  const { gl, scene } = threeRef
  if (!gl || !scene || !gl.domElement.isConnected) throw new Error('Open the 3D view first')
  const plan = useStore.getState().plan
  const H = plan.settings.wallHeight
  const ceilings: THREE.Object3D[] = []
  scene.traverse((o) => o.name === 'ceiling' && !o.visible && (ceilings.push(o), (o.visible = true)))
  const doors: [THREE.Object3D, number][] = []
  scene.traverse((o) => o.name === 'door-leaf' && (doors.push([o, o.rotation.y]), (o.rotation.y = 0)))
  const night = st.lighting === 'night'
  const lights = new THREE.Group()
  for (const r of plan.rooms) {
    const [x, y] = labelPoint(r.polygon)
    const l = new THREE.PointLight(night ? '#ffd6a0' : '#fff4e6', night ? 4 : 1.2, 0, 1.6)
    l.position.set(x, H - 0.25, y)
    lights.add(l)
  }
  scene.add(lights)
  const oldEnv = scene.environmentIntensity
  const oldExposure = gl.toneMappingExposure
  scene.environmentIntensity = night ? 0.12 : 0.25
  gl.toneMappingExposure = night ? 0.9 : 0.72
  const oldSize = gl.getSize(new THREE.Vector2())
  const oldRatio = gl.getPixelRatio()
  const cam = new THREE.PerspectiveCamera(70, w / h, 0.05, 1000)
  try {
    gl.setPixelRatio(1)
    gl.setSize(w, h, false)
    for (const s of shots) {
      if (cancelled()) break
      cam.fov = s.fov * (w < h ? 1.15 : 1)
      cam.aspect = w / h
      cam.position.set(s.pos[0], s.pos[2], s.pos[1])
      cam.lookAt(s.target[0], s.target[2], s.target[1])
      cam.updateProjectionMatrix()
      gl.render(scene, cam)
      const blob = await new Promise<Blob>((res, rej) => gl.domElement.toBlob((b) => (b ? res(b) : rej(new Error('Render failed'))), 'image/jpeg', 0.92))
      onShot(s, blob)
      await nextFrame()
      gl.setSize(w, h, false)
    }
  } finally {
    scene.remove(lights)
    lights.children.forEach((l) => (l as THREE.PointLight).dispose())
    scene.environmentIntensity = oldEnv
    gl.toneMappingExposure = oldExposure
    ceilings.forEach((o) => (o.visible = false))
    doors.forEach(([o, y]) => (o.rotation.y = y))
    gl.setPixelRatio(oldRatio)
    gl.setSize(oldSize.x, oldSize.y, false)
    if (hadXray) useStore.getState().set({ xray: true })
    if (sel && !useStore.getState().selection) useStore.getState().set({ selection: sel })
  }
}
