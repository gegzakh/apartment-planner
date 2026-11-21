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
          <Cyl p={[0, 0.2, 0.06]} rt={w / 2} rb={w / 2.6} h={0.4} c={c} />
          <B p={[0, 0.55, -d / 2 + 0.1]} s={[w, 0.4, 0.18]} c={c} r={0.2} />
        </group>
      )
    case 'basin':
      return (
        <group>
          <B p={[0, 0.65, 0]} s={[w, 0.4, d]} c="#e8e2d6" />
          <B p={[0, 0.87, 0]} s={[w, 0.04, d]} c="#ffffff" r={0.15} />
          <Cyl p={[0, 1.0, -d / 2 + 0.06]} rt={0.015} rb={0.015} h={0.2} c="#c0c0c0" />
        </group>
      )
    case 'bathtub':
      return (
        <group>
          <B p={[0, 0.27, 0]} s={[w, 0.54, d]} c={c} r={0.15} />
          <B p={[0, 0.5, 0]} s={[w - 0.12, 0.1, d - 0.12]} c="#cfe5f2" r={0.05} />
        </group>
      )
    case 'shower':
      return (
        <group>
          <B p={[0, 0.03, 0]} s={[w, 0.06, d]} c="#f7f7f7" />
          <mesh position={[0, 1.05, d / 2 - 0.01]}>
            <boxGeometry args={[w, 2.0, 0.01]} />
            <meshPhysicalMaterial color="#cfe8f3" transparent opacity={0.3} roughness={0.05} />
          </mesh>
          <Cyl p={[0, 2.0, -d / 2 + 0.15]} rt={0.1} rb={0.1} h={0.02} c="#c0c0c0" />
        </group>
      )
    case 'kitchen_base':
    case 'kitchen_sink':
    case 'stove':
    case 'dishwasher':
      return (
        <group>
          <B p={[0, (h - 0.04) / 2 + 0.05, 0]} s={[w - 0.004, h - 0.09, d - 0.02]} c={f.type === 'stove' ? '#e8e8e8' : c} />
          <B p={[0, 0.025, 0.02]} s={[w, 0.05, d - 0.05]} c="#333" />
          <B p={[0, h - 0.02, 0]} s={[w, 0.04, d]} c="#d8d3cb" r={0.3} />
          {f.type === 'stove' && <B p={[0, h + 0.001, 0]} s={[w - 0.06, 0.005, d - 0.08]} c="#111" r={0.1} />}
          {f.type === 'kitchen_sink' && <B p={[0, h, 0.02]} s={[w * 0.6, 0.01, d * 0.6]} c="#9aa0a6" m={0.8} r={0.2} />}
        </group>
      )
    case 'kitchen_wall':
      return <B p={[0, 1.45 + h / 2, 0]} s={[w, h, d]} c={c} />
    case 'fridge':
      return <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} r={0.3} m={0.3} />
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
          <Cyl p={[0, 0.17, 0]} rt={w / 3} rb={w / 4} h={0.34} c="#c8b8a6" />
          <mesh position={[0, 0.34 + (h - 0.34) / 2, 0]} castShadow>
            <sphereGeometry args={[w / 1.6, 16, 12]} />
            <meshStandardMaterial color={c} roughness={0.9} />
          </mesh>
        </group>
      )
    case 'washing_machine':
      return (
        <group>
          <B p={[0, h / 2, 0]} s={[w, h, d]} c={c} />
          <mesh position={[0, h * 0.5, d / 2 + 0.005]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[w * 0.3, w * 0.3, 0.02, 32]} />
            <meshStandardMaterial color="#555" metalness={0.5} roughness={0.2} />
          </mesh>
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
