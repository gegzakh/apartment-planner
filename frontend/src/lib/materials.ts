import * as THREE from 'three'
import { floorTexture } from './textures'
import type { MaterialSpec } from './types'

export interface FinishDef {
  key: string
  label: string
  group: string
  color: string
  pattern: string
  roughness: number
  metalness?: number
  opacity?: number
}

export const FINISH_GROUPS = ['Paint & plaster', 'Wallpaper', 'Wood', 'Stone & tile', 'Brick & concrete', 'Fabric & leather', 'Metal & glass', 'Plastic & lacquer'] as const

export const FINISHES: FinishDef[] = [
  { key: 'paint_matte', label: 'Matte paint', group: 'Paint & plaster', color: '#f2efe9', pattern: 'plain', roughness: 0.95 },
  { key: 'paint_satin', label: 'Satin paint', group: 'Paint & plaster', color: '#e8e2d6', pattern: 'plain', roughness: 0.55 },
  { key: 'venetian', label: 'Venetian plaster', group: 'Paint & plaster', color: '#d9cfc0', pattern: 'plaster', roughness: 0.35 },
  { key: 'microcement', label: 'Microcement', group: 'Paint & plaster', color: '#b9b4ab', pattern: 'concrete', roughness: 0.6 },
  { key: 'wallpaper_stripes', label: 'Striped wallpaper', group: 'Wallpaper', color: '#e7dfd0', pattern: 'stripes', roughness: 0.85 },
  { key: 'wallpaper_damask', label: 'Damask wallpaper', group: 'Wallpaper', color: '#cfc2a8', pattern: 'damask', roughness: 0.8 },
  { key: 'wallpaper_linen', label: 'Linen wallpaper', group: 'Wallpaper', color: '#ddd6c8', pattern: 'fabric', roughness: 0.9 },
  { key: 'oak', label: 'Oak', group: 'Wood', color: '#c49a6c', pattern: 'wood', roughness: 0.6 },
  { key: 'walnut', label: 'Walnut', group: 'Wood', color: '#7b5236', pattern: 'wood', roughness: 0.55 },
  { key: 'ash_light', label: 'Light ash', group: 'Wood', color: '#dcc7a6', pattern: 'wood', roughness: 0.6 },
  { key: 'herringbone', label: 'Herringbone parquet', group: 'Wood', color: '#b98a5a', pattern: 'herringbone', roughness: 0.55 },
  { key: 'wood_panel', label: 'Wood slat panel', group: 'Wood', color: '#a87d52', pattern: 'panel', roughness: 0.6 },
  { key: 'laminate_grey', label: 'Grey laminate', group: 'Wood', color: '#a7a39c', pattern: 'wood', roughness: 0.5 },
  { key: 'tile_60', label: 'Tile 60×60', group: 'Stone & tile', color: '#e9e7e2', pattern: 'tile', roughness: 0.3 },
  { key: 'subway', label: 'Subway tile', group: 'Stone & tile', color: '#f4f4f1', pattern: 'subway', roughness: 0.15 },
  { key: 'hex_tile', label: 'Hexagon tile', group: 'Stone & tile', color: '#d8d6d0', pattern: 'hex', roughness: 0.3 },
  { key: 'marble', label: 'Marble', group: 'Stone & tile', color: '#ece9e4', pattern: 'stone', roughness: 0.15 },
  { key: 'terrazzo', label: 'Terrazzo', group: 'Stone & tile', color: '#e2ddd3', pattern: 'terrazzo', roughness: 0.3 },
  { key: 'granite_dark', label: 'Dark granite', group: 'Stone & tile', color: '#3e3f42', pattern: 'terrazzo', roughness: 0.2 },
  { key: 'brick', label: 'Brick', group: 'Brick & concrete', color: '#a5553a', pattern: 'brick', roughness: 0.9 },
  { key: 'brick_white', label: 'Painted brick', group: 'Brick & concrete', color: '#ece8e1', pattern: 'brick', roughness: 0.9 },
  { key: 'concrete', label: 'Raw concrete', group: 'Brick & concrete', color: '#a9a7a2', pattern: 'concrete', roughness: 0.85 },
  { key: 'fabric', label: 'Woven fabric', group: 'Fabric & leather', color: '#9a9488', pattern: 'fabric', roughness: 1 },
  { key: 'velvet', label: 'Velvet', group: 'Fabric & leather', color: '#3f5b55', pattern: 'fabric', roughness: 0.75 },
  { key: 'boucle', label: 'Bouclé', group: 'Fabric & leather', color: '#ece6da', pattern: 'leather', roughness: 1 },
  { key: 'leather', label: 'Leather', group: 'Fabric & leather', color: '#7a4a2e', pattern: 'leather', roughness: 0.45 },
  { key: 'carpet', label: 'Carpet', group: 'Fabric & leather', color: '#c8bfae', pattern: 'fabric', roughness: 1 },
  { key: 'steel_brushed', label: 'Brushed steel', group: 'Metal & glass', color: '#b8bcc0', pattern: 'brushed', roughness: 0.35, metalness: 0.9 },
  { key: 'black_metal', label: 'Black metal', group: 'Metal & glass', color: '#2b2b2d', pattern: 'plain', roughness: 0.45, metalness: 0.7 },
  { key: 'brass', label: 'Brass', group: 'Metal & glass', color: '#c9a45c', pattern: 'brushed', roughness: 0.3, metalness: 0.95 },
  { key: 'chrome', label: 'Chrome', group: 'Metal & glass', color: '#e3e6e8', pattern: 'plain', roughness: 0.08, metalness: 1 },
  { key: 'glass', label: 'Clear glass', group: 'Metal & glass', color: '#cfe8f3', pattern: 'plain', roughness: 0.05, opacity: 0.35 },
  { key: 'glass_frosted', label: 'Frosted glass', group: 'Metal & glass', color: '#e8eef0', pattern: 'plain', roughness: 0.4, opacity: 0.7 },
  { key: 'lacquer_gloss', label: 'Gloss lacquer', group: 'Plastic & lacquer', color: '#f5f5f3', pattern: 'plain', roughness: 0.12 },
  { key: 'lacquer_matte', label: 'Matte lacquer', group: 'Plastic & lacquer', color: '#d9d4cb', pattern: 'plain', roughness: 0.7 },
  { key: 'ceramic', label: 'Ceramic', group: 'Plastic & lacquer', color: '#fbfbfa', pattern: 'plain', roughness: 0.1 },
  { key: 'plastic', label: 'Plastic', group: 'Plastic & lacquer', color: '#e6e6e6', pattern: 'plain', roughness: 0.5 },
]
export const FINISH_BY_KEY: Record<string, FinishDef> = Object.fromEntries(FINISHES.map((f) => [f.key, f]))

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i += Math.max(1, (s.length / 512) | 0)) h = (h * 31 + s.charCodeAt(i)) | 0
  return `${s.length}:${h}`
}

const imgCache = new Map<string, THREE.Texture>()
function uploadedTexture(url: string) {
  const k = hash(url)
  let t = imgCache.get(k)
  if (!t) {
    t = new THREE.TextureLoader().load(url, () => matCache.forEach((m) => m.map && (m.needsUpdate = true)))
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    imgCache.set(k, t)
  }
  return t
}

const matCache = new Map<string, THREE.MeshStandardMaterial>()

/**
 * Cached material for a finish spec. `faceSize` (metres) is given for geometry whose UVs span 0..1 per face
 * (boxes); omit it for geometry with UVs in metres (floors, ceilings).
 */
export function getMaterial(spec: MaterialSpec | undefined, fallbackColor: string, opt: { faceSize?: [number, number]; fallbackFinish?: string; side?: THREE.Side } = {}) {
  const def = FINISH_BY_KEY[spec?.finish ?? opt.fallbackFinish ?? 'paint_matte'] ?? FINISHES[0]
  const color = spec?.color ?? (spec?.finish ? def.color : fallbackColor)
  const tile = spec?.scale ?? 0
  const fs = opt.faceSize ? opt.faceSize.map((v) => Math.round(v * 20) / 20) : null
  const key = [def.key, color, spec?.texture ? hash(spec.texture) : '', tile, fs?.join('x') ?? 'm', opt.side ?? 0].join('|')
  const hit = matCache.get(key)
  if (hit) return hit
  let map: THREE.Texture | null = null
  if (spec?.texture) map = uploadedTexture(spec.texture).clone()
  else if (def.pattern !== 'plain' || spec?.finish) map = floorTexture(def.pattern, color).clone()
  if (map) {
    const size = tile || (spec?.texture ? 1 : (map.userData.size as number) ?? 1)
    if (fs) map.repeat.set(Math.max(fs[0], 0.05) / size, Math.max(fs[1], 0.05) / size)
    else map.repeat.set(1 / size, 1 / size)
    map.needsUpdate = true
  }
  const m = new THREE.MeshStandardMaterial({
    color: map ? '#ffffff' : color,
    map,
    roughness: def.roughness,
    // Metals mostly show reflections; keep some diffuse colour and boost reflections so they don't go black in dim interiors.
    metalness: Math.min(def.metalness ?? 0, 0.7),
    envMapIntensity: 1 + 2 * (def.metalness ?? 0),
    transparent: def.opacity !== undefined,
    opacity: def.opacity ?? 1,
    side: opt.side ?? THREE.FrontSide,
  })
  if (spec?.texture) m.color.set(spec.color ?? '#ffffff')
  matCache.set(key, m)
  return m
}

const thumbCache = new Map<string, string>()
/** Small data-URL preview of a finish, for swatches. */
export function finishThumb(key: string, color?: string, texture?: string): string {
  if (texture) return texture
  const def = FINISH_BY_KEY[key] ?? FINISHES[0]
  const c = color ?? def.color
  const k = `${key}|${c}`
  const hit = thumbCache.get(k)
  if (hit) return hit
  const src = floorTexture(def.pattern, c).image as HTMLCanvasElement
  const cv = document.createElement('canvas')
  cv.width = cv.height = 48
  const g = cv.getContext('2d')!
  g.drawImage(src, 0, 0, 256, 256, 0, 0, 48, 48)
  if (def.metalness) {
    const grd = g.createLinearGradient(0, 0, 48, 48)
    grd.addColorStop(0, 'rgba(255,255,255,0.45)')
    grd.addColorStop(1, 'rgba(0,0,0,0.2)')
    g.fillStyle = grd
    g.fillRect(0, 0, 48, 48)
  }
  const url = cv.toDataURL()
  thumbCache.set(k, url)
  return url
}

/** Downscales an uploaded photo to a square-ish JPEG data URL suitable for storing in the plan. */
export async function textureFromFile(file: File, max = 768): Promise<string> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(bmp.width * k)
  cv.height = Math.round(bmp.height * k)
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
  return cv.toDataURL('image/jpeg', 0.82)
}

/** Human-readable floor finish of a room, for schedules and quantities. */
export function floorName(r: { floor?: string; floorMat?: MaterialSpec }, defaultFloor: string, legacyLabel: (k: string) => string | undefined): string {
  if (r.floorMat) return r.floorMat.texture ? 'Custom texture' : FINISH_BY_KEY[r.floorMat.finish ?? '']?.label ?? 'Custom colour'
  const k = r.floor ?? defaultFloor
  return legacyLabel(k) ?? k
}
