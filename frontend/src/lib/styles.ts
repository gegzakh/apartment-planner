import { pointInPolygon } from './geometry'
import type { MaterialSpec, Plan, Room } from './types'

export interface RoomStyle {
  key: string
  label: string
  desc: string
  floor: MaterialSpec
  wall: MaterialSpec
  ceiling: string
  soft: MaterialSpec
  wood: MaterialSpec
  cabinet: MaterialSpec
  accent: MaterialSpec
  wet: MaterialSpec
}

export const ROOM_STYLES: RoomStyle[] = [
  { key: 'modern', label: 'Modern', desc: 'Warm greys, oak floor, matte black details',
    floor: { finish: 'oak' }, wall: { finish: 'paint_matte', color: '#e6e3dd' }, ceiling: '#ffffff',
    soft: { finish: 'fabric', color: '#8d9399' }, wood: { finish: 'oak' }, cabinet: { finish: 'lacquer_matte', color: '#d8d3ca' }, accent: { finish: 'black_metal' }, wet: { finish: 'tile_60', color: '#cfccc6' } },
  { key: 'scandinavian', label: 'Scandinavian', desc: 'White walls, light ash, soft textiles',
    floor: { finish: 'ash_light' }, wall: { finish: 'paint_matte', color: '#f6f4ef' }, ceiling: '#ffffff',
    soft: { finish: 'boucle', color: '#ece6da' }, wood: { finish: 'ash_light' }, cabinet: { finish: 'lacquer_matte', color: '#f4f2ed' }, accent: { finish: 'ash_light' }, wet: { finish: 'hex_tile', color: '#f2f1ee' } },
  { key: 'loft', label: 'Loft / Industrial', desc: 'Brick, concrete, leather and steel',
    floor: { finish: 'concrete' }, wall: { finish: 'brick' }, ceiling: '#5b5d60',
    soft: { finish: 'leather', color: '#7a4a2e' }, wood: { finish: 'walnut' }, cabinet: { finish: 'black_metal' }, accent: { finish: 'black_metal' }, wet: { finish: 'microcement' } },
  { key: 'classic', label: 'Classic', desc: 'Herringbone parquet, damask, walnut and brass',
    floor: { finish: 'herringbone' }, wall: { finish: 'wallpaper_damask', color: '#d9ccb2' }, ceiling: '#f7f3ea',
    soft: { finish: 'velvet', color: '#5a3d4a' }, wood: { finish: 'walnut' }, cabinet: { finish: 'lacquer_matte', color: '#efe8da' }, accent: { finish: 'brass' }, wet: { finish: 'marble' } },
  { key: 'minimalist', label: 'Minimalist', desc: 'Microcement, white lacquer, no clutter',
    floor: { finish: 'microcement', color: '#d6d2cb' }, wall: { finish: 'paint_matte', color: '#fafafa' }, ceiling: '#ffffff',
    soft: { finish: 'fabric', color: '#e3e0da' }, wood: { finish: 'lacquer_matte', color: '#f2f2f0' }, cabinet: { finish: 'lacquer_gloss' }, accent: { finish: 'chrome' }, wet: { finish: 'microcement', color: '#d6d2cb' } },
  { key: 'japandi', label: 'Japandi', desc: 'Natural oak slats, linen, earthy tones',
    floor: { finish: 'oak', color: '#b9926a' }, wall: { finish: 'venetian', color: '#e3dbcf' }, ceiling: '#f4efe6',
    soft: { finish: 'wallpaper_linen', color: '#cdbfa8' }, wood: { finish: 'wood_panel', color: '#a87d52' }, cabinet: { finish: 'wood_panel', color: '#b48a60' }, accent: { finish: 'black_metal' }, wet: { finish: 'terrazzo' } },
  { key: 'midcentury', label: 'Mid-century', desc: 'Walnut, mustard and teal accents',
    floor: { finish: 'walnut' }, wall: { finish: 'paint_matte', color: '#efe6d4' }, ceiling: '#ffffff',
    soft: { finish: 'velvet', color: '#c9963a' }, wood: { finish: 'walnut' }, cabinet: { finish: 'walnut' }, accent: { finish: 'brass' }, wet: { finish: 'subway', color: '#3f6f6a' } },
  { key: 'mediterranean', label: 'Mediterranean', desc: 'Terracotta, plaster, blue tiles',
    floor: { finish: 'tile_60', color: '#c27c55' }, wall: { finish: 'venetian', color: '#f3ede2' }, ceiling: '#fbf8f2',
    soft: { finish: 'fabric', color: '#e9e2d2' }, wood: { finish: 'oak', color: '#9d7650' }, cabinet: { finish: 'lacquer_matte', color: '#3c6e9e' }, accent: { finish: 'black_metal' }, wet: { finish: 'subway', color: '#3c6e9e' } },
  { key: 'artdeco', label: 'Art Deco', desc: 'Marble, emerald velvet, brass',
    floor: { finish: 'marble' }, wall: { finish: 'wallpaper_stripes', color: '#203a35' }, ceiling: '#f2ece0',
    soft: { finish: 'velvet', color: '#1f5a4a' }, wood: { finish: 'walnut' }, cabinet: { finish: 'lacquer_gloss', color: '#1d1d1f' }, accent: { finish: 'brass' }, wet: { finish: 'marble' } },
]
export const STYLE_BY_KEY: Record<string, RoomStyle> = Object.fromEntries(ROOM_STYLES.map((s) => [s.key, s]))

const SOFT = new Set(['sofa', 'sofa_corner', 'armchair', 'bed', 'bed_single', 'rug', 'office_chair', 'chair'])
const WOOD = new Set(['coffee_table', 'tv_stand', 'bookshelf', 'table', 'table_round', 'nightstand', 'dresser', 'desk'])
const CABINET = new Set(['wardrobe', 'kitchen_base', 'kitchen_wall', 'kitchen_sink', 'island', 'cabinet'])
const WET = /bath|toilet|wc|shower|сануз|ванн/i

/** Applies a style to a room: its surfaces and the furniture standing inside it. Mutates the plan draft. */
export function applyStyle(plan: Plan, room: Room, key: string) {
  const st = STYLE_BY_KEY[key]
  if (!st) return
  room.style = key
  const wet = WET.test(room.name)
  room.floorMat = { ...(wet ? st.wet : st.floor) }
  room.wallMat = { ...(wet ? st.wet : st.wall) }
  room.ceilingMat = undefined
  room.ceilingColor = st.ceiling
  room.floor = room.floorColor = room.wallColor = undefined
  for (const f of plan.furniture) {
    if (!pointInPolygon([f.x, f.y], room.polygon)) continue
    f.color = undefined
    if (SOFT.has(f.type)) { f.mat = { ...st.soft }; f.mat2 = { ...st.wood } }
    else if (WOOD.has(f.type)) { f.mat = { ...st.wood }; f.mat2 = { ...st.accent } }
    else if (CABINET.has(f.type)) { f.mat = { ...st.cabinet }; f.mat2 = { ...st.accent } }
  }
}
