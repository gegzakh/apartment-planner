import { ELECTRICAL, FURNITURE, PLUMBING, RUN_STYLE } from '../lib/catalog'
import { useStore } from '../lib/store'
import type { PipeKind, Tool } from '../lib/types'

const TOOLS: { t: Tool; ic: string; label: string; hint: string }[] = [
  { t: 'select', ic: '↖', label: 'Select', hint: 'Click to select, drag to move (V)' },
  { t: 'pan', ic: '✋', label: 'Pan', hint: 'Drag to pan; or hold Space / right-drag' },
  { t: 'wall', ic: '▭', label: 'Wall', hint: 'Click points to draw walls, Esc to finish (W)' },
  { t: 'door', ic: '🚪', label: 'Door', hint: 'Click on a wall to add a door (D)' },
  { t: 'window', ic: '⊞', label: 'Window', hint: 'Click on a wall to add a window' },
  { t: 'opening', ic: '⊓', label: 'Opening', hint: 'Click on a wall to add an open passage' },
  { t: 'room', ic: '⬠', label: 'Room', hint: 'Click corners, double-click or click first point to close (R)' },
  { t: 'measure', ic: '📏', label: 'Measure', hint: 'Click two points to measure (M)' },
  { t: 'calibrate', ic: '⇔', label: 'Scale', hint: 'Click two points of known distance and enter real length' },
  { t: 'viewpoint', ic: '◉', label: '360° point', hint: 'Click to place a 360° viewpoint' },
]

export default function LeftPanel() {
  const tool = useStore((s) => s.tool)
  const toolArg = useStore((s) => s.toolArg)
  const setTool = useStore((s) => s.setTool)
  const snapStep = useStore((s) => s.snapStep)
  const set = useStore((s) => s.set)
  const cats = [...new Set(FURNITURE.map((f) => f.category))]
  const hint = TOOLS.find((x) => x.t === tool)?.hint ?? (tool === 'run' ? 'Click points of the line, double-click / Enter to finish' : 'Click on the plan to place')
  return (
    <aside className="side left">
      <div className="section">
        <h4>Tools</h4>
        <div className="tools">
          {TOOLS.map((x) => (
            <button key={x.t} title={x.hint} className={tool === x.t ? 'active' : ''} onClick={() => setTool(x.t, x.t === 'wall' ? '0.12' : '')}>
              <span className="ic">{x.ic}</span>
              {x.label}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>{hint}</p>
        {tool === 'wall' && (
          <div className="row" style={{ marginTop: 6 }}>
            <span>Thickness</span>
            <select value={toolArg} onChange={(e) => setTool('wall', e.target.value)}>
              {['0.08', '0.10', '0.12', '0.20', '0.25', '0.38'].map((v) => <option key={v} value={v}>{Math.round(+v * 100)} cm</option>)}
            </select>
          </div>
        )}
        <div className="row" style={{ marginTop: 6 }}>
          <span>Snap</span>
          <select value={snapStep} onChange={(e) => set({ snapStep: +e.target.value })}>
            <option value={0}>Off</option>
            <option value={0.01}>1 cm</option>
            <option value={0.05}>5 cm</option>
            <option value={0.1}>10 cm</option>
            <option value={0.25}>25 cm</option>
          </select>
        </div>
      </div>
      <div className="section">
        <h4>Electrical</h4>
        <div className="palette">
          {ELECTRICAL.map((f) => (
            <button key={f.type} title={`${f.label} · ${f.z < 0 ? 'ceiling' : `${f.z} m`}`} className={tool === 'electrical' && toolArg === f.type ? 'active' : ''} onClick={() => setTool('electrical', f.type)}>
              <span className="dot" style={{ background: f.color }} />{f.label}
            </button>
          ))}
          <button className={tool === 'run' && toolArg === 'wire' ? 'active' : ''} onClick={() => setTool('run', 'wire')}>
            <span className="dot" style={{ background: RUN_STYLE.wire.color }} />Wire run
          </button>
        </div>
      </div>
      <div className="section">
        <h4>Water & heating</h4>
        <div className="palette">
          {PLUMBING.map((f) => (
            <button key={f.type} title={f.label} className={tool === 'plumbing' && toolArg === f.type ? 'active' : ''} onClick={() => setTool('plumbing', f.type)}>
              <span className="dot" style={{ background: f.color }} />{f.label}
            </button>
          ))}
          {(['cold', 'hot', 'drain', 'gas'] as PipeKind[]).map((k) => (
            <button key={k} className={tool === 'run' && toolArg === k ? 'active' : ''} onClick={() => setTool('run', k)}>
              <span className="dot" style={{ background: RUN_STYLE[k].color }} />{RUN_STYLE[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="section">
        <h4>Furniture</h4>
        {cats.map((c) => (
          <div key={c}>
            <div className="cat-title">{c}</div>
            <div className="palette">
              {FURNITURE.filter((f) => f.category === c).map((f) => (
                <button key={f.type} title={`${f.label} ${f.w}×${f.d} m`} className={tool === 'furniture' && toolArg === f.type ? 'active' : ''} onClick={() => setTool('furniture', f.type)}>
                  <span className="dot" style={{ background: f.color }} />{f.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
