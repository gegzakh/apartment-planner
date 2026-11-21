import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import Editor2D from './components/Editor2D'
import ExportDialog from './components/ExportDialog'
import RenderDialog from './components/RenderDialog'
import ImportDialog from './components/ImportDialog'
import JsonDialog from './components/JsonDialog'
import LeftPanel from './components/LeftPanel'
import RightPanel from './components/RightPanel'
import { deleteProject, importFile, listProjects, loadProject, saveProject } from './lib/api'
import { emptyPlan, useStore, type Version } from './lib/store'
import type { Plan } from './lib/types'

const Scene3D = lazy(() => import('./components/Scene3D'))

function normalize(p: Plan): Plan {
  const e = emptyPlan()
  return { ...e, ...p, settings: { ...e.settings, ...p.settings } }
}

export default function App() {
  const viewMode = useStore((s) => s.viewMode)
  const mode3d = useStore((s) => s.mode3d)
  const lighting = useStore((s) => s.lighting)
  const xray = useStore((s) => s.xray)
  const plan = useStore((s) => s.plan)
  const past = useStore((s) => s.past.length)
  const future = useStore((s) => s.future.length)
  const toast = useStore((s) => s.toast)
  const projectId = useStore((s) => s.projectId)
  const dirty = useStore((s) => s.dirty)
  const activeVp = useStore((s) => s.activeViewpoint)
  const { set, undo, redo, update } = useStore.getState()
  const [dialog, setDialog] = useState<null | 'import' | 'export' | 'json' | 'projects' | 'renders'>(null)
  const [saved, setSaved] = useState<'saved' | 'saving' | 'offline'>('saved')
  const loaded = useRef(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const tool = useStore((s) => s.tool)
  const toolArg = useStore((s) => s.toolArg)
  useEffect(() => setToolsOpen(false), [tool, toolArg])

  // ---- load last project ----
  // Browser zoom (pinch, Ctrl+wheel, Ctrl +/-) would scale the side panels too; route it to the plan instead.
  useEffect(() => {
    const wheel = (e: WheelEvent) => e.ctrlKey && e.preventDefault()
    const gesture = (e: Event) => e.preventDefault()
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const f = e.key === '+' || e.key === '=' ? 1.25 : e.key === '-' ? 0.8 : e.key === '0' ? 0 : null
      if (f === null) return
      e.preventDefault()
      if (f) window.dispatchEvent(new CustomEvent('plan:zoom', { detail: f }))
      else window.dispatchEvent(new Event('plan:fit'))
    }
    window.addEventListener('wheel', wheel, { passive: false })
    document.addEventListener('gesturestart', gesture)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('wheel', wheel)
      document.removeEventListener('gesturestart', gesture)
      window.removeEventListener('keydown', key)
    }
  }, [])
  useEffect(() => {
    const id = localStorage.getItem('ap:project') || 'default'
    const local = readBackup(id)
    const unsynced = !!local && localStorage.getItem(unsyncedKey(id)) === '1'
    const fromLocal = (serverVersions?: Version[]) =>
      set({ projectId: id, plan: normalize(local!.plan), versions: local!.versions ?? serverVersions ?? [], past: [], future: [], dirty: unsynced })
    loadProject(id)
      .then((doc) => {
        loaded.current = true
        if (unsynced) fromLocal(doc.versions)
        else set({ projectId: id, plan: normalize(doc.plan), versions: doc.versions ?? [], past: [], future: [], dirty: false })
        window.dispatchEvent(new Event('plan:fit'))
      })
      .catch(() => {
        loaded.current = true
        if (local) fromLocal()
        else setDialog('import')
      })
  }, [set])

  // ---- autosave ----
  useEffect(() => {
    if (!dirty || !loaded.current) return
    backup()
    setSaved('saving')
    const t = setTimeout(async () => {
      const ok = await persist()
      setSaved(!ok ? 'offline' : useStore.getState().dirty ? 'saving' : 'saved')
    }, 1200)
    return () => clearTimeout(t)
  }, [dirty, plan])

  // ---- shortcuts ----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const mod = e.ctrlKey || e.metaKey
      const st = useStore.getState()
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); st.duplicateSelection() }
      else if (e.key === 'Delete' || e.key === 'Backspace') st.deleteSelection()
      else if (!mod && st.mode3d !== 'walk') {
        const map: Record<string, Parameters<typeof st.setTool>> = { v: ['select'], w: ['wall', '0.12'], d: ['door'], r: ['room'], m: ['measure'], h: ['pan'] }
        const k = map[e.key.toLowerCase()]
        if (k && !(st.viewMode === '3d')) st.setTool(...k)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [undo, redo])

  async function loadSample() {
    const blob = await (await fetch('/sample-plan.pdf')).blob()
    const res = await importFile(new File([blob], 'sample-plan.pdf', { type: 'application/pdf' }), 'general')
    const p = emptyPlan()
    p.name = 'Sample apartment'
    p.walls = res.walls ?? []
    p.openings = res.openings ?? []
    p.rooms = res.rooms ?? []
    p.furniture = res.furniture ?? []
    p.settings.scale = res.scale
    p.overlays = [{ id: 'ov_sample', kind: 'general', name: 'sample-plan.pdf', url: res.overlayUrl, ...res.overlay, opacity: 0.5, visible: false }]
    useStore.getState().setPlan(p)
    setDialog(null)
    setTimeout(() => window.dispatchEvent(new Event('plan:fit')), 50)
  }

  async function newProject() {
    if (!(await flushBeforeSwitch())) return
    const id = `p${Date.now().toString(36)}`
    set({ projectId: id, plan: emptyPlan(), versions: [], past: [], future: [], selection: null, dirty: true })
    localStorage.setItem('ap:project', id)
    setDialog('import')
  }

  const show2d = viewMode !== '3d'
  const show3d = viewMode !== '2d'
  return (
    <div className="app">
      <header className="topbar">
        <button className="mobile-only" onClick={() => setToolsOpen((v) => !v)}>☰ Tools</button>
        <span className="brand">🏠 Apartment Planner</span>
        <input className="name-input" value={plan.name} onChange={(e) => update((d) => (d.name = e.target.value), { coalesce: 'name' })} />
        <button onClick={() => setDialog('projects')}>Projects</button>
        <button className="primary" onClick={() => setDialog('import')}>⬆ Upload plan</button>
        <span className="sep" />
        <button className="ghost" disabled={!past} onClick={undo} title="Undo (Ctrl+Z)">↶</button>
        <button className="ghost" disabled={!future} onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</button>
        <span className="sep" />
        <div className="seg">
          {(['2d', 'split', '3d'] as const).map((m) => (
            <button key={m} className={viewMode === m ? 'active' : ''} onClick={() => set({ viewMode: m })}>{m === 'split' ? '2D | 3D' : m.toUpperCase()}</button>
          ))}
        </div>
        <span className="spacer" />
        <span className="small muted">{saved === 'saving' ? 'Saving…' : saved === 'offline' ? 'Saved in browser only' : 'All changes saved'}</span>
        <button onClick={() => setDialog('json')}>{'{ } JSON'}</button>
        <button onClick={() => setDialog('renders')}>📷 Room renders</button>
        <button className="primary" onClick={() => setDialog('export')}>⇪ Download / Share</button>
      </header>
      <div className="main">
        <LeftPanel open={toolsOpen} />
        <div className={`stage ${viewMode === 'split' ? 'split' : ''}`}>
          {show2d && (
            <div className="pane">
              <Editor2D />
              <div className="float-bar right">
                <button onClick={() => window.dispatchEvent(new Event('plan:fit'))} title="Fit to screen">⤢ Fit</button>
              </div>
              {plan.walls.length === 0 && (
                <div className="overlay-hint" style={{ bottom: '45%', pointerEvents: 'auto' }}>
                  Upload a plan PDF, draw walls with the Wall tool, or <a href="#" style={{ color: '#9cd0ff' }} onClick={(e) => { e.preventDefault(); loadSample() }}>open the sample apartment</a>
                </div>
              )}
            </div>
          )}
          {show3d && (
            <div className="pane">
              <Suspense fallback={<div className="overlay-hint">Loading 3D…</div>}>
                <Scene3D />
              </Suspense>
              <div className="float-bar">
                <div className="seg">
                  {(['orbit', 'walk', 'pano'] as const).map((m) => (
                    <button key={m} className={mode3d === m ? 'active' : ''} onClick={() => set({ mode3d: m })}>{m === 'orbit' ? '🧊 Orbit' : m === 'walk' ? '🚶 Walk' : '◉ 360°'}</button>
                  ))}
                </div>
                <div className="seg">
                  {(['day', 'evening', 'night'] as const).map((l) => (
                    <button key={l} className={lighting === l ? 'active' : ''} onClick={() => set({ lighting: l })}>{l === 'day' ? '☀' : l === 'evening' ? '🌇' : '🌙'}</button>
                  ))}
                </div>
                {mode3d === 'orbit' && <button className={xray ? 'active' : ''} onClick={() => set({ xray: !xray })} title="Cut walls at 1.1 m to see inside">✂ Cutaway</button>}
                {mode3d !== 'orbit' && (
                  <select value={activeVp ?? ''} onChange={(e) => set({ activeViewpoint: e.target.value || null })}>
                    <option value="">{plan.viewpoints.length ? 'Viewpoint…' : 'Room centre (add 360° points in 2D)'}</option>
                    {plan.viewpoints.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                )}
                <button className="primary" onClick={() => setDialog('renders')}>📷 Room renders</button>
              </div>
            </div>
          )}
        </div>
        <RightPanel />
      </div>
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} onSample={loadSample} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'renders' && <RenderDialog onClose={() => setDialog(null)} />}
      {dialog === 'json' && <JsonDialog onClose={() => setDialog(null)} />}
      {dialog === 'projects' && (
        <ProjectsDialog current={projectId} onClose={() => setDialog(null)} onNew={newProject} onSample={loadSample} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

const backupKey = (id: string) => `ap:plan:${id}`
const unsyncedKey = (id: string) => `ap:unsynced:${id}`

function readBackup(id: string): { plan: Plan; versions?: Version[] } | null {
  try {
    const d = JSON.parse(localStorage.getItem(backupKey(id)) ?? 'null')
    if (!d) return null
    return d.plan ? d : { plan: d }
  } catch {
    return null
  }
}

/** Writes the current project to browser storage, then to the server. Returns false when offline. */
function backup(): boolean {
  const { projectId: id, plan, versions } = useStore.getState()
  try {
    localStorage.setItem('ap:project', id)
    localStorage.setItem(backupKey(id), JSON.stringify({ plan, versions }))
    localStorage.setItem(unsyncedKey(id), '1')
    return true
  } catch {
    return false
  }
}

/** Saves pending edits before the current plan is replaced; asks the user if they cannot be kept anywhere. */
async function flushBeforeSwitch(): Promise<boolean> {
  if (!useStore.getState().dirty || (await persist()) || backup()) return true
  return window.confirm('Your latest changes could not be saved (offline and browser storage is full). Discard them and continue?')
}

async function persist(): Promise<boolean> {
  backup()
  const { projectId: id, plan, versions } = useStore.getState()
  try {
    await saveProject(id, { name: plan.name, plan, versions })
  } catch {
    return false
  }
  const now = useStore.getState()
  if (now.projectId === id && now.plan === plan && now.versions === versions) {
    localStorage.removeItem(unsyncedKey(id))
    now.set({ dirty: false })
  }
  return true
}

function ProjectsDialog({ current, onClose, onNew, onSample }: { current: string; onClose: () => void; onNew: () => void; onSample: () => void }) {
  const [items, setItems] = useState<{ id: string; name: string; updatedAt: number }[] | null>(null)
  const [err, setErr] = useState('')
  const refresh = () => listProjects().then(setItems).catch((e) => setErr(e.message))
  useEffect(() => { refresh() }, [])
  async function open(id: string) {
    if (!(await flushBeforeSwitch())) return
    const doc = await loadProject(id)
    useStore.getState().set({ projectId: id, plan: normalize(doc.plan), versions: doc.versions ?? [], past: [], future: [], selection: null, dirty: false, compareWith: null })
    localStorage.setItem('ap:project', id)
    onClose()
    setTimeout(() => window.dispatchEvent(new Event('plan:fit')), 50)
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Projects <button className="ghost" onClick={onClose}>✕</button></h3>
        <div className="chips" style={{ marginBottom: 10 }}>
          <button className="primary" onClick={onNew}>+ New project</button>
          <button onClick={onSample}>Load sample apartment</button>
        </div>
        {err && <p className="muted">{err}</p>}
        {items?.length === 0 && <p className="muted">No saved projects yet.</p>}
        {items?.map((p) => (
          <div key={p.id} className="row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
            <b style={{ flex: 1 }}>{p.name}{p.id === current && <span className="muted small"> (open)</span>}</b>
            <span className="small muted">{new Date(p.updatedAt * 1000).toLocaleString()}</span>
            <button onClick={() => open(p.id)}>Open</button>
            <button className="danger" disabled={p.id === current} onClick={async () => { if (confirm(`Delete "${p.name}"?`)) { await deleteProject(p.id); refresh() } }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}
