import { useEffect, useState } from 'react'
import { download, exportGLB, exportPDF, planJSON, planPNG, planSVG, render360, render3D, shareFile, slug, type ShareTarget } from '../lib/export'
import { useStore } from '../lib/store'

type Kind = 'plan-png' | 'plan-svg' | 'render' | 'pano' | 'pdf' | 'glb' | 'json'
const ITEMS: { k: Kind; title: string; desc: string; ext: string; needs?: '2d' | '3d' }[] = [
  { k: 'plan-png', title: '2D plan image', desc: 'PNG with visible layers', ext: 'png', needs: '2d' },
  { k: 'plan-svg', title: '2D plan SVG', desc: 'Vector, real scale (1 unit = 1 m)', ext: 'svg', needs: '2d' },
  { k: 'render', title: '3D render', desc: 'High-res PNG of the current 3D camera', ext: 'png', needs: '3d' },
  { k: 'pano', title: '360° panorama', desc: 'Equirectangular JPG from the camera position', ext: 'jpg', needs: '3d' },
  { k: 'pdf', title: 'PDF presentation', desc: 'Plan + 3D view + room schedule', ext: 'pdf' },
  { k: 'glb', title: '3D model', desc: 'GLB for any 3D viewer / AR', ext: 'glb', needs: '3d' },
  { k: 'json', title: 'Plan data', desc: 'JSON (re-importable)', ext: 'json' },
]

async function make(k: Kind): Promise<Blob> {
  switch (k) {
    case 'plan-png': return planPNG(150)
    case 'plan-svg': return new Blob([await planSVG()], { type: 'image/svg+xml' })
    case 'render': return render3D(2)
    case 'pano': return render360(4096)
    case 'pdf': return exportPDF()
    case 'glb': return exportGLB()
    case 'json': return planJSON()
  }
}

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const name = useStore((s) => s.plan.name)
  const viewMode = useStore((s) => s.viewMode)
  const [busy, setBusy] = useState<Kind | null>(null)
  const [ready, setReady] = useState<{ k: Kind; blob: Blob; url: string; filename: string } | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => () => { if (ready) URL.revokeObjectURL(ready.url) }, [ready])

  const available = (n?: '2d' | '3d') => !n || viewMode === 'split' || viewMode === n

  async function go(k: Kind) {
    setBusy(k)
    setMsg('')
    try {
      const blob = await make(k)
      const ext = ITEMS.find((i) => i.k === k)!.ext
      const filename = `${slug(name)}-${k}.${ext}`
      setReady({ k, blob, url: URL.createObjectURL(blob), filename })
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function share(t: ShareTarget) {
    if (!ready) return
    setMsg(await shareFile(ready.blob, ready.filename, t, `${name} — apartment plan`))
  }

  const isImg = ready && ready.blob.type.startsWith('image/')
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Download & share <button className="ghost" onClick={onClose}>✕</button></h3>
        <div className="cards">
          {ITEMS.map((i) => (
            <div key={i.k} className="card">
              <b>{i.title}</b>
              <span className="small muted">{i.desc}</span>
              <button className={ready?.k === i.k ? 'active' : ''} disabled={!!busy || !available(i.needs)} onClick={() => go(i.k)} title={available(i.needs) ? '' : `Switch to ${i.needs?.toUpperCase()} or split view first`}>
                {busy === i.k ? 'Rendering…' : available(i.needs) ? 'Create' : `Needs ${i.needs?.toUpperCase()} view`}
              </button>
            </div>
          ))}
        </div>
        {ready && (
          <div style={{ marginTop: 14 }}>
            {isImg && <img src={ready.url} className="preview-img" alt="preview" />}
            <div className="chips" style={{ justifyContent: 'center' }}>
              <button className="primary" onClick={() => download(ready.blob, ready.filename)}>⬇ Download {ready.filename}</button>
              <button onClick={() => share('native')}>Share…</button>
              <button onClick={() => share('telegram')} style={{ color: '#229ED9' }}>Telegram</button>
              <button onClick={() => share('whatsapp')} style={{ color: '#25D366' }}>WhatsApp</button>
              <button onClick={() => share('instagram')} style={{ color: '#C13584' }}>Instagram</button>
            </div>
            <p className="small muted" style={{ textAlign: 'center' }}>
              On phones, "Share…" opens the system sheet with Telegram, WhatsApp and Instagram. On a computer the file is downloaded and images are copied to the clipboard, so you can paste them into the chat.
            </p>
          </div>
        )}
        {msg && <p style={{ textAlign: 'center' }}>{msg}</p>}
      </div>
    </div>
  )
}
