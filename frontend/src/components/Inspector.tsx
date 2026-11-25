import { useState } from 'react'
import { ELECTRICAL, FLOORS, FURNITURE, FURNITURE_BY_TYPE, PLUMBING, ROOM_PRESETS, RUN_STYLE, WALL_COLORS } from '../lib/catalog'
import { polygonArea, polygonPerimeter, runLength, wallFrame } from '../lib/geometry'
import { FINISHES, FINISH_BY_KEY, FINISH_GROUPS, finishThumb, textureFromFile } from '../lib/materials'
import { findEntity, useStore } from '../lib/store'
import { ROOM_STYLES, STYLE_BY_KEY, applyStyle } from '../lib/styles'
import type { MaterialSpec, Fixture, Furniture, Opening, Overlay, PipeKind, Room, Run, Viewpoint, Wall } from '../lib/types'

function Num({ label, value, onChange, step = 0.01, min, max, unit = 'm' }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  return (
    <label className="row">
      <span>{label}</span>
      <input type="number" value={Number.isFinite(value) ? +value.toFixed(3) : 0} step={step} min={min} max={max}
        onChange={(e) => e.target.value !== '' && onChange(parseFloat(e.target.value))} />
      <span className="muted small" style={{ width: 22 }}>{unit}</span>
    </label>
  )
}

function Swatches({ value, onChange, colors = WALL_COLORS }: { value?: string; onChange: (c?: string) => void; colors?: string[] }) {
  return (
    <div className="swatches">
      {colors.map((c) => <button key={c} className={`swatch ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />)}
      <input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} title="Custom colour" />
      {value && <button className="ghost small" onClick={() => onChange(undefined)}>reset</button>}
    </div>
  )
}

/** Finish + colour + texture picker used for every surface and item. */
function MaterialPicker({ label, value, fallback, groups, onChange }: { label: string; value?: MaterialSpec; fallback: string; groups?: readonly string[]; onChange: (m?: MaterialSpec) => void }) {
  const [open, setOpen] = useState(false)
  const def = value?.finish ? FINISH_BY_KEY[value.finish] : undefined
  const color = value?.color ?? def?.color ?? fallback
  const list = FINISH_GROUPS.filter((g) => !groups || groups.includes(g))
  return (
    <div className="matpick">
      <div className="matpick-head" onClick={() => setOpen(!open)}>
        <img src={value?.texture ?? finishThumb(value?.finish ?? 'paint_matte', color)} alt="" />
        <span className="grow"><b>{label}</b><br /><span className="muted">{value?.texture ? 'Custom texture' : def?.label ?? 'Colour only'}</span></span>
        <input type="color" value={color} onClick={(e) => e.stopPropagation()} onChange={(e) => onChange({ ...value, color: e.target.value })} title="Colour / tint" />
        <span className="muted">{open ? '▴' : '▾'}</span>
      </div>
      {open && (
        <>
          {list.map((g) => (
            <div key={g}>
              <div className="matgroup">{g}</div>
              <div className="matgrid">
                {FINISHES.filter((f) => f.group === g).map((f) => (
                  <button key={f.key} title={f.label} className={value?.finish === f.key && !value?.texture ? 'on' : ''} onClick={() => onChange({ finish: f.key })}>
                    <img src={finishThumb(f.key)} alt={f.label} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="chips" style={{ alignItems: 'center' }}>
            <label className="small" style={{ cursor: 'pointer' }}>
              <span className="btnlike">📷 Upload texture photo</span>
              <input type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) onChange({ ...value, texture: await textureFromFile(f), color: undefined, scale: value?.scale ?? 0.6 })
                e.target.value = ''
              }} />
            </label>
            {value && <button className="ghost small" onClick={() => onChange(undefined)}>reset</button>}
          </div>
          {(value?.texture || (def && def.pattern !== 'plain')) && (
            <label className="row"><span>Pattern size</span>
              <input type="range" min={0.1} max={3} step={0.05} value={value?.scale ?? 1} onChange={(e) => onChange({ ...value, scale: +e.target.value })} />
              <span className="muted small" style={{ width: 34 }}>{(value?.scale ?? 1).toFixed(2)}m</span>
            </label>
          )}
        </>
      )}
    </div>
  )
}

function StyleSelect({ value, onChange, placeholder = 'Choose style…' }: { value?: string; onChange: (k: string) => void; placeholder?: string }) {
  return (
    <select value={value ?? ''} onChange={(e) => e.target.value && onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {ROOM_STYLES.map((st) => <option key={st.key} value={st.key}>{st.label} — {st.desc}</option>)}
    </select>
  )
}

const WALL_GROUPS = ['Paint & plaster', 'Wallpaper', 'Wood', 'Stone & tile', 'Brick & concrete']
const FLOOR_GROUPS = ['Wood', 'Stone & tile', 'Brick & concrete', 'Fabric & leather', 'Paint & plaster']

export default function Inspector() {
  const plan = useStore((s) => s.plan)
  const sel = useStore((s) => s.selection)
  const update = useStore((s) => s.update)
  const del = useStore((s) => s.deleteSelection)
  const dup = useStore((s) => s.duplicateSelection)
  const ent = findEntity(plan, sel)

  if (!sel || !ent) return <PlanSettings />
  const co = { coalesce: `insp:${sel.id}` }
  const patch = <T,>(fn: (e: T) => void) =>
    update((d) => {
      const e = findEntity(d, sel) as T | null
      if (e) fn(e)
    }, co)

  const header = (title: string) => (
    <h4>
      {title}
      <span style={{ display: 'flex', gap: 4 }}>
        {sel.kind !== 'wall' && sel.kind !== 'opening' && sel.kind !== 'overlay' && <button className="ghost small" title="Duplicate (Ctrl+D)" onClick={dup}>⧉</button>}
        <button className="ghost small danger" title="Delete (Del)" onClick={del}>🗑</button>
      </span>
    </h4>
  )

  if (sel.kind === 'wall') {
    const w = ent as Wall
    const { L } = wallFrame(w)
    return (
      <div className="section">
        {header('Wall')}
        <Num label="Length" value={L} onChange={(v) => patch<Wall>((x) => { const f = wallFrame(x); x.b = [x.a[0] + f.u[0] * v, x.a[1] + f.u[1] * v] })} />
        <Num label="Thickness" value={w.thickness} onChange={(v) => patch<Wall>((x) => (x.thickness = Math.max(0.03, v)))} />
        <Num label="Height" value={w.height ?? plan.settings.wallHeight} onChange={(v) => patch<Wall>((x) => (x.height = v))} />
        <div className="grid2">
          <Num label="Start X" value={w.a[0]} onChange={(v) => patch<Wall>((x) => (x.a = [v, x.a[1]]))} />
          <Num label="Start Y" value={w.a[1]} onChange={(v) => patch<Wall>((x) => (x.a = [x.a[0], v]))} />
        </div>
        <MaterialPicker label="Wall finish (both sides)" value={w.mat ?? (w.color ? { color: w.color } : undefined)} fallback={plan.settings.defaultWallColor} groups={WALL_GROUPS}
          onChange={(m) => patch<Wall>((x) => { x.mat = m; x.color = undefined })} />
        <p className="small muted">Leave unset to use each room's wall finish on its side.</p>
        <p className="small muted">Drag the blue end handles to reshape. Hold Alt to detach from connected walls.</p>
      </div>
    )
  }
  if (sel.kind === 'opening') {
    const o = ent as Opening
    const wall = plan.walls.find((w) => w.id === o.wallId)
    return (
      <div className="section">
        {header(o.type === 'door' ? 'Door' : o.type === 'window' ? 'Window' : o.type === 'balcony' ? 'Open balcony' : 'Opening')}
        <label className="row"><span>Type</span>
          <select value={o.type} onChange={(e) => patch<Opening>((x) => { x.type = e.target.value as Opening['type']; if (x.type === 'window') { x.sill = 0.85; x.height = 1.5 } else if (x.type === 'balcony') { x.sill = 1; x.height = Math.max(0.5, plan.settings.wallHeight - 1); x.railing ??= 'glass' } else { x.sill = 0; x.height = 2.1 } })}>
            <option value="door">Door</option><option value="window">Window</option><option value="opening">Open passage</option><option value="balcony">Open balcony (railing, no glass)</option>
          </select>
        </label>
        <Num label="Width" value={o.width} onChange={(v) => patch<Opening>((x) => (x.width = Math.max(0.2, v)))} />
        <Num label="Height" value={o.height} onChange={(v) => patch<Opening>((x) => (x.height = v))} />
        {o.type === 'window' && <Num label="Sill height" value={o.sill} onChange={(v) => patch<Opening>((x) => (x.sill = v))} />}
        {o.type === 'balcony' && <>
          <label className="row"><span>Below</span>
            <select value={o.railing ?? 'glass'} onChange={(e) => patch<Opening>((x) => (x.railing = e.target.value as Opening['railing']))}>
              <option value="glass">Glass railing</option><option value="metal">Metal railing</option><option value="parapet">Solid parapet wall</option>
            </select>
          </label>
          <Num label="Railing height" value={o.sill} onChange={(v) => patch<Opening>((x) => (x.sill = Math.max(0, v)))} />
          <p className="small muted">Open (no glass) above the railing. Set Height so railing + height reaches the ceiling ({plan.settings.wallHeight} m) to remove the lintel.</p>
        </>}
        <Num label="From start" value={o.offset - o.width / 2} onChange={(v) => patch<Opening>((x) => (x.offset = v + x.width / 2))} />
        {wall && <p className="small muted">Wall length {wallFrame(wall).L.toFixed(2)} m · drag along the wall to move.</p>}
        {o.type === 'door' && (
          <div className="chips" style={{ marginBottom: 8 }}>
            <button onClick={() => patch<Opening>((x) => (x.hinge = x.hinge === 'end' ? 'start' : 'end'))}>⇋ Flip hinge</button>
            <button onClick={() => patch<Opening>((x) => (x.swing = x.swing === -1 ? 1 : -1))}>⇅ Flip swing</button>
          </div>
        )}
        <div className="row"><span>Frame colour</span></div>
        <Swatches value={o.color} onChange={(c) => patch<Opening>((x) => (x.color = c))} colors={['#ffffff', '#e9e3d8', '#a4825a', '#6b4f3a', '#3b3b3b']} />
        <MaterialPicker label={o.type === 'door' ? 'Door leaf finish' : 'Frame finish'} value={o.mat} fallback={o.color ?? '#e9e3d8'} groups={['Wood', 'Plastic & lacquer', 'Metal & glass']}
          onChange={(m) => patch<Opening>((x) => (x.mat = m))} />
      </div>
    )
  }
  if (sel.kind === 'room') {
    const r = ent as Room
    return (
      <div className="section">
        {header('Room')}
        <label className="row"><span>Name</span><input value={r.name} list="room-presets" onChange={(e) => patch<Room>((x) => (x.name = e.target.value))} /></label>
        <datalist id="room-presets">{ROOM_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
        <p className="small muted">Area <b>{polygonArea(r.polygon).toFixed(2)} m²</b> · perimeter {polygonPerimeter(r.polygon).toFixed(2)} m · wall area ≈ {(polygonPerimeter(r.polygon) * plan.settings.wallHeight).toFixed(1)} m²</p>
        <label className="row"><span>Style</span>
          <StyleSelect value={r.style} onChange={(k) => update((d) => { const x = d.rooms.find((q) => q.id === r.id); if (x) applyStyle(d, x, k) })} />
        </label>
        {r.style && <p className="small muted">{STYLE_BY_KEY[r.style]?.desc}. Applied to floor, walls, ceiling and the furniture in this room — override anything below.</p>}
        <MaterialPicker label="Floor" value={r.floorMat} fallback={r.floorColor ?? '#c49a6c'} groups={FLOOR_GROUPS} onChange={(m) => patch<Room>((x) => (x.floorMat = m))} />
        <MaterialPicker label="Walls" value={r.wallMat ?? (r.wallColor ? { color: r.wallColor } : undefined)} fallback={plan.settings.defaultWallColor} groups={WALL_GROUPS}
          onChange={(m) => patch<Room>((x) => { x.wallMat = m; x.wallColor = m?.color })} />
        <MaterialPicker label="Ceiling" value={r.ceilingMat ?? (r.ceilingColor ? { color: r.ceilingColor } : undefined)} fallback="#fafafa" groups={['Paint & plaster', 'Wood', 'Brick & concrete']}
          onChange={(m) => patch<Room>((x) => { x.ceilingMat = m?.finish || m?.texture ? m : undefined; x.ceilingColor = m?.color })} />
        {!r.floorMat && <><label className="row"><span>Floor</span>
          <select value={r.floor ?? plan.settings.defaultFloor} onChange={(e) => patch<Room>((x) => { x.floor = e.target.value; x.floorColor = undefined })}>
            {FLOORS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <div className="row"><span>Floor tint</span></div>
        <Swatches value={r.floorColor} onChange={(c) => patch<Room>((x) => (x.floorColor = c))} colors={FLOORS.map((f) => f.color)} /></>}
      </div>
    )
  }
  if (sel.kind === 'furniture') {
    const f = ent as Furniture
    return (
      <div className="section">
        {header(FURNITURE_BY_TYPE[f.type]?.label ?? 'Furniture')}
        <label className="row"><span>Type</span>
          <select value={f.type} onChange={(e) => patch<Furniture>((x) => { const d = FURNITURE_BY_TYPE[e.target.value]; x.type = e.target.value; if (d) { x.width = d.w; x.depth = d.d; x.height = d.h; x.color = d.color } })}>
            {f.type === 'generic' && <option value="generic">From drawing</option>}
            {FURNITURE.map((d) => <option key={d.type} value={d.type}>{d.category} · {d.label}</option>)}
          </select>
        </label>
        <div className="grid2">
          <Num label="Width" value={f.width} onChange={(v) => patch<Furniture>((x) => (x.width = v))} />
          <Num label="Depth" value={f.depth} onChange={(v) => patch<Furniture>((x) => (x.depth = v))} />
          <Num label="Height" value={f.height} onChange={(v) => patch<Furniture>((x) => (x.height = v))} />
          <Num label="Rotation" unit="°" step={15} value={f.rotation} onChange={(v) => patch<Furniture>((x) => (x.rotation = ((v % 360) + 360) % 360))} />
        </div>
        <div className="chips" style={{ marginBottom: 8 }}>
          <button onClick={() => patch<Furniture>((x) => (x.rotation = (x.rotation + 90) % 360))}>⟳ 90°</button>
          <button onClick={() => patch<Furniture>((x) => { [x.width, x.depth] = [x.depth, x.width] })}>Swap W/D</button>
        </div>
        <div className="row"><span>Colour</span></div>
        <Swatches value={f.mat?.color ?? f.color} onChange={(c) => patch<Furniture>((x) => { x.color = c; if (x.mat) x.mat = { ...x.mat, color: c } })} colors={['#f0ece4', '#d9d2c5', '#a4825a', '#6b4f3a', '#7a8ca3', '#3b3b3b', '#9a7b6a', '#4f8a4b']} />
        <MaterialPicker label="Main material" value={f.mat} fallback={f.color ?? FURNITURE_BY_TYPE[f.type]?.color ?? '#bbb'} onChange={(m) => patch<Furniture>((x) => (x.mat = m))} />
        <MaterialPicker label="Frame / legs / fronts" value={f.mat2} fallback="#6b5444" onChange={(m) => patch<Furniture>((x) => (x.mat2 = m))} />
        <p className="small muted">Drag to move, drag the green handle to rotate (Shift = free).</p>
      </div>
    )
  }
  if (sel.kind === 'electrical' || sel.kind === 'plumbing') {
    const f = ent as Fixture
    const list = sel.kind === 'electrical' ? ELECTRICAL : PLUMBING
    return (
      <div className="section">
        {header(list.find((d) => d.type === f.type)?.label ?? 'Point')}
        <label className="row"><span>Type</span>
          <select value={f.type} onChange={(e) => patch<Fixture>((x) => { x.type = e.target.value; const d = list.find((q) => q.type === x.type); if (d) x.z = d.z < 0 ? plan.settings.wallHeight : d.z })}>
            {list.map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
          </select>
        </label>
        <Num label="Height" value={f.z} onChange={(v) => patch<Fixture>((x) => (x.z = v))} />
        <Num label="Rotation" unit="°" step={15} value={f.rotation} onChange={(v) => patch<Fixture>((x) => (x.rotation = v))} />
        <div className="row"><span>Colour</span></div>
        <Swatches value={f.color} onChange={(c) => patch<Fixture>((x) => (x.color = c))} colors={['#ffffff', '#f0ece4', '#2b2b2d', '#b8bcc0', '#c9a45c', '#e0a000']} />
        <label className="row"><span>Circuit / note</span><input value={f.circuit ?? ''} placeholder="e.g. C3 kitchen" onChange={(e) => patch<Fixture>((x) => (x.circuit = e.target.value))} /></label>
        <p className="small muted">Points snap to the nearest wall when dragged (hold Shift to place freely).</p>
      </div>
    )
  }
  if (sel.kind === 'run') {
    const r = ent as Run
    return (
      <div className="section">
        {header(RUN_STYLE[r.kind].label)}
        <label className="row"><span>Kind</span>
          <select value={r.kind} onChange={(e) => patch<Run>((x) => { x.kind = e.target.value as PipeKind; x.z = RUN_STYLE[x.kind].z })}>
            {(Object.keys(RUN_STYLE) as PipeKind[]).map((k) => <option key={k} value={k}>{RUN_STYLE[k].label}</option>)}
          </select>
        </label>
        <Num label="Height" value={r.z} onChange={(v) => patch<Run>((x) => (x.z = v))} />
        <label className="row"><span>Circuit / note</span><input value={r.circuit ?? ''} onChange={(e) => patch<Run>((x) => (x.circuit = e.target.value))} /></label>
        <p className="small muted">Length {runLength(r.points).toFixed(2)} m (+ vertical drops) · {r.points.length} points</p>
      </div>
    )
  }
  if (sel.kind === 'viewpoint') {
    const v = ent as Viewpoint
    return (
      <div className="section">
        {header('360° viewpoint')}
        <label className="row"><span>Name</span><input value={v.name} onChange={(e) => patch<Viewpoint>((x) => (x.name = e.target.value))} /></label>
        <Num label="Eye height" value={v.z} onChange={(v2) => patch<Viewpoint>((x) => (x.z = v2))} />
        <button className="primary" onClick={() => useStore.getState().set({ viewMode: useStore.getState().viewMode === '2d' ? 'split' : useStore.getState().viewMode, mode3d: 'pano', activeViewpoint: v.id })}>Open 360° view</button>
      </div>
    )
  }
  if (sel.kind === 'overlay') {
    const o = ent as Overlay
    return (
      <div className="section">
        {header(`Drawing: ${o.name}`)}
        <label className="layer"><input type="checkbox" checked={o.visible} onChange={(e) => patch<Overlay>((x) => (x.visible = e.target.checked))} /> Visible</label>
        <label className="row"><span>Opacity</span><input type="range" min={0.05} max={1} step={0.05} value={o.opacity} onChange={(e) => patch<Overlay>((x) => (x.opacity = +e.target.value))} /></label>
        <div className="grid2">
          <Num label="X" value={o.x} onChange={(v) => patch<Overlay>((x) => (x.x = v))} />
          <Num label="Y" value={o.y} onChange={(v) => patch<Overlay>((x) => (x.y = v))} />
        </div>
        <Num label="Width" value={o.width} onChange={(v) => patch<Overlay>((x) => { x.height *= v / x.width; x.width = v })} />
      </div>
    )
  }
  return null
}

function PlanSettings() {
  const plan = useStore((s) => s.plan)
  const update = useStore((s) => s.update)
  const select = useStore((s) => s.select)
  const total = plan.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0)
  return (
    <div className="section">
      <h4>Apartment</h4>
      <label className="row"><span>Style all rooms</span>
        <StyleSelect onChange={(k) => update((d) => d.rooms.forEach((r) => applyStyle(d, r, k)))} />
      </label>
      <Num label="Ceiling height" value={plan.settings.wallHeight} onChange={(v) => update((d) => (d.settings.wallHeight = v), { coalesce: 'wh' })} />
      <label className="row"><span>Default floor</span>
        <select value={plan.settings.defaultFloor} onChange={(e) => update((d) => (d.settings.defaultFloor = e.target.value))}>
          {FLOORS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </label>
      <div className="row"><span>Wall colour</span></div>
      <Swatches value={plan.settings.defaultWallColor} onChange={(c) => update((d) => (d.settings.defaultWallColor = c ?? '#f4f1ea'))} />
      <p className="small muted" style={{ marginTop: 10 }}>
        {plan.rooms.length} rooms · <b>{total.toFixed(2)} m²</b> · {plan.walls.length} walls · {plan.openings.filter((o) => o.type === 'door').length} doors · {plan.openings.filter((o) => o.type === 'window').length} windows
        {plan.settings.scale ? ` · drawing scale 1:${plan.settings.scale}` : ''}
      </p>
      {plan.overlays.length > 0 && (
        <>
          <h4 style={{ marginTop: 10 }}>Uploaded drawings</h4>
          {plan.overlays.map((o) => (
            <div key={o.id} className="row">
              <input type="checkbox" checked={o.visible} onChange={(e) => update((d) => { const x = d.overlays.find((q) => q.id === o.id); if (x) x.visible = e.target.checked })} />
              <a href="#" onClick={(e) => { e.preventDefault(); select({ kind: 'overlay', id: o.id }) }} style={{ flex: 1 }}>{o.name}</a>
              <span className="muted small">{o.kind}</span>
            </div>
          ))}
        </>
      )}
      <p className="small muted">Select anything on the plan or in 3D to edit it here. Shortcuts: <span className="kbd">Ctrl+Z</span> undo, <span className="kbd">Del</span> delete, <span className="kbd">Esc</span> cancel.</p>
      <p className="small muted">Tip: if the imported size looks off, use the Scale tool on a known dimension.</p>
    </div>
  )
}
