import * as THREE from 'three'
import { labelPoint, pointInPolygon } from './geometry'
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
  const dx = c[0] - p[0], dy = c[1] - p[1]
  const L = Math.hypot(dx, dy) || 1
  return [p[0] + (dx / L) * d, p[1] + (dy / L) * d]
}

function inFurniture(plan: Plan, p: Vec2, margin: number) {
  return plan.furniture.some((f) => {
    if ((f.elevation ?? 0) > EYE) return false
    const a = (-f.rotation * Math.PI) / 180
    const dx = p[0] - f.x, dy = p[1] - f.y
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a)
    return Math.abs(lx) < f.width / 2 + margin && Math.abs(ly) < f.depth / 2 + margin
  })
}

/** Steps a camera spot towards `toward` until it is out of furniture, so it never starts inside a sofa or cabinet. */
function clearSpot(plan: Plan, poly: Vec2[], p: Vec2, toward: Vec2): Vec2 {
  const dx = toward[0] - p[0], dy = toward[1] - p[1]
  const L = Math.hypot(dx, dy) || 1
  for (let d = 0; d < Math.min(L, 2.5); d += 0.1) {
    const q: Vec2 = [p[0] + (dx / L) * d, p[1] + (dy / L) * d]
    if (pointInPolygon(q, poly) && !inFurniture(plan, q, 0.2)) return q
  }
  return p
}

/** Camera positions that show a room from every corner and from the middle of each long side. */
export function roomShots(plan: Plan, room: Room): Shot[] {
  const c = labelPoint(room.polygon)
  const poly = room.polygon
  const out: Shot[] = []
  const corners = poly
    .map((p, i) => {
      const a = poly[(i + poly.length - 1) % poly.length], b = poly[(i + 1) % poly.length]
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
    const e = clearSpot(plan, poly, inset(p, c, 0.4), c)
    const dir = compass(c[0] - p[0], c[1] - p[1])
    out.push({ id: `${room.id}-c${i}`, roomId: room.id, name: `Corner ${i + 1} → looking ${dir}`, pos: [e[0], e[1], EYE], target: [c[0], c[1], 1.15], fov: 70 })
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
    const e = clearSpot(plan, poly, [m[0] + n[0] * 0.3, m[1] + n[1] * 0.3], [m[0] + n[0] * 5, m[1] + n[1] * 5])
    if (!pointInPolygon(e, poly)) return
    out.push({ id: `${room.id}-s${i}`, roomId: room.id, name: `From ${compass(-n[0], -n[1])} wall → looking ${compass(n[0], n[1])}`, pos: [e[0], e[1], EYE], target: [e[0] + n[0] * 5, e[1] + n[1] * 5, 1.2], fov: 75 })
  })
  out.push({ id: `${room.id}-top`, roomId: room.id, name: 'Overview from above the door', pos: [...inset(convex[0]?.p ?? c, c, 0.3), 2.2] as [number, number, number], target: [c[0], c[1], 0.4], fov: 80 })
  for (const v of plan.viewpoints) {
    if (!pointInPolygon([v.x, v.y], poly)) continue
    const yaw = (v.yaw * Math.PI) / 180
    out.push({ id: `${room.id}-vp-${v.id}`, roomId: room.id, name: `Viewpoint: ${v.name}`, pos: [v.x, v.y, v.z], target: [v.x + Math.cos(yaw) * 5, v.y + Math.sin(yaw) * 5, v.z - 0.3], fov: 70 })
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
  if (hadXray) {
    st.set({ xray: false })
    await nextFrame()
    await nextFrame()
  }
  const { gl, scene } = threeRef
  if (!gl || !scene || !gl.domElement.isConnected) throw new Error('Open the 3D view first')
  const plan = useStore.getState().plan
  const H = plan.settings.wallHeight
  const ceilings: THREE.Object3D[] = []
  scene.traverse((o) => o.name === 'ceiling' && !o.visible && (ceilings.push(o), (o.visible = true)))
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
    gl.setPixelRatio(oldRatio)
    gl.setSize(oldSize.x, oldSize.y, false)
    if (hadXray) useStore.getState().set({ xray: true })
  }
}
