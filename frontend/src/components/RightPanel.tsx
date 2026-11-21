import { useMemo, useState } from 'react'
import { floorName } from '../lib/materials'
import { ELECTRICAL_BY_TYPE, FLOOR_BY_KEY, PLUMBING_BY_TYPE, RUN_STYLE } from '../lib/catalog'
import { polygonArea, polygonPerimeter, runLength, wallFrame } from '../lib/geometry'
import { ALL_LAYERS, LAYER_PRESETS, useStore } from '../lib/store'
import type { PipeKind } from '../lib/types'
import Inspector from './Inspector'

export default function RightPanel() {
  const [tab, setTab] = useState<'edit' | 'layers' | 'qty' | 'versions'>('edit')
  const selection = useStore((s) => s.selection)
  return (
    <aside className="side right">
      <div className="tabs">
        {([['edit', selection ? 'Properties' : 'Apartment'], ['layers', 'Layers'], ['qty', 'Quantities'], ['versions', 'Versions']] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'edit' && <Inspector />}
      {tab === 'layers' && <Layers />}
      {tab === 'qty' && <Quantities />}
      {tab === 'versions' && <Versions />}
    </aside>
  )
}

function Layers() {
  const layers = useStore((s) => s.layers)
  const toggle = useStore((s) => s.toggleLayer)
  const setLayers = useStore((s) => s.setLayers)
  const groups = [...new Set(ALL_LAYERS.map((l) => l.group))]
  return (
    <>
      <div className="section">
        <h4>Presets</h4>
        <div className="chips">
          {Object.entries(LAYER_PRESETS).map(([k, v]) => <button key={k} onClick={() => setLayers(v)}>{k}</button>)}
        </div>
      </div>
      {groups.map((g) => (
        <div className="section" key={g}>
          <h4>{g}</h4>
          {ALL_LAYERS.filter((l) => l.group === g).map((l) => (
            <label key={l.key} className="layer">
              <input type="checkbox" checked={layers[l.key]} onChange={() => toggle(l.key)} /> {l.label}
            </label>
          ))}
        </div>
      ))}
      <div className="section small muted">Layers apply to both the 2D plan and the 3D view, and to exports.</div>
    </>
  )
}

function Quantities() {
  const plan = useStore((s) => s.plan)
  const q = useMemo(() => {
    const H = plan.settings.wallHeight
    const floors: Record<string, number> = {}
    let floorTotal = 0
    let paint = 0
    for (const r of plan.rooms) {
      const a = polygonArea(r.polygon)
      const k = floorName(r, plan.settings.defaultFloor, (f) => FLOOR_BY_KEY[f]?.label)
      floors[k] = (floors[k] ?? 0) + a
      floorTotal += a
      paint += polygonPerimeter(r.polygon) * H
    }
    const openingArea = plan.openings.reduce((s, o) => s + o.width * o.height, 0)
    paint = Math.max(0, paint - openingArea * 2)
    const wallLen = plan.walls.reduce((s, w) => s + wallFrame(w).L, 0)
    const count = (arr: { type: string }[]) => arr.reduce<Record<string, number>>((m, f) => ((m[f.type] = (m[f.type] ?? 0) + 1), m), {})
    const runs: Record<string, number> = {}
    for (const r of plan.runs) runs[r.kind] = (runs[r.kind] ?? 0) + runLength(r.points)
    // estimated vertical drops to each point
    const drop = plan.electrical.reduce((s, f) => s + Math.abs(RUN_STYLE.wire.z - f.z), 0)
    const watts = plan.electrical.reduce((s, f) => s + (ELECTRICAL_BY_TYPE[f.type]?.watts ?? 0), 0)
    return { floors, floorTotal, paint, wallLen, el: count(plan.electrical), pl: count(plan.plumbing), runs, drop, watts, ceiling: floorTotal }
  }, [plan])
  return (
    <>
      <div className="section">
        <h4>Areas</h4>
        <table className="q"><tbody>
          {plan.rooms.map((r) => <tr key={r.id}><td>{r.name || 'Room'}</td><td>{polygonArea(r.polygon).toFixed(2)} m²</td></tr>)}
          <tr><th>Total floor</th><th>{q.floorTotal.toFixed(2)} m²</th></tr>
        </tbody></table>
      </div>
      <div className="section">
        <h4>Finishes (estimate)</h4>
        <table className="q"><tbody>
          {Object.entries(q.floors).map(([k, a]) => <tr key={k}><td>{k}</td><td>{a.toFixed(1)} m² (+10% = {(a * 1.1).toFixed(1)})</td></tr>)}
          <tr><td>Wall paint (2 coats)</td><td>{q.paint.toFixed(1)} m² · ≈{Math.ceil((q.paint * 2) / 10)} L</td></tr>
          <tr><td>Ceiling</td><td>{q.ceiling.toFixed(1)} m²</td></tr>
          <tr><td>Skirting</td><td>{plan.rooms.reduce((s, r) => s + polygonPerimeter(r.polygon), 0).toFixed(1)} m</td></tr>
          <tr><td>Wall length (centreline)</td><td>{q.wallLen.toFixed(1)} m</td></tr>
        </tbody></table>
      </div>
      <div className="section">
        <h4>Electrical</h4>
        <table className="q"><tbody>
          {Object.entries(q.el).map(([k, n]) => <tr key={k}><td>{ELECTRICAL_BY_TYPE[k]?.label ?? k}</td><td>{n}</td></tr>)}
          {!Object.keys(q.el).length && <tr><td className="muted">No electrical points yet</td><td /></tr>}
          <tr><td>Drawn wire runs</td><td>{(q.runs.wire ?? 0).toFixed(1)} m</td></tr>
          <tr><td>Drops to points (est.)</td><td>{q.drop.toFixed(1)} m</td></tr>
          <tr><th>Connected load (est.)</th><th>{(q.watts / 1000).toFixed(1)} kW</th></tr>
        </tbody></table>
      </div>
      <div className="section">
        <h4>Water & heating</h4>
        <table className="q"><tbody>
          {Object.entries(q.pl).map(([k, n]) => <tr key={k}><td>{PLUMBING_BY_TYPE[k]?.label ?? k}</td><td>{n}</td></tr>)}
          {!Object.keys(q.pl).length && <tr><td className="muted">No plumbing points yet</td><td /></tr>}
          {(['cold', 'hot', 'drain', 'gas'] as PipeKind[]).filter((k) => q.runs[k]).map((k) => <tr key={k}><td>{RUN_STYLE[k].label}</td><td>{q.runs[k].toFixed(1)} m</td></tr>)}
        </tbody></table>
      </div>
      <div className="section">
        <h4>Openings</h4>
        <table className="q"><tbody>
          {plan.openings.map((o) => <tr key={o.id}><td>{o.type}</td><td>{Math.round(o.width * 100)} × {Math.round(o.height * 100)} cm</td></tr>)}
        </tbody></table>
      </div>
    </>
  )
}

function Versions() {
  const versions = useStore((s) => s.versions)
  const plan = useStore((s) => s.plan)
  const compare = useStore((s) => s.compareWith)
  const set = useStore((s) => s.set)
  const setPlan = useStore((s) => s.setPlan)
  const [name, setName] = useState('')
  return (
    <div className="section">
      <h4>Save a version</h4>
      <div className="row">
        <input placeholder={`Version ${versions.length + 1}`} value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" onClick={() => {
          set({ versions: [...versions, { id: crypto.randomUUID(), name: name || `Version ${versions.length + 1}`, createdAt: Date.now(), plan: structuredClone(plan) }], dirty: true })
          setName('')
        }}>Save</button>
      </div>
      <p className="small muted">Keep the original layout and alternatives, then compare: the selected version is drawn as a red ghost over the current plan.</p>
      {[...versions].reverse().map((v) => (
        <div key={v.id} className="card" style={{ marginBottom: 6 }}>
          <b>{v.name}</b>
          <span className="small muted">{new Date(v.createdAt).toLocaleString()} · {v.plan.walls.length} walls · {v.plan.furniture.length} items</span>
          <div className="chips">
            <button className={compare === v.id ? 'active' : ''} onClick={() => set({ compareWith: compare === v.id ? null : v.id })}>{compare === v.id ? 'Stop compare' : 'Compare'}</button>
            <button onClick={() => confirm(`Restore "${v.name}"? Current changes can be undone with Ctrl+Z.`) && setPlan(structuredClone(v.plan))}>Restore</button>
            <button className="danger" onClick={() => set({ versions: versions.filter((x) => x.id !== v.id), compareWith: compare === v.id ? null : compare, dirty: true })}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  )
}
