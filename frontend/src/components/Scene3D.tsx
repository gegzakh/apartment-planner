import { ContactShadows, OrbitControls, PointerLockControls, Sky } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ELECTRICAL_BY_TYPE, FLOOR_BY_KEY, PLUMBING_BY_TYPE, RUN_STYLE } from '../lib/catalog'
import { add, mul, planBounds, pointInPolygon, panoPoint, wallFrame } from '../lib/geometry'
import { useStore } from '../lib/store'
import { getMaterial } from '../lib/materials'
import { floorTexture } from '../lib/textures'
import { threeRef } from '../lib/three-ref'
import type { EntityKind, Fixture, Opening, Plan, Room, Run, Wall } from '../lib/types'
import Furniture3D from './Furniture3D'

const SEL = '#2f80ed'

function useSelect() {
  const select = useStore((s) => s.select)
  const mode = useStore((s) => s.mode3d)
  return (kind: EntityKind, id: string) => (e: ThreeEvent<MouseEvent>) => {
    if (mode === 'walk') return
    e.stopPropagation()
    if (e.delta > 4) return
    select({ kind, id })
  }
}

// ---------- walls ----------
function sideColor(plan: Plan, w: Wall, side: 1 | -1) {
  const { u, n, L } = wallFrame(w)
  const mid = add(w.a, mul(u, L / 2))
  const p = add(mid, mul(n, side * (w.thickness / 2 + 0.08)))
  const r = plan.rooms.find((r) => pointInPolygon(p, r.polygon))
  const color = w.color ?? r?.wallColor ?? plan.settings.defaultWallColor
  return { spec: w.mat ?? (w.color ? undefined : r?.wallMat), color }
}

const SEL_MAT = new THREE.MeshStandardMaterial({ color: SEL, roughness: 0.9 })
const TOP_MAT = new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: 1 })

function WallMesh({ w, plan, openings, selected, cut }: { w: Wall; plan: Plan; openings: Opening[]; selected: boolean; cut: number }) {
  const onSel = useSelect()
  const H = Math.min(w.height ?? plan.settings.wallHeight, cut)
  const { L, angle } = wallFrame(w)
  const t = w.thickness
  const sL = sideColor(plan, w, 1)
  const sR = sideColor(plan, w, -1)
  const matsFor = (len: number, hh: number) => {
    if (selected) return SEL_MAT
    const end = getMaterial(sL.spec, sL.color, { faceSize: [t, hh] })
    // box face order: +x, -x, +y, -y, +z, -z
    return [end, end, TOP_MAT, end, getMaterial(sL.spec, sL.color, { faceSize: [len, hh] }), getMaterial(sR.spec, sR.color, { faceSize: [len, hh] })]
  }

  const pieces = useMemo(() => {
    const ops = openings
      .map((o) => ({ o, s: Math.max(0, o.offset - o.width / 2), e: Math.min(L, o.offset + o.width / 2) }))
      .sort((a, b) => a.s - b.s)
    const out: { x0: number; x1: number; y0: number; y1: number }[] = []
    let cur = 0
    for (const { o, s, e } of ops) {
      if (s > cur) out.push({ x0: cur, x1: s, y0: 0, y1: H })
      if (o.sill > 0) out.push({ x0: s, x1: e, y0: 0, y1: Math.min(o.sill, H) })
      const top = o.sill + o.height
      if (top < H) out.push({ x0: s, x1: e, y0: top, y1: H })
      cur = Math.max(cur, e)
    }
    if (cur < L) out.push({ x0: cur, x1: L, y0: 0, y1: H })
    return out.filter((p) => p.x1 - p.x0 > 0.001 && p.y1 - p.y0 > 0.001)
  }, [openings, L, H])

  // extend wall ends by half thickness to close corners
  const ext = t / 2
  return (
    <group position={[w.a[0], 0, w.a[1]]} rotation={[0, -angle, 0]} onClick={onSel('wall', w.id)}>
      {pieces.map((p, i) => {
        const x0 = p.x0 === 0 ? -ext : p.x0
        const x1 = Math.abs(p.x1 - L) < 1e-6 ? L + ext : p.x1
        return (
          <mesh key={i} position={[(x0 + x1) / 2, (p.y0 + p.y1) / 2, 0]} material={matsFor(x1 - x0, p.y1 - p.y0)} castShadow receiveShadow>
            <boxGeometry args={[x1 - x0, p.y1 - p.y0, t]} />
          </mesh>
        )
      })}
      {openings.map((o) => (
        <OpeningMesh key={o.id} o={o} t={t} H={H} />
      ))}
    </group>
  )
}

function OpeningMesh({ o, t, H }: { o: Opening; t: number; H: number }) {
  const onSel = useSelect()
  const selected = useStore((s) => s.selection?.id === o.id)
  const frame = selected ? SEL : o.mat?.color ?? o.color ?? '#f5f5f5'
  const hw = o.width / 2
  if (o.type === 'window') {
    const top = Math.min(o.sill + o.height, H)
    const h = top - o.sill
    if (h <= 0) return null
    return (
      <group position={[o.offset, o.sill + h / 2, 0]} onClick={onSel('opening', o.id)}>
        <mesh>
          <boxGeometry args={[o.width, h, 0.02]} />
          <meshPhysicalMaterial color="#bfe0f5" transparent opacity={0.25} roughness={0.02} metalness={0.1} />
        </mesh>
        {[[-hw + 0.03, 0, 0.06, h], [hw - 0.03, 0, 0.06, h], [0, h / 2 - 0.03, o.width, 0.06], [0, -h / 2 + 0.03, o.width, 0.06], [0, 0, 0.05, h]].map(([x, y, sx, sy], i) => (
          <mesh key={i} position={[x, y, 0]} castShadow>
            <boxGeometry args={[sx, sy, 0.07]} />
            <meshStandardMaterial color={frame} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, -h / 2 - 0.02, t / 2 + 0.06]}>
          <boxGeometry args={[o.width + 0.1, 0.03, 0.14]} />
          <meshStandardMaterial color="#efefef" />
        </mesh>
      </group>
    )
  }
  if (o.type === 'door') {
    const s = o.swing ?? 1
    const hingeX = o.hinge === 'end' ? hw : -hw
    const dir = o.hinge === 'end' ? -1 : 1
    const phi = (o.hinge === 'end' ? s : -s) * (Math.PI / 180) * 75
    const h = Math.min(o.height, H) - 0.01
    return (
      <group position={[o.offset, 0, 0]} onClick={onSel('opening', o.id)}>
        <group position={[hingeX, 0, (s * t) / 2]} rotation={[0, phi, 0]}>
          <mesh position={[(dir * o.width) / 2, h / 2, 0]} castShadow>
            <boxGeometry args={[o.width - 0.02, h, 0.04]} />
            {selected ? <meshStandardMaterial color={SEL} /> : <primitive object={getMaterial(o.mat, o.color ?? '#e9e3d8', { faceSize: [o.width, h], fallbackFinish: 'lacquer_matte' })} attach="material" />}
          </mesh>
          <mesh position={[dir * (o.width - 0.1), 1.0, 0.04]}>
            <boxGeometry args={[0.12, 0.02, 0.02]} />
            <meshStandardMaterial color="#999" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
        {[[-hw, 0.04], [hw, 0.04]].map(([x, sx], i) => (
          <mesh key={i} position={[x, h / 2, 0]}>
            <boxGeometry args={[sx, h, t + 0.02]} />
            <meshStandardMaterial color={frame} />
          </mesh>
        ))}
        <mesh position={[0, h + 0.02, 0]}>
          <boxGeometry args={[o.width + 0.04, 0.04, t + 0.02]} />
          <meshStandardMaterial color={frame} />
        </mesh>
      </group>
    )
  }
  return null
}

// ---------- floors ----------
function shapeOf(poly: [number, number][]) {
  const s = new THREE.Shape()
  poly.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)))
  s.closePath()
  return s
}

function FloorMesh({ r, plan, selected }: { r: Room; plan: Plan; selected: boolean }) {
  const onSel = useSelect()
  const geo = useMemo(() => {
    const g = new THREE.ShapeGeometry(shapeOf(r.polygon))
    g.rotateX(Math.PI / 2)
    return g
  }, [r.polygon])
  const fd = FLOOR_BY_KEY[r.floor ?? plan.settings.defaultFloor] ?? FLOOR_BY_KEY.oak
  const tex = useMemo(() => floorTexture(fd.pattern, r.floorColor ?? fd.color), [fd, r.floorColor])
  return (
    <mesh geometry={geo} position={[0, 0.002, 0]} receiveShadow onClick={onSel('room', r.id)}>
      {r.floorMat ? (
        <primitive object={getMaterial(r.floorMat, '#c49a6c', { side: THREE.DoubleSide })} attach="material" />
      ) : (
        <meshStandardMaterial map={tex} color={selected ? '#bcd6fb' : '#ffffff'} roughness={0.75} side={THREE.DoubleSide} />
      )}
    </mesh>
  )
}

function CeilingMesh({ r, h, visible }: { r: Room; h: number; visible: boolean }) {
  const geo = useMemo(() => {
    const g = new THREE.ShapeGeometry(shapeOf(r.polygon))
    g.rotateX(Math.PI / 2)
    return g
  }, [r.polygon])
  return (
    <mesh geometry={geo} position={[0, h, 0]} name="ceiling" visible={visible}>
      {r.ceilingMat ? (
        <primitive object={getMaterial(r.ceilingMat, r.ceilingColor ?? '#fafafa', { side: THREE.DoubleSide })} attach="material" />
      ) : (
        <meshStandardMaterial color={r.ceilingColor ?? '#fafafa'} side={THREE.DoubleSide} roughness={1} />
      )}
    </mesh>
  )
}

// ---------- fixtures & runs ----------
function FixtureMesh({ f, kind, plan, night }: { f: Fixture; kind: 'electrical' | 'plumbing'; plan: Plan; night: boolean }) {
  const onSel = useSelect()
  const selected = useStore((s) => s.selection?.id === f.id)
  const def = (kind === 'electrical' ? ELECTRICAL_BY_TYPE : PLUMBING_BY_TYPE)[f.type]
  const color = selected ? SEL : f.color ?? def?.color ?? '#888'
  const ceil = plan.settings.wallHeight
  const z = Math.min(f.z, ceil)
  const rot = (-f.rotation * Math.PI) / 180
  const isCeilingLight = f.type === 'ceiling_light' || f.type === 'spot_light'
  if (isCeilingLight || f.type === 'smoke') {
    const r = f.type === 'ceiling_light' ? 0.22 : f.type === 'spot_light' ? 0.05 : 0.06
    return (
      <group position={[f.x, ceil - 0.02, f.y]} onClick={onSel(kind, f.id)}>
        <mesh>
          <cylinderGeometry args={[r, r, 0.04, 24]} />
          <meshStandardMaterial color={f.type === 'smoke' ? '#fff' : '#fffbe6'} emissive={isCeilingLight ? '#ffe7a8' : '#000'} emissiveIntensity={night ? 2 : 0.4} />
        </mesh>
        {selected && (
          <mesh>
            <sphereGeometry args={[r + 0.05, 12, 8]} />
            <meshBasicMaterial color={SEL} wireframe />
          </mesh>
        )}
      </group>
    )
  }
  const size: [number, number, number] =
    f.type === 'radiator' ? [0.08, 0.55, 0.9] : f.type === 'ac' ? [0.22, 0.28, 0.85] : f.type === 'panel' ? [0.1, 0.45, 0.32] :
    f.type === 'boiler' ? [0.45, 0.8, 0.45] : f.type === 'riser' ? [0.11, ceil, 0.11] : f.type === 'led_strip' ? [0.02, 0.02, 1.2] : [0.02, 0.08, 0.08]
  const y = f.type === 'riser' ? ceil / 2 : f.type === 'radiator' ? z + size[1] / 2 : z
  return (
    <group position={[f.x, y, f.y]} rotation={[0, rot, 0]} onClick={onSel(kind, f.id)}>
      <mesh position={[-size[0] / 2 + 0.01, 0, 0]} castShadow>
        {f.type === 'riser' ? <cylinderGeometry args={[0.055, 0.055, ceil, 16]} /> : <boxGeometry args={size} />}
        <meshStandardMaterial
          color={f.type === 'radiator' || f.type === 'ac' || f.type === 'boiler' ? (selected ? SEL : f.color ?? '#f4f4f4') : color}
          emissive={f.type.includes('light') || f.type === 'led_strip' ? '#ffd27a' : '#000'}
          emissiveIntensity={night ? 2 : 0.3}
        />
      </mesh>
      {size[1] <= 0.1 && (
        <mesh position={[0.005, 0, 0]}>
          <sphereGeometry args={[0.05, 12, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} />
        </mesh>
      )}
    </group>
  )
}

function RunMesh({ r }: { r: Run }) {
  const onSel = useSelect()
  const selected = useStore((s) => s.selection?.id === r.id)
  const st = RUN_STYLE[r.kind]
  const geo = useMemo(() => {
    if (r.points.length < 2) return null
    const path = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i]
      path.add(new THREE.LineCurve3(new THREE.Vector3(a[0], r.z, a[1]), new THREE.Vector3(b[0], r.z, b[1])))
    }
    return new THREE.TubeGeometry(path as unknown as THREE.Curve<THREE.Vector3>, Math.max(8, r.points.length * 8), Math.max(st.radius, 0.012), 8, false)
  }, [r.points, r.z, st.radius])
  if (!geo) return null
  return (
    <mesh geometry={geo} onClick={onSel('run', r.id)}>
      <meshStandardMaterial color={selected ? SEL : st.color} emissive={st.color} emissiveIntensity={0.25} />
    </mesh>
  )
}

// ---------- controls / camera ----------
function Bridge() {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    threeRef.gl = gl
    threeRef.scene = scene
    threeRef.camera = camera
  }, [gl, scene, camera])
  return null
}

function WalkControls({ start, eye }: { start: THREE.Vector3; eye: number }) {
  const { camera } = useThree()
  const keys = useRef<Record<string, boolean>>({})
  useEffect(() => {
    camera.position.copy(start)
    camera.position.y = eye
    const d = (e: KeyboardEvent) => (keys.current[e.code] = true)
    const u = (e: KeyboardEvent) => (keys.current[e.code] = false)
    window.addEventListener('keydown', d)
    window.addEventListener('keyup', u)
    return () => {
      window.removeEventListener('keydown', d)
      window.removeEventListener('keyup', u)
    }
  }, [camera, start, eye])
  useFrame((_, dt) => {
    const k = keys.current
    const speed = (k.ShiftLeft ? 3 : 1.5) * dt
    const fwd = new THREE.Vector3()
    camera.getWorldDirection(fwd)
    fwd.y = 0
    fwd.normalize()
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0))
    if (k.KeyW || k.ArrowUp) camera.position.addScaledVector(fwd, speed)
    if (k.KeyS || k.ArrowDown) camera.position.addScaledVector(fwd, -speed)
    if (k.KeyD || k.ArrowRight) camera.position.addScaledVector(right, speed)
    if (k.KeyA || k.ArrowLeft) camera.position.addScaledVector(right, -speed)
  })
  return <PointerLockControls selector="#walk-start" />
}

function PanoControls({ pos }: { pos: THREE.Vector3 }) {
  const { camera } = useThree()
  const ref = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  useEffect(() => {
    camera.position.set(pos.x - 0.01, pos.y, pos.z)
    ;(camera as THREE.PerspectiveCamera).fov = 75
    ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
    ref.current?.target.copy(pos)
    ref.current?.update()
  }, [camera, pos])
  return <OrbitControls ref={ref} enableZoom={false} enablePan={false} rotateSpeed={-0.35} target={pos} />
}

function OrbitRig({ center, radius }: { center: THREE.Vector3; radius: number }) {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(center.x + radius * 0.6, radius * 1.1, center.z + radius * 1.0)
    ;(camera as THREE.PerspectiveCamera).fov = 45
    ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
    camera.lookAt(center)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <OrbitControls makeDefault target={center} maxPolarAngle={Math.PI / 2 - 0.02} enableDamping />
}

function Lights({ lighting, plan, center, radius }: { lighting: string; plan: Plan; center: THREE.Vector3; radius: number }) {
  const night = lighting === 'night'
  const evening = lighting === 'evening'
  const lights = useMemo(
    () => (night || evening ? plan.electrical.filter((f) => f.type === 'ceiling_light' || f.type === 'wall_light').slice(0, 16) : []),
    [plan.electrical, night, evening],
  )
  return (
    <>
      <hemisphereLight args={[night ? '#20263a' : '#ffffff', night ? '#0b0b10' : '#b9b2a4', night ? 0.25 : evening ? 0.6 : 1.1]} />
      <directionalLight
        position={[center.x + radius * (evening ? 1.4 : 0.6), radius * (evening ? 0.5 : 1.6), center.z + radius * 0.8]}
        intensity={night ? 0.05 : evening ? 1.4 : 2.2}
        color={evening ? '#ffb27a' : '#fff6e8'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-radius * 1.5}
        shadow-camera-right={radius * 1.5}
        shadow-camera-top={radius * 1.5}
        shadow-camera-bottom={-radius * 1.5}
        shadow-bias={-0.0005}
        target-position={[center.x, 0, center.z]}
      />
      {lights.map((f) => (
        <pointLight key={f.id} position={[f.x, f.type === 'wall_light' ? f.z : plan.settings.wallHeight - 0.15, f.y]} intensity={night ? 3.5 : 1.8} distance={6} decay={1.6} color="#ffd9a0" />
      ))}
    </>
  )
}

// ---------- main ----------
export function SceneContent() {
  const plan = useStore((s) => s.plan)
  const layers = useStore((s) => s.layers)
  const selection = useStore((s) => s.selection)
  const mode = useStore((s) => s.mode3d)
  const lighting = useStore((s) => s.lighting)
  const xray = useStore((s) => s.xray)
  const activeVp = useStore((s) => s.activeViewpoint)
  const select = useStore((s) => s.select)

  const b = planBounds(plan)
  const center = useMemo(() => new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minY + b.maxY) / 2), [b.minX, b.maxX, b.minY, b.maxY])
  const radius = Math.max(b.maxX - b.minX, b.maxY - b.minY)
  const byWall = useMemo(() => {
    const m: Record<string, Opening[]> = {}
    if (layers.openings) for (const o of plan.openings) (m[o.wallId] ??= []).push(o)
    return m
  }, [plan.openings, layers.openings])

  const vpPos = useMemo(() => {
    const p = panoPoint(plan, activeVp)
    return new THREE.Vector3(p.x, p.z, p.y)
  }, [plan, activeVp])

  const cut = mode === 'orbit' && xray ? 1.1 : Infinity
  const night = lighting === 'night'
  const showCeiling = layers.ceiling || mode !== 'orbit'

  return (
    <>
      <Bridge />
      <color attach="background" args={[night ? '#0d1020' : lighting === 'evening' ? '#f0c9a8' : '#dfe8f0']} />
      {!night && mode === 'orbit' && <Sky distance={450000} sunPosition={lighting === 'evening' ? [100, 8, 60] : [60, 80, 40]} />}
      <Lights lighting={lighting} plan={plan} center={center} radius={radius} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, -0.01, center.z]} receiveShadow onClick={() => mode === 'orbit' && select(null)}>
        <planeGeometry args={[radius * 6, radius * 6]} />
        <meshStandardMaterial color={night ? '#1a1d25' : '#cfd6cf'} roughness={1} />
      </mesh>
      {layers.rooms && plan.rooms.map((r) => <FloorMesh key={r.id} r={r} plan={plan} selected={selection?.id === r.id} />)}
      {plan.rooms.map((r) => <CeilingMesh key={r.id} r={r} h={plan.settings.wallHeight} visible={showCeiling} />)}
      {layers.walls && plan.walls.map((w) => (
        <WallMesh key={w.id} w={w} plan={plan} openings={byWall[w.id] ?? []} selected={selection?.id === w.id} cut={cut} />
      ))}
      {layers.furniture && plan.furniture.map((f) => (
        <Furniture3D key={f.id} f={f} selected={selection?.id === f.id} onSelect={(e) => {
          if (mode === 'walk' || e.delta > 4) return
          e.stopPropagation()
          select({ kind: 'furniture', id: f.id })
        }} />
      ))}
      {layers.electrical && plan.electrical.map((f) => <FixtureMesh key={f.id} f={f} kind="electrical" plan={plan} night={night || lighting === 'evening'} />)}
      {layers.plumbing && plan.plumbing.map((f) => <FixtureMesh key={f.id} f={f} kind="plumbing" plan={plan} night={false} />)}
      {plan.runs.filter((r) => (r.kind === 'wire' ? layers.wiring : layers.pipes)).map((r) => <RunMesh key={r.id} r={r} />)}
      {mode === 'orbit' && <ContactShadows position={[center.x, 0.003, center.z]} scale={radius * 2} opacity={0.25} blur={2} far={3} />}
      {mode === 'orbit' && <OrbitRig key="orbit" center={center} radius={radius} />}
      {mode === 'walk' && <WalkControls start={vpPos} eye={1.6} />}
      {mode === 'pano' && <PanoControls pos={vpPos} />}
    </>
  )
}

export default function Scene3D() {
  const mode = useStore((s) => s.mode3d)
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: 45, near: 0.05, far: 2000, position: [10, 10, 10] }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.0
          gl.shadowMap.type = THREE.PCFSoftShadowMap
          const pmrem = new THREE.PMREMGenerator(gl)
          scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
          scene.environmentIntensity = 0.35
          pmrem.dispose()
        }}
      >
        <SceneContent key={mode} />
      </Canvas>
      {mode === 'walk' && (
        <button id="walk-start" className="overlay-btn">
          Click here to walk · WASD / arrows to move · mouse to look · Esc to exit
        </button>
      )}
      {mode === 'pano' && <div className="overlay-hint">Drag to look around 360° · pick a viewpoint in the toolbar</div>}
    </div>
  )
}
