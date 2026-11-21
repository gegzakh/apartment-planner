import { ELECTRICAL, FLOORS, FURNITURE, FURNITURE_BY_TYPE, PLUMBING, ROOM_PRESETS, RUN_STYLE, WALL_COLORS } from '../lib/catalog'
import { polygonArea, polygonPerimeter, runLength, wallFrame } from '../lib/geometry'
import { findEntity, useStore } from '../lib/store'
import type { Fixture, Furniture, Opening, Overlay, PipeKind, Room, Run, Viewpoint, Wall } from '../lib/types'

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
        <div className="row"><span>Colour</span></div>
        <Swatches value={w.color} onChange={(c) => patch<Wall>((x) => (x.color = c))} />
        <p className="small muted">Drag the blue end handles to reshape. Hold Alt to detach from connected walls.</p>
      </div>
    )
  }
  if (sel.kind === 'opening') {
    const o = ent as Opening
    const wall = plan.walls.find((w) => w.id === o.wallId)
    return (
      <div className="section">
        {header(o.type === 'door' ? 'Door' : o.type === 'window' ? 'Window' : 'Opening')}
        <label className="row"><span>Type</span>
          <select value={o.type} onChange={(e) => patch<Opening>((x) => { x.type = e.target.value as Opening['type']; if (x.type === 'window') { x.sill = 0.85; x.height = 1.5 } else { x.sill = 0; x.height = 2.1 } })}>
            <option value="door">Door</option><option value="window">Window</option><option value="opening">Open passage</option>
          </select>
        </label>
        <Num label="Width" value={o.width} onChange={(v) => patch<Opening>((x) => (x.width = Math.max(0.2, v)))} />
        <Num label="Height" value={o.height} onChange={(v) => patch<Opening>((x) => (x.height = v))} />
        {o.type === 'window' && <Num label="Sill height" value={o.sill} onChange={(v) => patch<Opening>((x) => (x.sill = v))} />}
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
        <label className="row"><span>Floor</span>
          <select value={r.floor ?? plan.settings.defaultFloor} onChange={(e) => patch<Room>((x) => { x.floor = e.target.value; x.floorColor = undefined })}>
            {FLOORS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <div className="row"><span>Floor tint</span></div>
        <Swatches value={r.floorColor} onChange={(c) => patch<Room>((x) => (x.floorColor = c))} colors={FLOORS.map((f) => f.color)} />
        <div className="row" style={{ marginTop: 8 }}><span>Wall colour</span></div>
        <Swatches value={r.wallColor} onChange={(c) => patch<Room>((x) => (x.wallColor = c))} />
        <div className="row" style={{ marginTop: 8 }}><span>Ceiling</span></div>
        <Swatches value={r.ceilingColor} onChange={(c) => patch<Room>((x) => (x.ceilingColor = c))} colors={['#ffffff', '#f4f1ea', '#e8e4dc', '#2e3a40']} />
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
        <Swatches value={f.color} onChange={(c) => patch<Furniture>((x) => (x.color = c))} colors={['#f0ece4', '#d9d2c5', '#a4825a', '#6b4f3a', '#7a8ca3', '#3b3b3b', '#9a7b6a', '#4f8a4b']} />
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
