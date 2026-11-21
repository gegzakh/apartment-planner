import { useEffect, useMemo, useRef, useState } from 'react'
import { aiClearToken, aiRender, aiSetToken, aiStatus, type AiStatus } from '../lib/api'
import { roomPrompt } from '../lib/aiPrompt'
import { download, shareFile, slug, type ShareTarget } from '../lib/export'
import { roomShots, renderShots, type Shot } from '../lib/renders'
import { useStore } from '../lib/store'
import { ROOM_STYLES, STYLE_BY_KEY, applyStyle } from '../lib/styles'

/** [3D width, 3D height, label, AI shot width, AI shot height] */
const SIZES: Record<string, [number, number, string, number, number]> = {
  hd: [1920, 1080, 'Full HD 1920×1080', 1344, 768],
  '4k': [3840, 2160, '4K 3840×2160', 1344, 768],
  square: [1080, 1080, 'Square 1080 (Instagram post)', 1024, 1024],
  portrait: [1080, 1350, 'Portrait 1080×1350 (Instagram)', 1024, 1280],
  story: [1080, 1920, 'Story 1080×1920 (WhatsApp / Telegram)', 768, 1344],
  preview: [1280, 720, 'Quick preview 1280×720', 1344, 768],
}
const MODELS: [string, string][] = [
  ['depth-pro', 'Best quality – keeps room shape (FLUX Depth Pro, ~$0.05)'],
  ['depth-dev', 'Faster & cheaper (FLUX Depth Dev, ~$0.03)'],
  ['canny-pro', 'Strictest lines & edges (FLUX Canny Pro, ~$0.05)'],
]
const AI_PARALLEL = 3

interface Result {
  id: string
  shot: Shot
  room: string
  blob: Blob
  url: string
  /** 3D preview kept next to the AI photo */
  src?: string
  ai?: 'pending' | 'done' | 'error'
  error?: string
}

export default function RenderDialog({ onClose }: { onClose: () => void }) {
  const plan = useStore((s) => s.plan)
  const viewMode = useStore((s) => s.viewMode)
  const lighting = useStore((s) => s.lighting)
  const set = useStore((s) => s.set)
  const update = useStore((s) => s.update)
  const sel = useStore((s) => s.selection)
  const [roomId, setRoomId] = useState<string>(sel?.kind === 'room' ? sel.id : plan.rooms[0]?.id ?? '')
  const [size, setSize] = useState('hd')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [showSrc, setShowSrc] = useState(false)
  const [msg, setMsg] = useState('')
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [mode, setMode] = useState<'ai' | '3d'>('ai')
  const [model, setModel] = useState('depth-pro')
  const [extra, setExtra] = useState('')
  const [token, setToken] = useState('')
  const cancel = useRef(false)
  const aborts = useRef(new Set<AbortController>())

  useEffect(() => {
    if (viewMode === '2d') set({ viewMode: 'split' })
  }, [viewMode, set])
  useEffect(() => {
    aiStatus().then(setAi).catch(() => setAi({ configured: false, source: null, models: [] }))
  }, [])
  const urls = useRef<string[]>([])
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const ab = aborts.current
    return () => {
      alive.current = false
      cancel.current = true
      ab.forEach((a) => a.abort())
      urls.current.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  const rooms = roomId === '*' ? plan.rooms : plan.rooms.filter((r) => r.id === roomId)
  const shots = useMemo(() => rooms.flatMap((r) => roomShots(plan, r)), [rooms, plan])
  const chosen = shots.filter((s) => picked[s.id] ?? true)
  const roomName = (id: string) => plan.rooms.find((r) => r.id === id)?.name ?? 'Room'
  const useAi = mode === 'ai' && !!ai?.configured
  const open = results.find((r) => r.id === openId) ?? null
  const patchResult = (id: string, p: Partial<Result>) => setResults((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const pending = results.filter((r) => r.ai === 'pending').length

  function styleRooms(key: string) {
    if (!key) return
    const ids = new Set(rooms.map((r) => r.id))
    update((d) => d.rooms.forEach((r) => ids.has(r.id) && applyStyle(d, r, key)))
  }

  async function photo(id: string, shot: Shot, blob: Blob) {
    const p = useStore.getState().plan
    const room = p.rooms.find((r) => r.id === shot.roomId)
    if (!room) return
    const ac = new AbortController()
    aborts.current.add(ac)
    try {
      const url = await aiRender(blob, roomPrompt(p, room, useStore.getState().lighting, extra), model, ac.signal)
      const img = await (await fetch(url)).blob()
      if (!alive.current) return
      const obj = URL.createObjectURL(img)
      urls.current.push(obj)
      setResults((rs) => rs.map((r) => (r.id === id ? { ...r, src: r.url, url: obj, blob: img, ai: 'done' } : r)))
    } catch (e) {
      if (alive.current) patchResult(id, { ai: 'error', error: ac.signal.aborted ? 'Stopped' : String((e as Error).message ?? e) })
    } finally {
      aborts.current.delete(ac)
    }
  }

  async function go() {
    setBusy(true)
    setMsg('')
    cancel.current = false
    const [w3, h3, , wa, ha] = SIZES[size]
    const [w, h] = useAi ? [wa, ha] : [w3, h3]
    const queue: Promise<void>[] = []
    const running = new Set<Promise<void>>()
    try {
      await new Promise((r) => setTimeout(r, 300))
      const items: { id: string; shot: Shot; blob: Blob }[] = []
      await renderShots(chosen, w, h, (shot, blob) => {
        if (!alive.current) return
        const url = URL.createObjectURL(blob)
        urls.current.push(url)
        const id = `${shot.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        setResults((rs) => [{ id, shot, room: roomName(shot.roomId), blob, url, ai: useAi ? 'pending' : undefined }, ...rs])
        items.push({ id, shot, blob })
      }, () => cancel.current || !alive.current)
      if (useAi) {
        for (const it of items) {
          if (cancel.current || !alive.current) {
            patchResult(it.id, { ai: 'error', error: 'Stopped' })
            continue
          }
          while (running.size >= AI_PARALLEL) await Promise.race(running)
          if (cancel.current || !alive.current) {
            patchResult(it.id, { ai: 'error', error: 'Stopped' })
            continue
          }
          const p = photo(it.id, it.shot, it.blob).finally(() => running.delete(p))
          running.add(p)
          queue.push(p)
        }
        await Promise.all(queue)
      }
    } catch (e) {
      setMsg(String((e as Error).message ?? e))
    }
    if (alive.current) setBusy(false)
  }
  function stop() {
    cancel.current = true
    aborts.current.forEach((a) => a.abort())
  }
  async function retry(r: Result) {
    patchResult(r.id, { ai: 'pending', error: undefined })
    const src = r.src ? await (await fetch(r.src)).blob() : r.blob
    await photo(r.id, r.shot, src)
  }
  async function saveToken() {
    setMsg('')
    try {
      setAi(await aiSetToken(token))
      setToken('')
      setMode('ai')
    } catch (e) {
      setMsg(String((e as Error).message ?? e))
    }
  }

  const fname = (r: Result) => `${slug(plan.name)}-${slug(r.room)}-${slug(r.shot.name)}${r.ai === 'done' ? '-photo' : ''}.jpg`
  async function share(r: Result, t: ShareTarget) {
    setMsg(await shareFile(r.blob, fname(r), t, `${plan.name} — ${r.room}, ${r.shot.name}`))
  }
  const ready = results.filter((r) => r.ai !== 'pending')
  const promptRoom = rooms[0]

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Room renders <button className="ghost" onClick={onClose}>✕</button></h3>
        <div className="seg render-mode">
          <button className={mode === 'ai' ? 'on' : ''} onClick={() => setMode('ai')}>📷 AI photo (realistic)</button>
          <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>🧊 3D preview (free, instant)</button>
        </div>
        {mode === 'ai' && ai && !ai.configured && (
          <div className="ai-setup">
            <p className="small">AI photos are made by <a href="https://replicate.com" target="_blank" rel="noreferrer">Replicate</a> (paid per image). Paste your API token from <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noreferrer">replicate.com/account/api-tokens</a>. It is stored on this server only.</p>
            <div className="chips">
              <input type="password" placeholder="r8_…" value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <button className="primary" disabled={!token.trim()} onClick={saveToken}>Save token</button>
            </div>
          </div>
        )}
        <div className="render-cfg">
          <label>Room
            <select value={roomId} onChange={(e) => { setRoomId(e.target.value); setPicked({}) }}>
              <option value="*">All rooms</option>
              {plan.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.style ? ` · ${STYLE_BY_KEY[r.style]?.label}` : ''}</option>)}
            </select>
          </label>
          <label>Style {roomId === '*' ? '(all rooms)' : ''}
            <select value={roomId === '*' ? '' : rooms[0]?.style ?? ''} onChange={(e) => styleRooms(e.target.value)}>
              <option value="">{roomId === '*' ? 'Keep each room’s style' : 'Choose style…'}</option>
              {ROOM_STYLES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label>Size
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{useAi ? `${v[2].replace(/\s*\d+×\d+|\s*\d+(?= \()/, '')} · AI ${v[3]}×${v[4]}` : v[2]}</option>)}
            </select>
          </label>
          <label>Light
            <select value={lighting} onChange={(e) => set({ lighting: e.target.value as typeof lighting })}>
              <option value="day">Daylight</option><option value="evening">Evening</option><option value="night">Night (lamps)</option>
            </select>
          </label>
          {useAi && (
            <label>AI model
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          )}
        </div>
        {useAi && (
          <div className="ai-extra">
            <label className="small muted">Extra wishes for the photo (optional)
              <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. slatted oak cabinet above the washing machine, rain shower head, plants on the shelf" />
            </label>
            {promptRoom && (
              <details className="small muted">
                <summary>What the AI is told about {promptRoom.name}</summary>
                <p>{roomPrompt(plan, promptRoom, lighting, extra)}</p>
              </details>
            )}
            {ai?.source === 'app' && <button className="ghost small" onClick={async () => setAi(await aiClearToken())}>Remove saved token</button>}
          </div>
        )}
        <div className="shot-list">
          {shots.map((s) => (
            <label key={s.id} className="shot">
              <input type="checkbox" checked={picked[s.id] ?? true} onChange={(e) => setPicked({ ...picked, [s.id]: e.target.checked })} />
              {roomId === '*' && <b>{roomName(s.roomId)}: </b>}{s.name}
            </label>
          ))}
          {!shots.length && <p className="muted small">This plan has no rooms yet. Draw rooms in 2D first.</p>}
        </div>
        <div className="chips" style={{ marginTop: 6 }}>
          <button className="ghost small" onClick={() => setPicked(Object.fromEntries(shots.map((s) => [s.id, true])))}>All views</button>
          <button className="ghost small" onClick={() => setPicked(Object.fromEntries(shots.map((s) => [s.id, false])))}>None</button>
          <span className="small muted">Add your own camera spots with the 👁 Viewpoint tool in 2D.</span>
        </div>
        <div className="chips">
          {!busy && (
            <button className="primary" disabled={!chosen.length || (mode === 'ai' && !ai?.configured)} onClick={go}>
              {useAi ? '📷 Make' : 'Render'} {chosen.length} {useAi ? 'photo' : 'view'}{chosen.length === 1 ? '' : 's'}
            </button>
          )}
          {busy && <button onClick={stop}>Stop</button>}
          {busy && <span className="small muted">{pending ? `AI photos in progress: ${pending} left (about 10–30 s each)…` : `Rendering… ${results.length} done`}</span>}
          {ready.length > 0 && !busy && <button onClick={() => ready.forEach((r, i) => setTimeout(() => download(r.blob, fname(r)), i * 350))}>⬇ Download all ({ready.length})</button>}
          {results.length > 0 && !busy && <button className="ghost" onClick={() => { setResults([]); setOpenId(null) }}>Clear</button>}
        </div>
        {msg && <p className="small">{msg}</p>}
        {open && (
          <div className="render-big">
            <img src={showSrc && open.src ? open.src : open.url} alt={open.shot.name} />
            <div className="chips">
              <b className="small">{open.room} · {open.shot.name}</b>
              {open.src && <button className="ghost" onClick={() => setShowSrc(!showSrc)}>{showSrc ? 'Show AI photo' : 'Show 3D source'}</button>}
              {open.ai === 'error' && <><span className="small" style={{ color: '#c0392b' }}>{open.error}</span><button onClick={() => retry(open)}>Retry AI photo</button></>}
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
            <button key={r.id} className={`render-thumb ${openId === r.id ? 'on' : ''}`} onClick={() => { setOpenId(r.id); setShowSrc(false) }} title={`${r.room} · ${r.shot.name}`}>
              <img src={r.url} alt={r.shot.name} />
              {r.ai === 'pending' && <i className="thumb-badge">AI photo…</i>}
              {r.ai === 'error' && <i className="thumb-badge err">AI failed</i>}
              {r.ai === 'done' && <i className="thumb-badge ok">📷</i>}
              <span>{r.room} · {r.shot.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
