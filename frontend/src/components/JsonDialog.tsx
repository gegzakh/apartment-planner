import { useState } from 'react'
import { useStore } from '../lib/store'
import type { Plan } from '../lib/types'

export default function JsonDialog({ onClose }: { onClose: () => void }) {
  const plan = useStore((s) => s.plan)
  const [text, setText] = useState(() => JSON.stringify(plan, null, 2))
  const [err, setErr] = useState('')
  function apply() {
    try {
      const p = JSON.parse(text) as Plan
      if (!Array.isArray(p.walls) || !p.settings) throw new Error('Not a plan: "walls" and "settings" are required')
      for (const k of ['openings', 'rooms', 'furniture', 'electrical', 'plumbing', 'runs', 'overlays', 'viewpoints'] as const) p[k] ??= [] as never
      useStore.getState().setPlan(p)
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Plan JSON <button className="ghost" onClick={onClose}>✕</button></h3>
        <p className="small muted">All coordinates are in metres. Edit and press Apply — the 2D and 3D views update immediately (undo with Ctrl+Z).</p>
        <textarea className="json" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <div className="chips" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json'; i.onchange = async () => { const f = i.files?.[0]; if (f) setText(await f.text()) }; i.click() }}>Load file…</button>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  )
}
