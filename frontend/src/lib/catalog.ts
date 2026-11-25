import type { PipeKind } from './types'

export interface FurnitureDef {
  type: string
  label: string
  w: number
  d: number
  h: number
  color: string
  category: string
}

export const FURNITURE: FurnitureDef[] = [
  { type: 'sofa', label: 'Sofa', w: 2.2, d: 0.95, h: 0.85, color: '#7a8ca3', category: 'Living' },
  { type: 'sofa_corner', label: 'Corner sofa', w: 2.6, d: 1.7, h: 0.85, color: '#7a8ca3', category: 'Living' },
  { type: 'armchair', label: 'Armchair', w: 0.85, d: 0.85, h: 0.85, color: '#9a7b6a', category: 'Living' },
  { type: 'coffee_table', label: 'Coffee table', w: 1.1, d: 0.6, h: 0.42, color: '#8b6b4a', category: 'Living' },
  { type: 'tv_stand', label: 'TV stand + TV', w: 1.8, d: 0.4, h: 0.5, color: '#3b3b3b', category: 'Living' },
  { type: 'bookshelf', label: 'Bookshelf', w: 1.0, d: 0.35, h: 2.0, color: '#a0825f', category: 'Living' },
  { type: 'rug', label: 'Rug', w: 2.0, d: 1.4, h: 0.01, color: '#c9b8a0', category: 'Living' },
  { type: 'plant', label: 'Plant', w: 0.45, d: 0.45, h: 1.2, color: '#4f8a4b', category: 'Living' },
  { type: 'table', label: 'Dining table', w: 1.6, d: 0.9, h: 0.75, color: '#a4825a', category: 'Dining' },
  { type: 'table_round', label: 'Round table', w: 1.0, d: 1.0, h: 0.75, color: '#a4825a', category: 'Dining' },
  { type: 'chair', label: 'Chair', w: 0.45, d: 0.5, h: 0.9, color: '#6d5c4b', category: 'Dining' },
  { type: 'bed', label: 'Double bed', w: 1.6, d: 2.05, h: 0.5, color: '#d9d2c5', category: 'Bedroom' },
  { type: 'bed_single', label: 'Single bed', w: 0.9, d: 2.0, h: 0.5, color: '#d9d2c5', category: 'Bedroom' },
  { type: 'nightstand', label: 'Nightstand', w: 0.45, d: 0.4, h: 0.5, color: '#8b6b4a', category: 'Bedroom' },
  { type: 'wardrobe', label: 'Wardrobe', w: 1.8, d: 0.6, h: 2.3, color: '#e8e2d6', category: 'Bedroom' },
  { type: 'dresser', label: 'Dresser', w: 1.2, d: 0.5, h: 0.85, color: '#8b6b4a', category: 'Bedroom' },
  { type: 'desk', label: 'Desk', w: 1.4, d: 0.7, h: 0.75, color: '#b89a74', category: 'Office' },
  { type: 'office_chair', label: 'Office chair', w: 0.6, d: 0.6, h: 1.1, color: '#2f2f2f', category: 'Office' },
  { type: 'kitchen_base', label: 'Kitchen base unit', w: 0.6, d: 0.6, h: 0.9, color: '#f0ece4', category: 'Kitchen' },
  { type: 'kitchen_wall', label: 'Kitchen wall unit', w: 0.6, d: 0.35, h: 0.7, color: '#f0ece4', category: 'Kitchen' },
  { type: 'kitchen_sink', label: 'Kitchen sink unit', w: 0.8, d: 0.6, h: 0.9, color: '#f0ece4', category: 'Kitchen' },
  { type: 'stove', label: 'Cooktop/oven', w: 0.6, d: 0.6, h: 0.9, color: '#2b2b2b', category: 'Kitchen' },
  { type: 'fridge', label: 'Fridge', w: 0.6, d: 0.65, h: 1.85, color: '#d8dde2', category: 'Kitchen' },
  { type: 'oven', label: 'Built-in oven', w: 0.6, d: 0.6, h: 0.9, color: '#f0ece4', category: 'Kitchen' },
  { type: 'dishwasher', label: 'Dishwasher', w: 0.6, d: 0.6, h: 0.85, color: '#d8dde2', category: 'Kitchen' },
  { type: 'island', label: 'Kitchen island', w: 1.6, d: 0.9, h: 0.92, color: '#f0ece4', category: 'Kitchen' },
  { type: 'toilet', label: 'Toilet', w: 0.38, d: 0.65, h: 0.75, color: '#ffffff', category: 'Bathroom' },
  { type: 'basin', label: 'Washbasin', w: 0.6, d: 0.45, h: 0.85, color: '#ffffff', category: 'Bathroom' },
  { type: 'bathtub', label: 'Bathtub', w: 1.7, d: 0.75, h: 0.58, color: '#ffffff', category: 'Bathroom' },
  { type: 'shower', label: 'Shower tray', w: 0.9, d: 0.9, h: 2.0, color: '#e6f2f7', category: 'Bathroom' },
  { type: 'washing_machine', label: 'Washing machine', w: 0.6, d: 0.6, h: 0.85, color: '#eef0f2', category: 'Bathroom' },
  { type: 'cabinet', label: 'Cabinet', w: 1.0, d: 0.5, h: 0.9, color: '#d9cbb4', category: 'Storage' },
  { type: 'generic', label: 'Imported block', w: 1.0, d: 1.0, h: 0.75, color: '#c8c2b8', category: 'Storage' },
]

export const FURNITURE_BY_TYPE = Object.fromEntries(FURNITURE.map((f) => [f.type, f]))

export interface FixtureDef {
  type: string
  label: string
  z: number
  symbol: string
  color: string
  watts?: number
}

export const ELECTRICAL: FixtureDef[] = [
  { type: 'socket', label: 'Socket', z: 0.3, symbol: 'S', color: '#e0a000', watts: 200 },
  { type: 'socket_double', label: 'Double socket', z: 0.3, symbol: 'S2', color: '#e0a000', watts: 400 },
  { type: 'socket_counter', label: 'Counter socket', z: 1.1, symbol: 'SK', color: '#e0a000', watts: 1000 },
  { type: 'socket_power', label: 'Power socket (oven/AC)', z: 0.3, symbol: 'P', color: '#d46a00', watts: 3500 },
  { type: 'switch', label: 'Switch', z: 1.0, symbol: 'SW', color: '#3b7dd8' },
  { type: 'switch_double', label: 'Double switch', z: 1.0, symbol: 'SW2', color: '#3b7dd8' },
  { type: 'ceiling_light', label: 'Ceiling light', z: -1, symbol: 'L', color: '#f2c300', watts: 60 },
  { type: 'spot_light', label: 'Spot light', z: -1, symbol: 'sp', color: '#f2c300', watts: 7 },
  { type: 'wall_light', label: 'Wall light', z: 1.8, symbol: 'WL', color: '#f2c300', watts: 40 },
  { type: 'led_strip', label: 'LED strip', z: 2.4, symbol: 'LED', color: '#f2c300', watts: 20 },
  { type: 'panel', label: 'Distribution board', z: 1.6, symbol: 'DB', color: '#c0392b' },
  { type: 'tv_data', label: 'TV / data', z: 0.3, symbol: 'TV', color: '#8e44ad' },
  { type: 'ac', label: 'Air conditioner', z: 2.3, symbol: 'AC', color: '#16a085', watts: 1500 },
  { type: 'intercom', label: 'Intercom', z: 1.5, symbol: 'IC', color: '#8e44ad' },
  { type: 'smoke', label: 'Smoke detector', z: -1, symbol: 'SD', color: '#7f8c8d' },
]

export const PLUMBING: FixtureDef[] = [
  { type: 'cold_outlet', label: 'Cold water outlet', z: 0.5, symbol: 'C', color: '#1e88e5' },
  { type: 'hot_outlet', label: 'Hot water outlet', z: 0.5, symbol: 'H', color: '#e53935' },
  { type: 'drain', label: 'Drain', z: 0.1, symbol: 'D', color: '#6d4c41' },
  { type: 'floor_drain', label: 'Floor drain', z: 0, symbol: 'FD', color: '#6d4c41' },
  { type: 'riser', label: 'Riser / stack', z: 0, symbol: 'R', color: '#455a64' },
  { type: 'valve', label: 'Shut-off valve', z: 0.4, symbol: 'V', color: '#00897b' },
  { type: 'meter', label: 'Water meter', z: 0.6, symbol: 'M', color: '#00897b' },
  { type: 'boiler', label: 'Water heater / boiler', z: 1.4, symbol: 'B', color: '#ef6c00' },
  { type: 'radiator', label: 'Radiator', z: 0.15, symbol: 'RAD', color: '#ef6c00' },
  { type: 'heated_floor', label: 'Underfloor heating', z: 0, symbol: 'UF', color: '#ef6c00' },
]

export const ELECTRICAL_BY_TYPE = Object.fromEntries(ELECTRICAL.map((f) => [f.type, f]))
export const PLUMBING_BY_TYPE = Object.fromEntries(PLUMBING.map((f) => [f.type, f]))

export const RUN_STYLE: Record<PipeKind, { color: string; label: string; dash?: string; radius: number; z: number }> = {
  wire: { color: '#f39c12', label: 'Electric wire', dash: '0.12 0.06', radius: 0.012, z: 2.5 },
  cold: { color: '#1e88e5', label: 'Cold water pipe', radius: 0.016, z: 0.15 },
  hot: { color: '#e53935', label: 'Hot water pipe', radius: 0.016, z: 0.2 },
  drain: { color: '#6d4c41', label: 'Drain pipe', radius: 0.03, z: 0.05 },
  gas: { color: '#fbc02d', label: 'Gas pipe', dash: '0.2 0.05', radius: 0.012, z: 1.8 },
}

export interface FloorDef {
  key: string
  label: string
  color: string
  pattern: 'wood' | 'tile' | 'plain' | 'herringbone' | 'stone'
  pricePerM2?: number
}

export const FLOORS: FloorDef[] = [
  { key: 'oak', label: 'Oak parquet', color: '#c49a6c', pattern: 'wood' },
  { key: 'walnut', label: 'Walnut parquet', color: '#7b5236', pattern: 'wood' },
  { key: 'herringbone', label: 'Herringbone', color: '#b98a5a', pattern: 'herringbone' },
  { key: 'laminate_grey', label: 'Grey laminate', color: '#a7a39c', pattern: 'wood' },
  { key: 'tile_white', label: 'White tile 60×60', color: '#e9e7e2', pattern: 'tile' },
  { key: 'tile_grey', label: 'Grey tile 60×60', color: '#9da1a4', pattern: 'tile' },
  { key: 'marble', label: 'Marble', color: '#ece9e4', pattern: 'stone' },
  { key: 'concrete', label: 'Concrete', color: '#b5b3ae', pattern: 'plain' },
  { key: 'carpet', label: 'Carpet', color: '#c8bfae', pattern: 'plain' },
]
export const FLOOR_BY_KEY = Object.fromEntries(FLOORS.map((f) => [f.key, f]))

export const ROOM_PRESETS = ['Living room', 'Kitchen', 'Bedroom', 'Kids room', 'Bathroom', 'WC', 'Hallway', 'Storage', 'Balcony', 'Loggia', 'Office', 'Dressing room', 'Laundry']

export const WALL_COLORS = ['#f4f1ea', '#ffffff', '#e8e4dc', '#d9d4c7', '#c7d3d9', '#d6e2d3', '#efe1d1', '#e6d3d3', '#5b6770', '#2e3a40']
