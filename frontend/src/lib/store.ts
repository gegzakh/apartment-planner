import { create } from 'zustand'
import type { EntityKind, LayerKey, Plan, Selection, Tool, ViewMode } from './types'

export const emptyPlan = (): Plan => ({
  version: 1,
  name: 'My apartment',
  settings: { wallHeight: 2.7, defaultWallColor: '#f4f1ea', defaultFloor: 'oak' },
  walls: [],
  openings: [],
  rooms: [],
  furniture: [],
  electrical: [],
  plumbing: [],
  runs: [],
  overlays: [],
  viewpoints: [],
})

export const ALL_LAYERS: { key: LayerKey; label: string; group: string }[] = [
  { key: 'walls', label: 'Walls', group: 'Plan' },
  { key: 'openings', label: 'Doors & windows', group: 'Plan' },
  { key: 'rooms', label: 'Floors / rooms', group: 'Plan' },
  { key: 'furniture', label: 'Furniture', group: 'Plan' },
  { key: 'labels', label: 'Room names & areas', group: 'Plan' },
  { key: 'dimensions', label: 'Dimensions', group: 'Plan' },
  { key: 'electrical', label: 'Electrical points', group: 'Electrical' },
  { key: 'wiring', label: 'Wiring', group: 'Electrical' },
  { key: 'plumbing', label: 'Plumbing points', group: 'Water' },
  { key: 'pipes', label: 'Pipes', group: 'Water' },
  { key: 'overlays', label: 'Uploaded drawings', group: 'View' },
  { key: 'grid', label: 'Grid', group: 'View' },
  { key: 'viewpoints', label: '360° viewpoints', group: 'View' },
  { key: 'ceiling', label: 'Ceiling (3D)', group: 'View' },
]

type Layers = Record<LayerKey, boolean>

const defaultLayers: Layers = {
  walls: true, openings: true, rooms: true, furniture: true, electrical: true, wiring: true,
  plumbing: true, pipes: true, dimensions: true, labels: true, overlays: false, grid: true,
  ceiling: false, viewpoints: true,
}

export const LAYER_PRESETS: Record<string, Partial<Layers>> = {
  'Interior': { furniture: true, electrical: false, wiring: false, plumbing: false, pipes: false, overlays: false },
  'Electrical': { furniture: false, electrical: true, wiring: true, plumbing: false, pipes: false },
  'Water': { furniture: false, electrical: false, wiring: false, plumbing: true, pipes: true },
  'Everything': { furniture: true, electrical: true, wiring: true, plumbing: true, pipes: true },
  'Shell only': { furniture: false, electrical: false, wiring: false, plumbing: false, pipes: false, labels: false },
}

export interface Version {
  id: string
  name: string
  createdAt: number
  plan: Plan
}

interface State {
  projectId: string
  plan: Plan
  past: Plan[]
  future: Plan[]
  versions: Version[]
  selection: Selection | null
  tool: Tool
  toolArg: string
  layers: Layers
  viewMode: ViewMode
  mode3d: 'orbit' | 'walk' | 'pano'
  lighting: 'day' | 'evening' | 'night'
  xray: boolean
  activeViewpoint: string | null
  compareWith: string | null
  snapStep: number
  dirty: boolean
  toast: string | null
  setPlan: (p: Plan, record?: boolean) => void
  update: (fn: (draft: Plan) => void, opts?: { coalesce?: string }) => void
  undo: () => void
  redo: () => void
  select: (s: Selection | null) => void
  setTool: (t: Tool, arg?: string) => void
  toggleLayer: (k: LayerKey) => void
  setLayers: (l: Partial<Layers>) => void
  set: (p: Partial<State>) => void
  deleteSelection: () => void
  duplicateSelection: () => void
  notify: (msg: string) => void
}

const clone = <T,>(v: T): T => structuredClone(v)
let lastCoalesce = ''
let lastCoalesceAt = 0

export const COLLECTION: Record<EntityKind, keyof Plan> = {
  wall: 'walls', opening: 'openings', room: 'rooms', furniture: 'furniture', electrical: 'electrical',
  plumbing: 'plumbing', run: 'runs', viewpoint: 'viewpoints', overlay: 'overlays',
}

export const useStore = create<State>((set, get) => ({
  projectId: 'default',
  plan: emptyPlan(),
  past: [],
  future: [],
  versions: [],
  selection: null,
  tool: 'select',
  toolArg: '',
  layers: defaultLayers,
  viewMode: '2d',
  mode3d: 'orbit',
  lighting: 'day',
  xray: false,
  activeViewpoint: null,
  compareWith: null,
  snapStep: 0.05,
  dirty: false,
  toast: null,
  setPlan: (p, record = true) =>
    set((s) => ({ plan: p, past: record ? [...s.past, s.plan].slice(-100) : s.past, future: record ? [] : s.future, dirty: true })),
  update: (fn, opts) => {
    const s = get()
    const draft = clone(s.plan)
    fn(draft)
    const now = Date.now()
    const coalesce = !!opts?.coalesce && opts.coalesce === lastCoalesce && now - lastCoalesceAt < 1500
    lastCoalesce = opts?.coalesce ?? ''
    lastCoalesceAt = now
    set({ plan: draft, past: coalesce ? s.past : [...s.past, s.plan].slice(-100), future: [], dirty: true })
  },
  undo: () => {
    const s = get()
    if (!s.past.length) return
    lastCoalesce = ''
    set({ plan: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.plan, ...s.future], dirty: true })
  },
  redo: () => {
    const s = get()
    if (!s.future.length) return
    lastCoalesce = ''
    set({ plan: s.future[0], future: s.future.slice(1), past: [...s.past, s.plan], dirty: true })
  },
  select: (selection) => set({ selection }),
  setTool: (tool, toolArg = '') => set({ tool, toolArg }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setLayers: (l) => set((s) => ({ layers: { ...s.layers, ...l } })),
  set: (p) => set(p),
  deleteSelection: () => {
    const sel = get().selection
    if (!sel) return
    get().update((d) => {
      const key = COLLECTION[sel.kind]
      ;(d[key] as { id: string }[]) = (d[key] as { id: string }[]).filter((e) => e.id !== sel.id)
      if (sel.kind === 'wall') d.openings = d.openings.filter((o) => o.wallId !== sel.id)
    })
    set({ selection: null })
  },
  duplicateSelection: () => {
    const sel = get().selection
    if (!sel || sel.kind === 'wall' || sel.kind === 'opening' || sel.kind === 'overlay') return
    const id = `${sel.kind.slice(0, 2)}_${Math.random().toString(36).slice(2, 10)}`
    get().update((d) => {
      const arr = d[COLLECTION[sel.kind]] as unknown as Record<string, unknown>[]
      const src = arr.find((e) => e.id === sel.id)
      if (!src) return
      const c = clone(src)
      c.id = id
      if (typeof c.x === 'number') {
        c.x = (c.x as number) + 0.3
        c.y = (c.y as number) + 0.3
      }
      if (Array.isArray(c.polygon)) c.polygon = (c.polygon as number[][]).map(([x, y]) => [x + 0.3, y + 0.3])
      if (Array.isArray(c.points)) c.points = (c.points as number[][]).map(([x, y]) => [x + 0.3, y + 0.3])
      arr.push(c)
    })
    set({ selection: { kind: sel.kind, id } })
  },
  notify: (msg) => {
    set({ toast: msg })
    setTimeout(() => get().toast === msg && set({ toast: null }), 3500)
  },
}))

export function findEntity(plan: Plan, sel: Selection | null) {
  if (!sel) return null
  return ((plan[COLLECTION[sel.kind]] as { id: string }[]) || []).find((e) => e.id === sel.id) ?? null
}
