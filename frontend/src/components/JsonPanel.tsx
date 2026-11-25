import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import type { EntityKind, Plan } from '../lib/types'

const KIND: Record<string, EntityKind> = {
  walls: 'wall', openings: 'opening', rooms: 'room', furniture: 'furniture', electrical: 'electrical',
  plumbing: 'plumbing', runs: 'run', viewpoints: 'viewpoint', overlays: 'overlay',
}
const LINE_H = 17
const PAD = 8
const LISTS = ['openings', 'rooms', 'furniture', 'electrical', 'plumbing', 'runs', 'overlays', 'viewpoints'] as const

interface Span { kind: EntityKind; id: string; start: number; end: number }

/** Line ranges of every entity in 2-space pretty-printed plan JSON. */
function index(text: string): Span[] {
  const out: Span[] = []
  let sec: string | null = null
  let start = -1
  let id = ''
  text.split('\n').forEach((l, i) => {
    const s = /^ {2}"(\w+)":/.exec(l)
    if (s) {
      sec = KIND[s[1]] ? s[1] : null
      return
    }
    if (!sec) return
    if (/^ {4}\{/.test(l)) {
      start = i
      id = ''
    } else if (start >= 0 && !id) {
      id = /^ {6}"id": "([^"]+)"/.exec(l)?.[1] ?? ''
    }
    if (start >= 0 && /^ {4}\}/.test(l)) {
      if (id) out.push({ kind: KIND[sec], id, start, end: i })
      start = -1
    }
  })
  return out
}

function parse(text: string): Plan {
  const p = JSON.parse(text) as Plan
  if (!Array.isArray(p.walls) || !p.settings) throw new Error('Not a plan: "walls" and "settings" are required')
  for (const k of LISTS) p[k] ??= [] as never
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const pt = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(num)
  const need = (list: unknown[], name: string, ok: (o: Record<string, unknown>) => boolean, what: string) =>
    list.forEach((o, i) => {
      if (!o || typeof o !== 'object' || !ok(o as Record<string, unknown>)) throw new Error(`${name}[${i}] needs ${what}`)
    })
  need(p.walls, 'walls', (o) => pt(o.a) && pt(o.b) && num(o.thickness), '"a" and "b" points and a "thickness"')
  need(p.openings, 'openings', (o) => typeof o.wallId === 'string' && num(o.offset) && num(o.width), '"wallId", "offset" and "width"')
  need(p.rooms, 'rooms', (o) => Array.isArray(o.polygon) && o.polygon.every(pt), 'a "polygon" of [x, y] points')
  need(p.furniture, 'furniture', (o) => num(o.x) && num(o.y) && num(o.width) && num(o.depth), '"x", "y", "width" and "depth"')
  need([...p.electrical, ...p.plumbing], 'fixtures', (o) => num(o.x) && num(o.y), '"x" and "y"')
  need(p.runs, 'runs', (o) => Array.isArray(o.points) && o.points.every(pt), '"points" of [x, y]')
  need(p.viewpoints, 'viewpoints', (o) => num(o.x) && num(o.y), '"x" and "y"')
  return p
}

export default function JsonPanel({ onClose }: { onClose: () => void }) {
  const plan = useStore((s) => s.plan)
  const sel = useStore((s) => s.selection)
  const canonical = useMemo(() => JSON.stringify(plan, null, 2), [plan])
  const [text, setText] = useState(canonical)
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState('')
  const [scroll, setScroll] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!dirty) setText(canonical)
  }, [canonical, dirty])

  const spans = useMemo(() => index(text), [text])
  const hit = sel ? spans.find((s) => s.id === sel.id) : undefined

  // bring the selected object into view
  useEffect(() => {
    const el = ta.current
    if (!hit || !el) return
    const top = PAD + hit.start * LINE_H
    const bottom = PAD + (hit.end + 1) * LINE_H
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, bottom - top > el.clientHeight ? top - PAD : top - (el.clientHeight - (bottom - top)) / 3)
      setScroll(el.scrollTop)
    }
  }, [hit?.id, hit?.start]) // eslint-disable-line react-hooks/exhaustive-deps

  function apply(): boolean {
    try {
      const p = parse(text)
      setErr('')
      if (JSON.stringify(p, null, 2) !== JSON.stringify(useStore.getState().plan, null, 2)) {
        useStore.getState().update((d) => void Object.assign(d, p), { coalesce: 'json-edit' })
      }
      return true
    } catch (e) {
      setErr((e as Error).message)
      return false
    }
  }

  // apply valid edits live
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(apply, 500)
    return () => clearTimeout(t)
  }, [text, dirty]) // eslint-disable-line react-hooks/exhaustive-deps

  // caret inside an object selects it on the plan
  function pickAtCaret() {
    const el = ta.current
    if (!el) return
    const line = text.slice(0, el.selectionStart).split('\n').length - 1
    const s = spans.find((x) => x.start <= line && line <= x.end)
    if (s && s.id !== sel?.id) useStore.getState().select({ kind: s.kind, id: s.id })
  }

  function loadFile() {
    const i = document.createElement('input')
    i.type = 'file'
    i.accept = '.json'
    i.onchange = async () => {
      const f = i.files?.[0]
      if (!f) return
      try {
        useStore.getState().setPlan(parse(await f.text()))
        setDirty(false)
        setErr('')
      } catch (e) {
        setErr((e as Error).message)
      }
    }
    i.click()
  }

  return (
    <aside className="side json-side">
      <div className="json-head">
        <b>Plan JSON</b>
        <span className="spacer" />
        <button className="ghost" onClick={loadFile} title="Replace the plan with a JSON file">Load…</button>
        <button className="ghost" onClick={onClose} title="Close">✕</button>
      </div>
      <p className="small muted json-help">
        Select an object on the plan to jump to it here; click inside an object here to select it on the plan. Edits apply as you type (undo with Ctrl+Z). Coordinates are in metres.
      </p>
      <div className="json-wrap">
        {hit && <div className="json-hl" style={{ top: PAD + hit.start * LINE_H - scroll, height: (hit.end - hit.start + 1) * LINE_H }} />}
        <textarea
          ref={ta}
          className="json-edit"
          value={text}
          spellCheck={false}
          wrap="off"
          onChange={(e) => { setText(e.target.value); setDirty(true) }}
          onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
          onKeyDown={(e) => {
            const k = e.key.toLowerCase()
            if (dirty || !(e.ctrlKey || e.metaKey) || (k !== 'z' && k !== 'y')) return
            e.preventDefault()  // nothing typed here yet: undo/redo the plan itself
            const st = useStore.getState()
            if (k === 'y' || e.shiftKey) st.redo()
            else st.undo()
          }}
          onClick={pickAtCaret}
          onKeyUp={(e) => e.key.startsWith('Arrow') || e.key === 'PageUp' || e.key === 'PageDown' ? pickAtCaret() : undefined}
          onBlur={() => { if (dirty && apply()) setDirty(false) }}
        />
      </div>
      {err && (
        <div className="json-err small">
          {err} <button className="ghost" onClick={() => { setDirty(false); setErr('') }}>Revert</button>
        </div>
      )}
    </aside>
  )
}
