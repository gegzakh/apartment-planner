import { useState } from 'react'
import { importFile, type ImportResult } from '../lib/api'
import { uid } from '../lib/geometry'
import { useStore } from '../lib/store'
import type { Overlay, Plan } from '../lib/types'

export default function ImportDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Overlay['kind']>('general')
  const [scale, setScale] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const [mode, setMode] = useState<'replace' | 'add'>('replace')
  const hasPlan = useStore((s) => s.plan.walls.length > 0)

  async function run(file: File) {
    setBusy(true)
    setErr('')
    try {
      const res = await importFile(file, kind, scale ? +scale : undefined)
      apply(res, file.name)
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function apply(res: ImportResult, name: string) {
    const st = useStore.getState()
    const ov: Overlay = { id: uid('ov'), kind: res.kind, name, url: res.overlayUrl, ...res.overlay, opacity: 0.5, visible: true }
    // align secondary drawings with the existing general drawing when sizes match
    const general = st.plan.overlays.find((o) => o.kind === 'general')
    if (res.kind !== 'general' && general && Math.abs(general.width - ov.width) / general.width < 0.05) {
      ov.x = general.x
      ov.y = general.y
      ov.width = general.width
      ov.height = general.height
    }
    st.update((d: Plan) => {
      if (res.kind === 'general' && res.detected && (mode === 'replace' || !hasPlan)) {
        d.walls = res.walls ?? []
        d.openings = res.openings ?? []
        d.rooms = res.rooms ?? []
        d.furniture = res.furniture ?? []
        d.overlays = d.overlays.filter((o) => o.kind !== 'general')
        if (res.scale) d.settings.scale = res.scale
        ov.visible = false
      } else if (res.kind === 'general' && res.detected) {
        d.walls.push(...(res.walls ?? []))
        d.openings.push(...(res.openings ?? []))
        d.rooms.push(...(res.rooms ?? []))
        d.furniture.push(...(res.furniture ?? []))
      }
      d.overlays.push(ov)
    })
    if (res.kind !== 'general' || !res.detected) {
      st.setLayers({ overlays: true })
      st.setTool(res.kind === 'plumbing' ? 'plumbing' : res.kind === 'electrical' ? 'electrical' : 'wall', res.kind === 'plumbing' ? 'cold_outlet' : res.kind === 'electrical' ? 'socket' : '0.12')
    }
    window.dispatchEvent(new Event('plan:fit'))
    const s = res.stats
    st.notify(
      res.detected && s
        ? `Imported ${s.walls} walls, ${s.doors} doors, ${s.windows} windows, ${s.rooms} rooms, ${s.furniture} furniture items${res.scale ? ` (scale 1:${res.scale})` : ''}`
        : res.warning ?? `${name} added as a tracing overlay — place symbols on top of it`,
    )
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Upload a plan <button className="ghost" onClick={onClose}>✕</button></h3>
        <div className="row"><span>Drawing type</span>
          <div className="seg">
            {(['general', 'electrical', 'plumbing'] as const).map((k) => (
              <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{k === 'general' ? 'General plan' : k === 'electrical' ? 'Electrical' : 'Water / plumbing'}</button>
            ))}
          </div>
        </div>
        {kind === 'general' && (
          <>
            <label className="row"><span>Drawing scale</span>
              <select value={scale} onChange={(e) => setScale(e.target.value)}>
                <option value="">Auto-detect</option>
                {[20, 25, 50, 75, 100, 200].map((s) => <option key={s} value={s}>1:{s}</option>)}
              </select>
            </label>
            {hasPlan && (
              <label className="row"><span>Existing plan</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'replace' | 'add')}>
                  <option value="replace">Replace walls, rooms & furniture</option>
                  <option value="add">Add to current plan</option>
                </select>
              </label>
            )}
          </>
        )}
        <p className="small muted">
          {kind === 'general'
            ? 'Vector PDFs exported from AutoCAD/ArchiCAD are converted automatically into walls, doors, windows, rooms and furniture. Scanned images are added as a tracing overlay.'
            : 'The drawing is placed as a semi-transparent overlay aligned with the general plan. Use the Electrical / Water palettes on the left to place points and runs on top of it.'}
        </p>
        <div
          className={`drop ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) run(f) }}
          onClick={() => document.getElementById('import-file')?.click()}
        >
          {busy ? 'Processing…' : 'Drop a PDF, PNG or JPG here, or click to choose'}
          <input id="import-file" type="file" accept=".pdf,.png,.jpg,.jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = '' }} />
        </div>
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      </div>
    </div>
  )
}
