import type { ThreeEvent } from '@react-three/fiber'
import { FURNITURE_BY_TYPE } from '../lib/catalog'
import { createContext, useContext } from 'react'
import * as THREE from 'three'
import { getMaterial } from '../lib/materials'
import type { Furniture, MaterialSpec } from '../lib/types'

/** Finishes of the piece being drawn: parts drawn in `mainColor` get `main`, other non-neutral parts get `accent`. */
const Finish = createContext<{ mainColor: string; main?: MaterialSpec; accent?: MaterialSpec }>({ mainColor: '' })

function isNeutral(c: string) {
  const l = new THREE.Color(c).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l
  return l > 0.88 || l < 0.1
}

function useFinish(c: string, face: [number, number], r?: number, m?: number) {
  const f = useContext(Finish)
  if (c === f.mainColor && f.main) return getMaterial(f.main, c, { faceSize: face })
  if (c !== f.mainColor && f.accent && !isNeutral(c)) return getMaterial(f.accent, c, { faceSize: face })
  void r
  void m
  return null
}

interface BoxProps { p: [number, number, number]; s: [number, number, number]; c: string; r?: number; m?: number }
function B({ p, s, c, r, m = 0 }: BoxProps) {
  const mat = useFinish(c, [Math.max(s[0], s[2]), s[1]], r, m)
  return (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      {mat ? <primitive object={mat} attach="material" /> : <meshStandardMaterial color={c} roughness={r ?? 0.7} metalness={m} />}
    </mesh>
  )
}
function Cyl({ p, rt, rb, h, c, seg = 24 }: { p: [number, number, number]; rt: number; rb: number; h: number; c: string; seg?: number }) {
  const mat = useFinish(c, [Math.PI * rb, h], 0.6)
  return (
    <mesh position={p} castShadow receiveShadow>
      <cylinderGeometry args={[rt, rb, h, seg]} />
      {mat ? <primitive object={mat} attach="material" /> : <meshStandardMaterial color={c} roughness={0.6} />}
    </mesh>
  )
}

const CHROME = '#c9cdd1'
function Glass({ p, s }: { p: [number, number, number]; s: [number, number, number] }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshPhysicalMaterial color="#e3f1f5" transparent opacity={0.22} roughness={0.03} metalness={0.1} />
    </mesh>
  )
}
function Mirror({ p, s }: { p: [number, number, number]; s: [number, number, number] }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color="#dfe6ea" metalness={1} roughness={0.04} />
    </mesh>
  )
}
function Disc({ p, r, h, c, rx = 0, m = 0, ro = 0.5 }: { p: [number, number, number]; r: number; h: number; c: string; rx?: number; m?: number; ro?: number }) {
  return (
    <mesh position={p} rotation={[rx, 0, 0]}>
      <cylinderGeometry args={[r, r, h, 32]} />
      <meshStandardMaterial color={c} metalness={m} roughness={ro} />
    </mesh>
  )
}
/** Cabinet front split into doors or drawers with bar handles. */
function Fronts({ w, h, y, z, n, c, drawers = false }: { w: number; h: number; y: number; z: number; n: number; c: string; drawers?: boolean }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const fw = drawers ? w - 0.006 : w / n - 0.006
        const fh = drawers ? h / n - 0.006 : h - 0.006
        const x = drawers ? 0 : -w / 2 + (w / n) * (i + 0.5)
        const yy = drawers ? y - h / 2 + (h / n) * (i + 0.5) : y
        return (
          <group key={i}>
            <B p={[x, yy, z]} s={[fw, fh, 0.018]} c={c} />
            <B p={drawers ? [x, yy + fh / 2 - 0.05, z + 0.016] : [x + (i % 2 ? -1 : 1) * (fw / 2 - 0.04), yy, z + 0.016]} s={drawers ? [Math.min(0.3, fw * 0.5), 0.012, 0.014] : [0.012, Math.min(0.3, fh * 0.4), 0.014]} c={CHROME} m={0.8} r={0.3} />
          </group>
        )
      })}
    </>
  )
}

function legs(w: number, d: number, h: number, c: string, inset = 0.05, t = 0.04) {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], i) => (
    <B key={i} p={[a * (w / 2 - inset), h / 2, b * (d / 2 - inset)]} s={[t, h, t]} c={c} />
  ))
}

function Body({ f }: { f: Furniture }) {
  const w = f.width, d = f.depth, h = f.height
  const c = f.mat?.color ?? f.color ?? FURNITURE_BY_TYPE[f.type]?.color ?? '#bbb'
  switch (f.type) {
    case 'bed':
    case 'bed_single':
      return (
        <group>
          <B p={[0, 0.15, 0]} s={[w, 0.3, d]} c="#6b5444" />
          <B p={[0, 0.38, 0.03]} s={[w - 0.04, 0.18, d - 0.08]} c="#f3f1ec" />
          <B p={[0, 0.48, 0.25]} s={[w - 0.02, 0.04, d * 0.65]} c={c} />
          <B p={[0, 0.6, -d / 2 + 0.03]} s={[w + 0.04, 0.9, 0.06]} c="#6b5444" />
          {(w > 1.2 ? [-w / 4, w / 4] : [0]).map((x, i) => (
            <B key={i} p={[x, 0.53, -d / 2 + 0.28]} s={[Math.min(0.62, w / 2 - 0.1), 0.12, 0.36]} c="#ffffff" />
          ))}
        </group>
      )
    case 'sofa':
    case 'sofa_corner':
      return (
        <group>
          <B p={[0, 0.22, 0.05]} s={[w - 0.2, 0.24, d - 0.25]} c={c} />
          <B p={[0, 0.06, 0]} s={[w, 0.12, d]} c="#3b3b3b" />
          <B p={[0, 0.5, -d / 2 + 0.11]} s={[w, 0.7, 0.22]} c={c} />
          <B p={[-w / 2 + 0.1, 0.33, 0]} s={[0.2, 0.42, d]} c={c} />
          <B p={[w / 2 - 0.1, 0.33, 0]} s={[0.2, 0.42, d]} c={c} />
          <B p={[0, 0.37, 0.05]} s={[w - 0.24, 0.1, d - 0.3]} c={c} r={0.9} />
        </group>
      )
    case 'armchair':
    case 'office_chair':
      return (
        <group>
          <B p={[0, 0.3, 0.04]} s={[w * 0.8, 0.15, d * 0.8]} c={c} />
          <B p={[0, 0.55, -d / 2 + 0.08]} s={[w * 0.8, h * 0.65, 0.12]} c={c} />
          {f.type === 'armchair' ? (
            <>
              <B p={[-w / 2 + 0.07, 0.35, 0]} s={[0.14, 0.4, d]} c={c} />
              <B p={[w / 2 - 0.07, 0.35, 0]} s={[0.14, 0.4, d]} c={c} />
              {legs(w, d, 0.15, '#3b2e24', 0.08)}
            </>
          ) : (
            <Cyl p={[0, 0.12, 0]} rt={0.03} rb={0.25} h={0.24} c="#222" />
          )}
        </group>
      )
    case 'table':
    case 'desk':
    case 'coffee_table':
    case 'nightstand':
    case 'island':
      if (f.type === 'island' || f.type === 'nightstand') return <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} />
      return (
        <group>
          <B p={[0, h - 0.02, 0]} s={[w, 0.04, d]} c={c} />
          {legs(w, d, h - 0.04, '#3b2e24')}
        </group>
      )
    case 'table_round':
      return (
        <group>
          <Cyl p={[0, h - 0.02, 0]} rt={w / 2} rb={w / 2} h={0.04} c={c} seg={40} />
          <Cyl p={[0, (h - 0.04) / 2, 0]} rt={0.05} rb={0.05} h={h - 0.04} c="#3b2e24" />
          <Cyl p={[0, 0.02, 0]} rt={0.25} rb={0.25} h={0.04} c="#3b2e24" />
        </group>
      )
    case 'chair':
      return (
        <group>
          <B p={[0, 0.45, 0]} s={[w, 0.05, d]} c={c} />
          <B p={[0, 0.7, -d / 2 + 0.02]} s={[w, 0.45, 0.04]} c={c} />
          {legs(w, d, 0.43, c, 0.03, 0.03)}
        </group>
      )
    case 'toilet':
      return (
        <group>
          <Cyl p={[0, 0.12, 0.04]} rt={w * 0.3} rb={w * 0.34} h={0.24} c={c} />
          <mesh position={[0, 0.3, 0.06]} scale={[1, 1, (d * 0.62) / w]} castShadow>
            <cylinderGeometry args={[w / 2, w * 0.36, 0.14, 32]} />
            <meshStandardMaterial color={c} roughness={0.12} />
          </mesh>
          <mesh position={[0, 0.385, 0.06]} scale={[1, 1, (d * 0.62) / w]} castShadow>
            <cylinderGeometry args={[w / 2 + 0.005, w / 2 + 0.005, 0.03, 32]} />
            <meshStandardMaterial color={c} roughness={0.2} />
          </mesh>
          <B p={[0, 0.6, -d / 2 + 0.1]} s={[w, 0.4, 0.18]} c={c} r={0.12} />
          <B p={[0, 0.81, -d / 2 + 0.1]} s={[w + 0.01, 0.025, 0.19]} c={c} r={0.12} />
          <Disc p={[0, 0.83, -d / 2 + 0.1]} r={0.03} h={0.01} c={CHROME} m={0.9} ro={0.2} />
        </group>
      )
    case 'basin':
      return (
        <group>
          <B p={[0, 0.62, 0]} s={[w, 0.4, d - 0.02]} c="#b98a5a" />
          <Fronts w={w} h={0.4} y={0.62} z={(d - 0.02) / 2} n={2} c="#b98a5a" drawers />
          <B p={[0, 0.85, 0]} s={[w + 0.02, 0.06, d]} c="#ffffff" r={0.1} />
          <B p={[0, 0.875, 0.03]} s={[w * 0.6, 0.012, d * 0.55]} c="#e9ecee" r={0.1} />
          <Cyl p={[0, 0.95, -d / 2 + 0.07]} rt={0.016} rb={0.022} h={0.15} c={CHROME} />
          <B p={[0, 1.02, -d / 2 + 0.12]} s={[0.025, 0.02, 0.1]} c={CHROME} m={0.9} r={0.2} />
          <Mirror p={[0, 1.55, -d / 2 + 0.01]} s={[Math.min(w, 0.8), 0.75, 0.02]} />
        </group>
      )
    case 'bathtub':
      return (
        <group>
          <B p={[0, 0.27, 0]} s={[w, 0.54, d]} c={c} r={0.15} />
          <B p={[0, 0.545, 0]} s={[w - 0.14, 0.02, d - 0.14]} c="#dfe9ee" r={0.05} />
          <B p={[0, 0.4, 0]} s={[w - 0.16, 0.02, d - 0.16]} c="#bcd7e4" r={0.05} />
          <Cyl p={[-w / 2 + 0.1, 0.62, 0]} rt={0.018} rb={0.022} h={0.14} c={CHROME} />
        </group>
      )
    case 'shower':
      return (
        <group>
          <B p={[0, 0.03, 0]} s={[w, 0.06, d]} c="#f2f0ec" />
          <B p={[0, 0.061, 0]} s={[0.12, 0.002, 0.12]} c="#8d9196" m={0.8} />
          <Glass p={[0, 1.05, d / 2 - 0.01]} s={[w, 1.95, 0.008]} />
          <Glass p={[w / 2 - 0.01, 1.05, 0]} s={[0.008, 1.95, d]} />
          <B p={[0, 2.03, d / 2 - 0.01]} s={[w, 0.025, 0.025]} c={CHROME} m={0.9} r={0.25} />
          <B p={[w / 2 - 0.01, 2.03, 0]} s={[0.025, 0.025, d]} c={CHROME} m={0.9} r={0.25} />
          <B p={[w / 2 - 0.01, 1.05, d / 2 - 0.01]} s={[0.025, 1.95, 0.025]} c={CHROME} m={0.9} r={0.25} />
          <B p={[w * 0.1, 1.1, d / 2 + 0.01]} s={[0.02, 0.3, 0.02]} c={CHROME} m={0.9} r={0.25} />
          <B p={[0, 2.05, -d / 2 + 0.17]} s={[0.02, 0.02, 0.32]} c={CHROME} m={0.9} r={0.25} />
          <Disc p={[0, 2.03, -d / 2 + 0.3]} r={0.12} h={0.015} c={CHROME} m={0.9} ro={0.25} />
          <B p={[-w / 2 + 0.25, 1.3, -d / 2 + 0.02]} s={[0.02, 0.7, 0.02]} c={CHROME} m={0.9} r={0.25} />
          <B p={[-w / 2 + 0.25, 1.05, -d / 2 + 0.04]} s={[0.08, 0.08, 0.04]} c={CHROME} m={0.9} r={0.25} />
        </group>
      )
    case 'kitchen_base':
    case 'kitchen_sink':
    case 'stove':
    case 'oven':
    case 'dishwasher':
      return (
        <group>
          <B p={[0, (h - 0.04) / 2 + 0.05, 0]} s={[w - 0.004, h - 0.09, d - 0.02]} c={f.type === 'stove' ? '#e8e8e8' : c} />
          <B p={[0, 0.025, 0.02]} s={[w, 0.05, d - 0.05]} c="#333" />
          <B p={[0, h - 0.02, 0]} s={[w, 0.04, d]} c="#d8d3cb" r={0.3} />
          {f.type !== 'stove' && f.type !== 'oven' && f.type !== 'dishwasher' && <Fronts w={w} h={h - 0.1} y={(h - 0.04) / 2 + 0.05} z={d / 2 - 0.005} n={w > 0.7 ? 2 : 1} c={c} />}
          {f.type === 'dishwasher' && <Fronts w={w} h={h - 0.1} y={(h - 0.04) / 2 + 0.05} z={d / 2 - 0.005} n={1} c={c} drawers />}
          {f.type === 'stove' && (
            <>
              <B p={[0, h + 0.001, 0]} s={[w - 0.06, 0.005, d - 0.08]} c="#111" r={0.1} />
              {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], i) => <Disc key={i} p={[a * w * 0.2, h + 0.005, b * d * 0.2]} r={0.08} h={0.002} c="#3a3a3a" ro={0.3} />)}
              <B p={[0, 0.45, d / 2 - 0.005]} s={[w - 0.04, 0.5, 0.02]} c="#1b1b1b" r={0.1} />
              <B p={[0, 0.74, d / 2 + 0.015]} s={[w * 0.7, 0.015, 0.02]} c={CHROME} m={0.8} r={0.3} />
            </>
          )}
          {f.type === 'oven' && (
            <>
              <B p={[0, 0.45, d / 2 - 0.005]} s={[w - 0.04, 0.5, 0.02]} c="#1b1b1b" r={0.1} />
              <B p={[0, 0.74, d / 2 + 0.015]} s={[w * 0.7, 0.015, 0.02]} c={CHROME} m={0.8} r={0.3} />
            </>
          )}
          {f.type === 'kitchen_sink' && <B p={[0, h, 0.02]} s={[w * 0.6, 0.01, d * 0.6]} c="#9aa0a6" m={0.8} r={0.2} />}
        </group>
      )
    case 'kitchen_wall':
      return (
        <group>
          <B p={[0, 1.45 + h / 2, -0.01]} s={[w, h, d - 0.02]} c={c} />
          <Fronts w={w} h={h} y={1.45 + h / 2} z={d / 2 - 0.02} n={w > 0.7 ? 2 : 1} c={c} />
        </group>
      )
    case 'fridge':
      return (
        <group>
          <B p={[0, h / 2, -0.01]} s={[w, h, d - 0.02]} c={c} r={0.3} m={0.3} />
          <B p={[0, h * 0.82, d / 2 - 0.01]} s={[w - 0.006, h * 0.34 - 0.008, 0.02]} c={c} r={0.3} m={0.3} />
          <B p={[0, h * 0.33, d / 2 - 0.01]} s={[w - 0.006, h * 0.64 - 0.008, 0.02]} c={c} r={0.3} m={0.3} />
          <B p={[w / 2 - 0.05, h * 0.75, d / 2 + 0.02]} s={[0.02, 0.3, 0.025]} c={CHROME} m={0.8} r={0.3} />
          <B p={[w / 2 - 0.05, h * 0.55, d / 2 + 0.02]} s={[0.02, 0.3, 0.025]} c={CHROME} m={0.8} r={0.3} />
        </group>
      )
    case 'wardrobe':
    case 'cabinet':
    case 'dresser':
      return (
        <group>
          <B p={[0, (f.elevation ?? 0) + h / 2, -0.01]} s={[w, h, d - 0.02]} c={c} />
          <Fronts w={w} h={h - 0.02} y={(f.elevation ?? 0) + h / 2} z={d / 2 - 0.01} n={f.type === 'dresser' ? 3 : Math.max(1, Math.round(w / 0.5))} c={c} drawers={f.type === 'dresser'} />
        </group>
      )
    case 'bookshelf': {
      const n = Math.max(2, Math.round(h / 0.38))
      return (
        <group>
          <B p={[-w / 2 + 0.01, h / 2, 0]} s={[0.02, h, d]} c={c} />
          <B p={[w / 2 - 0.01, h / 2, 0]} s={[0.02, h, d]} c={c} />
          <B p={[0, h / 2, -d / 2 + 0.005]} s={[w, h, 0.01]} c={c} />
          {Array.from({ length: n + 1 }, (_, i) => <B key={i} p={[0, (h / n) * i + 0.01, 0]} s={[w, 0.02, d]} c={c} />)}
          {Array.from({ length: n }, (_, i) =>
            Array.from({ length: 7 }, (_, j) => {
              const bh = 0.2 + ((i * 7 + j) % 4) * 0.03
              const col = ['#8c3b2f', '#2f4f6f', '#d8c9a8', '#3f5f45', '#6b4e3d', '#c9a45c', '#444'][(i * 3 + j) % 7]
              return j % 5 === 4 ? null : <B key={`${i}-${j}`} p={[-w / 2 + 0.08 + j * ((w - 0.16) / 7), (h / n) * i + 0.02 + bh / 2, 0]} s={[0.035, bh, d * 0.75]} c={col} r={0.8} />
            }))}
        </group>
      )
    }
    case 'tv_stand':
      return (
        <group>
          <B p={[0, 0.25, 0]} s={[w, 0.5, d]} c={c} />
          <B p={[0, 0.5 + 0.38, -d / 2 + 0.08]} s={[Math.min(1.45, w - 0.1), 0.82, 0.04]} c="#111" r={0.2} />
        </group>
      )
    case 'rug':
      return <B p={[0, 0.005, 0]} s={[w, 0.01, d]} c={c} r={1} />
    case 'plant':
      return (
        <group>
          <Cyl p={[0, 0.17, 0]} rt={w / 3} rb={w / 4} h={0.34} c="#e8e1d6" />
          {[[0, 0.55, 0, 0.6], [0.08, 0.75, 0.05, 0.45], [-0.07, 0.8, -0.04, 0.42], [0.02, 0.95, -0.06, 0.35], [-0.04, 0.68, 0.08, 0.4]].map(([x, y, z, k], i) => (
            <mesh key={i} position={[x * w * 2, 0.34 + (h - 0.34) * (y - 0.4) * 1.4, z * w * 2]} castShadow>
              <icosahedronGeometry args={[(w / 2) * k * 1.4, 1]} />
              <meshStandardMaterial color={c} roughness={0.85} flatShading />
            </mesh>
          ))}
        </group>
      )
    case 'washing_machine':
      return (
        <group>
          <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} r={0.3} />
          <B p={[0, h - 0.06, d / 2 + 0.003]} s={[w - 0.04, 0.09, 0.006]} c="#f7f8f9" r={0.3} />
          <B p={[w * 0.12, h - 0.06, d / 2 + 0.008]} s={[0.12, 0.04, 0.004]} c="#1d2226" r={0.2} />
          <Disc p={[w * 0.33, h - 0.06, d / 2 + 0.012]} r={0.028} h={0.02} rx={Math.PI / 2} c="#d5d9dc" m={0.6} ro={0.3} />
          <Disc p={[0, h * 0.45, d / 2 + 0.01]} r={w * 0.34} h={0.03} rx={Math.PI / 2} c={CHROME} m={0.9} ro={0.2} />
          <Disc p={[0, h * 0.45, d / 2 + 0.022]} r={w * 0.27} h={0.012} rx={Math.PI / 2} c="#30363b" m={0.2} ro={0.05} />
        </group>
      )
    default:
      return <B p={[0, (f.elevation ?? 0) + h / 2, 0]} s={[w, h, d]} c={c} />
  }
}

export default function Furniture3D({ f, selected, onSelect }: { f: Furniture; selected: boolean; onSelect: (e: ThreeEvent<MouseEvent>) => void }) {
  return (
    <group position={[f.x, f.elevation && f.type !== 'generic' ? f.elevation : 0, f.y]} rotation={[0, (-f.rotation * Math.PI) / 180, 0]} onClick={onSelect}>
      <Finish.Provider value={{ mainColor: f.mat?.color ?? f.color ?? FURNITURE_BY_TYPE[f.type]?.color ?? '#bbb', main: f.mat, accent: f.mat2 }}>
        <Body f={f} />
      </Finish.Provider>
      {selected && (
        <mesh position={[0, f.height / 2, 0]}>
          <boxGeometry args={[f.width + 0.04, f.height + 0.04, f.depth + 0.04]} />
          <meshBasicMaterial color="#2f80ed" wireframe />
        </mesh>
      )}
    </group>
  )
}
