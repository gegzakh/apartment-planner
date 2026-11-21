import * as THREE from 'three'
import { FURNITURE_BY_TYPE } from './catalog'
import { pointInPolygon } from './geometry'
import { FINISH_BY_KEY } from './materials'
import { STYLE_BY_KEY } from './styles'
import type { MaterialSpec, Plan, Room } from './types'

const NAMED: [string, string][] = [
  ['white', '#ffffff'], ['off-white', '#f3efe6'], ['ivory', '#eee6d2'], ['cream', '#e9dcc0'], ['beige', '#d8c6a5'], ['sand', '#c9ae86'],
  ['light grey', '#cfcfcd'], ['warm grey', '#a8a29a'], ['grey', '#8e8e8e'], ['charcoal', '#3d3e40'], ['black', '#141414'],
  ['taupe', '#8b7d6b'], ['light brown', '#b08860'], ['brown', '#7b5236'], ['dark brown', '#4a3020'], ['terracotta', '#c0643f'], ['rust', '#a14b2a'],
  ['red', '#c0282d'], ['burgundy', '#6e1f2c'], ['pink', '#e7a6b5'], ['blush', '#e9c9c0'], ['orange', '#e07b2a'], ['mustard', '#c9963a'], ['yellow', '#e8cf4a'],
  ['olive', '#6f7240'], ['sage green', '#a3b19a'], ['green', '#3f8a4a'], ['emerald', '#1f5a4a'], ['bright green', '#00d000'], ['teal', '#2f6f6a'],
  ['light blue', '#a9c8df'], ['blue', '#3c6e9e'], ['navy', '#1f2f50'], ['lavender', '#b8a9d0'], ['purple', '#6a3f86'], ['magenta', '#d0208f'],
]
const ref = NAMED.map(([n, h]) => [n, new THREE.Color(h)] as const)
export function colorName(hex: string) {
  const c = new THREE.Color(hex)
  let best = ref[0], d = Infinity
  for (const r of ref) {
    const e = (c.r - r[1].r) ** 2 * 0.3 + (c.g - r[1].g) ** 2 * 0.59 + (c.b - r[1].b) ** 2 * 0.11
    if (e < d) { d = e; best = r }
  }
  return best[0]
}

function matText(m: MaterialSpec | undefined, fallback?: string) {
  if (!m) return fallback ? colorName(fallback) : ''
  const def = m.finish ? FINISH_BY_KEY[m.finish] : undefined
  const label = def?.label.toLowerCase() ?? (m.texture ? 'textured' : '')
  const col = m.color && (!def || m.color.toLowerCase() !== def.color.toLowerCase()) ? colorName(m.color) : ''
  return [col, label].filter(Boolean).join(' ')
}

export function roomKind(name: string) {
  const n = name.toLowerCase()
  if (/bath|shower|ванн|сануз|լոգ/.test(n)) return 'bathroom'
  if (/wc|toilet|туалет|զուգ/.test(n)) return 'toilet room'
  if (/kitchen|кухн|խոհ/.test(n)) return 'kitchen'
  if (/kid|child|nursery|детск|մանկ/.test(n)) return "children's bedroom"
  if (/bed|спальн|ննջ/.test(n)) return 'bedroom'
  if (/living|lounge|salon|гостин|հյուր/.test(n)) return 'living room'
  if (/hall|corridor|entr|прихож|коридор|միջանց/.test(n)) return 'entrance hallway'
  if (/balcon|loggia|балкон|լոջ|պատշ/.test(n)) return 'balcony'
  if (/office|study|кабинет|աշխ/.test(n)) return 'home office'
  if (/dress|closet|гардероб/.test(n)) return 'walk-in closet'
  if (/laundry|прачеч/.test(n)) return 'laundry room'
  if (/storage|pantry|кладов/.test(n)) return 'storage room'
  return 'room'
}

const DECOR: Record<string, string> = {
  bathroom: 'folded towels, a small potted plant, soap dispenser, mirror with soft lighting, chrome fittings',
  'toilet room': 'towel ring, small plant, toilet paper holder, framed print',
  kitchen: 'bowl of fruit, cutting board, cookbooks, pendant lights, kitchen utensils, herbs in pots',
  'living room': 'cushions and a throw, books, indoor plants, framed artwork, floor lamp, curtains',
  bedroom: 'bed linen and pillows, bedside lamps, curtains, framed artwork, a plant',
  "children's bedroom": 'toys, colourful bedding, books, soft rug, night light',
  'entrance hallway': 'coat hooks, shoe bench, round mirror, console with a vase',
  balcony: 'potted plants, small outdoor chairs, lanterns',
  'home office': 'desk lamp, books, laptop, plants, pinboard',
  'walk-in closet': 'hanging clothes, shoe shelves, full-length mirror',
  'laundry room': 'laundry basket, folded towels, shelves with detergents',
  'storage room': 'tidy shelves, labelled boxes',
  room: 'tasteful decor, plants, artwork, soft furnishings',
}

const LIGHT: Record<string, string> = {
  day: 'bright natural daylight from the windows, soft shadows',
  evening: 'warm golden-hour evening light mixed with warm interior lamps',
  night: 'night time, warm cosy artificial lighting from ceiling lights and lamps, dark windows',
}

export function roomPrompt(plan: Plan, room: Room, lighting: string, extra = '') {
  const kind = roomKind(room.name)
  const st = room.style ? STYLE_BY_KEY[room.style] : undefined
  const floor = matText(room.floorMat, room.floorColor) || 'wooden'
  const walls = matText(room.wallMat, room.wallColor ?? '#f2efe9')
  const ceiling = matText(room.ceilingMat, room.ceilingColor ?? '#ffffff')
  const items = plan.furniture
    .filter((f) => pointInPolygon([f.x, f.y], room.polygon) && f.type !== 'generic')
    .map((f) => {
      const label = (f.label || FURNITURE_BY_TYPE[f.type]?.label || f.type).toLowerCase()
      const main = matText(f.mat, f.color ?? FURNITURE_BY_TYPE[f.type]?.color)
      const sec = f.mat2 ? matText(f.mat2) : ''
      return `${main ? `${main} ` : ''}${label}${sec ? ` with ${sec} details` : ''}`
    })
  const uniq = [...new Set(items)].slice(0, 14)
  return [
    `Photorealistic interior photograph of a ${st ? `${st.label.toLowerCase()} style ` : ''}${kind}${st ? ` (${st.desc.toLowerCase()})` : ''}.`,
    `Keep the exact room geometry, camera angle, wall, door, window and furniture positions of the input image.`,
    `Floor: ${floor}. Walls: ${walls}. Ceiling: ${ceiling}.`,
    uniq.length ? `Furniture and fixtures: ${uniq.join('; ')}.` : '',
    `Realistic styling details: ${DECOR[kind]}.`,
    `${LIGHT[lighting] ?? LIGHT.day}.`,
    extra.trim(),
    'Professional real-estate interior photography, wide-angle 24mm lens, high dynamic range, realistic materials and textures, sharp focus, ultra detailed, 8k.',
  ].filter(Boolean).join(' ')
}
