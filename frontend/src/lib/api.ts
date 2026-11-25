import type { Furniture, Opening, Overlay, Plan, Room, Wall } from './types'

export interface ImportResult {
  overlayUrl: string
  kind: Overlay['kind']
  detected: boolean
  scale?: number
  warning?: string
  overlay: { x: number; y: number; width: number; height: number }
  walls?: Wall[]
  openings?: Opening[]
  rooms?: Room[]
  furniture?: Furniture[]
  stats?: Record<string, number>
}

async function check(r: Response) {
  if (!r.ok) {
    let msg = r.statusText
    try {
      msg = (await r.json()).detail ?? msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return r
}

export async function importFile(file: File, kind: Overlay['kind'], scale?: number, width?: number): Promise<ImportResult> {
  const fd = new FormData()
  fd.append('file', file)
  const q = new URLSearchParams({ kind })
  if (scale) q.set('scale', String(scale))
  if (width) q.set('width', String(width))
  const r = await check(await fetch(`/api/import?${q}`, { method: 'POST', body: fd }))
  return r.json()
}

export interface ProjectDoc {
  name: string
  plan: Plan
  versions?: { id: string; name: string; createdAt: number; plan: Plan }[]
}

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  return (await check(await fetch('/api/projects'))).json()
}
export async function loadProject(id: string): Promise<ProjectDoc> {
  return (await check(await fetch(`/api/projects/${id}`))).json()
}
export async function saveProject(id: string, doc: ProjectDoc) {
  return (await check(await fetch(`/api/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) }))).json()
}
export async function deleteProject(id: string) {
  await check(await fetch(`/api/projects/${id}`, { method: 'DELETE' }))
}

export interface AiStatus { configured: boolean; source: 'env' | 'app' | null; models: string[] }
export async function aiStatus(): Promise<AiStatus> {
  return (await check(await fetch('/api/ai/status'))).json()
}
export async function aiSetToken(token: string): Promise<AiStatus> {
  return (await check(await fetch('/api/ai/token', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }))).json()
}
export async function aiClearToken(): Promise<AiStatus> {
  return (await check(await fetch('/api/ai/token', { method: 'DELETE' }))).json()
}
export async function aiRender(shot: Blob, prompt: string, model: string, signal?: AbortSignal): Promise<string> {
  const fd = new FormData()
  fd.append('image', shot, 'shot.jpg')
  fd.append('prompt', prompt)
  fd.append('model', model)
  return (await (await check(await fetch('/api/ai/render', { method: 'POST', body: fd, signal }))).json()).url
}

export interface DevinJobItem {
  index: number
  name: string
  room: string
  result: string | null
  error?: string | null
}
export interface DevinJob {
  id: string
  created: number
  notified: boolean
  notifyError?: string | null
  items: DevinJobItem[]
}

export interface DevinStatus {
  configured: boolean
  enabled: boolean
  keySource: 'env' | 'app' | null
  session: boolean
}
export async function devinStatus(): Promise<DevinStatus> {
  return (await check(await fetch('/api/devin/status'))).json()
}
export async function devinSettings(body: { key?: string; enabled?: boolean }): Promise<DevinStatus> {
  return (await check(await fetch('/api/devin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))).json()
}
export async function devinClearKey(): Promise<DevinStatus> {
  return (await check(await fetch('/api/devin/key', { method: 'DELETE' }))).json()
}

export async function devinCreateJob(items: { blob: Blob; name: string; room: string; prompt: string }[]): Promise<DevinJob> {
  const fd = new FormData()
  items.forEach((it, i) => fd.append('images', it.blob, `shot-${i}.jpg`))
  fd.append('meta', JSON.stringify(items.map(({ name, room, prompt }) => ({ name, room, prompt }))))
  return (await check(await fetch('/api/devin/jobs', { method: 'POST', body: fd }))).json()
}

export async function devinJob(id: string): Promise<DevinJob> {
  return (await check(await fetch(`/api/devin/jobs/${id}`))).json()
}
