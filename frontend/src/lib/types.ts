/** A surface finish: catalogue finish key, optional tint, optional uploaded texture (data URL) and its repeat size in metres. */
export interface MaterialSpec {
  finish?: string
  color?: string
  texture?: string
  scale?: number
}

export type Vec2 = [number, number]

export interface Wall {
  id: string
  a: Vec2
  b: Vec2
  thickness: number
  height?: number
  color?: string
  /** Overrides the room finish on both faces. */
  mat?: MaterialSpec
}

export type OpeningType = 'door' | 'window' | 'opening'

export interface Opening {
  id: string
  type: OpeningType
  wallId: string
  /** distance from wall start (a) to opening centre, metres */
  offset: number
  width: number
  height: number
  sill: number
  hinge?: 'start' | 'end'
  /** +1 opens to the wall's left-normal side, -1 to the other */
  swing?: 1 | -1
  color?: string
  /** Door leaf / window frame finish. */
  mat?: MaterialSpec
}

export interface Room {
  id: string
  name: string
  polygon: Vec2[]
  floor?: string
  floorColor?: string
  wallColor?: string
  ceilingColor?: string
  style?: string
  floorMat?: MaterialSpec
  wallMat?: MaterialSpec
  ceilingMat?: MaterialSpec
}

export interface Furniture {
  id: string
  type: string
  x: number
  y: number
  rotation: number
  width: number
  depth: number
  height: number
  elevation?: number
  color?: string
  /** Main finish (upholstery / body). */
  mat?: MaterialSpec
  /** Secondary finish (frame, legs, fronts). */
  mat2?: MaterialSpec
  label?: string
  /** SVG path in local metres, centred on the item (from imported drawings) */
  outline?: string
}

export interface Fixture {
  id: string
  type: string
  x: number
  y: number
  rotation: number
  /** mounting height above floor in metres */
  z: number
  circuit?: string
  color?: string
  label?: string
}

export type PipeKind = 'cold' | 'hot' | 'drain' | 'wire' | 'gas'

export interface Run {
  id: string
  kind: PipeKind
  points: Vec2[]
  z: number
  circuit?: string
}

export interface Overlay {
  id: string
  kind: 'general' | 'electrical' | 'plumbing'
  name: string
  url: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
  visible: boolean
}

export interface Viewpoint {
  id: string
  name: string
  x: number
  y: number
  z: number
  yaw: number
}

export interface PlanSettings {
  wallHeight: number
  defaultWallColor: string
  defaultFloor: string
  scale?: number
}

export interface Plan {
  version: 1
  name: string
  settings: PlanSettings
  walls: Wall[]
  openings: Opening[]
  rooms: Room[]
  furniture: Furniture[]
  electrical: Fixture[]
  plumbing: Fixture[]
  runs: Run[]
  overlays: Overlay[]
  viewpoints: Viewpoint[]
}

export type EntityKind = 'wall' | 'opening' | 'room' | 'furniture' | 'electrical' | 'plumbing' | 'run' | 'viewpoint' | 'overlay'

export interface Selection {
  kind: EntityKind
  id: string
}

export type LayerKey =
  | 'walls'
  | 'openings'
  | 'rooms'
  | 'furniture'
  | 'electrical'
  | 'wiring'
  | 'plumbing'
  | 'pipes'
  | 'dimensions'
  | 'labels'
  | 'overlays'
  | 'grid'
  | 'ceiling'
  | 'viewpoints'

export type Tool =
  | 'select'
  | 'pan'
  | 'wall'
  | 'door'
  | 'window'
  | 'opening'
  | 'room'
  | 'furniture'
  | 'electrical'
  | 'plumbing'
  | 'run'
  | 'measure'
  | 'calibrate'
  | 'viewpoint'

export type ViewMode = '2d' | '3d' | 'split'
