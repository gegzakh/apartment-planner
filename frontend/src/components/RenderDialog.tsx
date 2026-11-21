import { useEffect, useMemo, useRef, useState } from 'react'
import { download, shareFile, slug, type ShareTarget } from '../lib/export'
import { roomShots, renderShots, type Shot } from '../lib/renders'
import { useStore } from '../lib/store'
import { STYLE_BY_KEY } from '../lib/styles'

const SIZES: Record<string, [number, number, string]> = {
  hd: [1920, 1080, 'Full HD 1920×1080'],
  '4k': [3840, 2160, '4K 3840×2160'],
  square: [1080, 1080, 'Square 1080 (Instagram post)'],
  portrait: [1080, 1350, 'Portrait 1080×1350 (Instagram)'],
  story: [1080, 1920, 'Story 1080×1920 (WhatsApp / Telegram)'],
  preview: [1280, 720, 'Quick preview 1280×720'],
}

interface Result { shot: Shot; room: string; blob: Blob; url: string }

export default function RenderDialog({ onClose }: { onClose: () => void }) {
  const plan = useStore((s) => s.plan)
  const viewMode = useStore((s) => s.viewMode)
  const lighting = useStore((s) => s.lighting)
  const set = useStore((s) => s.set)
  const sel = useStore((s) => s.selection)
  const [roomId, setRoomId] = useState<string>(sel?.kind === 'room' ? sel.id : plan.rooms[0]?.id ?? '')
  const [size, setSize] = useState('hd')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState<Result | null>(null)
  const [msg, setMsg] = useState('')
  const cancel = useRef(false)

  useEffect(() => {
    if (viewMode === '2d') set({ viewMode: 'split' })
  }, [viewMode, set])
  const urls = useRef<string[]>([])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const rooms = roomId === '*' ? plan.rooms : plan.rooms.filter((r) => r.id === roomId)
  const shots = useMemo(() => rooms.flatMap((r) => roomShots(plan, r)), [rooms, plan])
  const chosen = shots.filter((s) => picked[s.id] ?? true)
  const roomName = (id: string) => plan.rooms.find((r) => r.id === id)?.name ?? 'Room'

  async function go() {
    setBusy(true)
    setMsg('')
    cancel.current = false
    const [w, h] = SIZES[size]
    try {
      await new Promise((r) => setTimeout(r, 300))
      await renderShots(chosen, w, h, (shot, blob) => {
        const url = URL.createObjectURL(blob)
        urls.current.push(url)
        setResults((rs) => [{ shot, room: roomName(shot.roomId), blob, url }, ...rs])
      }, () => cancel.current)
    } catch (e) {
      setMsg(String((e as Error).message ?? e))
    }
    setBusy(false)
  }
  const fname = (r: Result) => `${slug(plan.name)}-${slug(r.room)}-${slug(r.shot.name)}.jpg`
  async function share(r: Result, t: ShareTarget) {
    setMsg(await shareFile(r.blob, fname(r), t, `${plan.name} — ${r.room}, ${r.shot.name}`))
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Room renders <button className="ghost" onClick={onClose}>✕</button></h3>
        <div className="render-cfg">
          <label>Room
            <select value={roomId} onChange={(e) => { setRoomId(e.target.value); setPicked({}) }}>
              <option value="*">All rooms</option>
              {plan.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.style ? ` · ${STYLE_BY_KEY[r.style]?.label}` : ''}</option>)}
            </select>
          </label>
          <label>Size
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v[2]}</option>)}
            </select>
          </label>
          <label>Light
            <select value={lighting} onChange={(e) => set({ lighting: e.target.value as typeof lighting })}>
              <option value="day">Daylight</option><option value="evening">Evening</option><option value="night">Night (lamps)</option>
            </select>
          </label>
        </div>
        <div className="shot-list">
          {shots.map((s) => (
            <label key={s.id} className="shot">
              <input type="checkbox" checked={picked[s.id] ?? true} onChange={(e) => setPicked({ ...picked, [s.id]: e.target.checked })} />
              {roomId === '*' && <b>{roomName(s.roomId)}: </b>}{s.name}
            </label>
          ))}
          {!shots.length && <p className="muted small">This plan has no rooms yet. Draw rooms in 2D first.</p>}
        </div>
        <p className="small muted">Add your own camera spots with the 👁 Viewpoint tool in 2D; viewpoints inside the room appear in this list.</p>
        <div className="chips">
          {!busy && <button className="primary" disabled={!chosen.length} onClick={go}>Render {chosen.length} view{chosen.length === 1 ? '' : 's'}</button>}
          {busy && <button onClick={() => (cancel.current = true)}>Stop</button>}
          {busy && <span className="small muted">Rendering… {results.length} done</span>}
          {results.length > 0 && !busy && <button onClick={() => results.forEach((r, i) => setTimeout(() => download(r.blob, fname(r)), i * 350))}>⬇ Download all ({results.length})</button>}
          {results.length > 0 && !busy && <button className="ghost" onClick={() => { setResults([]); setOpen(null) }}>Clear</button>}
        </div>
        {msg && <p className="small">{msg}</p>}
        {open && (
          <div className="render-big">
            <img src={open.url} alt={open.shot.name} />
            <div className="chips">
              <b className="small">{open.room} · {open.shot.name}</b>
              <button onClick={() => download(open.blob, fname(open))}>⬇ Download</button>
              <button onClick={() => share(open, 'native')}>Share…</button>
              <button onClick={() => share(open, 'telegram')} style={{ color: '#229ED9' }}>Telegram</button>
              <button onClick={() => share(open, 'whatsapp')} style={{ color: '#25D366' }}>WhatsApp</button>
              <button onClick={() => share(open, 'instagram')} style={{ color: '#C13584' }}>Instagram</button>
            </div>
          </div>
        )}
        <div className="render-grid">
          {results.map((r) => (
            <button key={r.url} className={`render-thumb ${open?.url === r.url ? 'on' : ''}`} onClick={() => setOpen(r)} title={`${r.room} · ${r.shot.name}`}>
              <img src={r.url} alt={r.shot.name} />
              <span>{r.room} · {r.shot.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
