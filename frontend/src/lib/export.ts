import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { panoPoint, planBounds, polygonArea } from './geometry'
import { useStore } from './store'
import { threeRef } from './three-ref'

export function slug(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan'
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

async function toDataUrl(url: string) {
  const blob = await (await fetch(url)).blob()
  return new Promise<string>((res) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.readAsDataURL(blob)
  })
}

/** Standalone SVG of the plan at real-world scale (1 unit = 1 m). */
export async function planSVG(): Promise<string> {
  const src = document.getElementById('plan-svg') as SVGSVGElement | null
  if (!src) throw new Error('Open the 2D view first')
  const plan = useStore.getState().plan
  const svg = src.cloneNode(true) as SVGSVGElement
  svg.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove())
  const g = svg.querySelector(':scope > g') as SVGGElement
  g.removeAttribute('transform')
  for (const img of Array.from(svg.querySelectorAll('image'))) {
    const href = img.getAttribute('href')
    if (href && !href.startsWith('data:')) img.setAttribute('href', await toDataUrl(href))
  }
  const b = planBounds(plan)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  svg.setAttribute('viewBox', `${b.minX} ${b.minY} ${w} ${h + 0.6}`)
  svg.setAttribute('width', `${Math.round(w * 100)}`)
  svg.setAttribute('height', `${Math.round((h + 0.6) * 100)}`)
  svg.removeAttribute('style')
  svg.removeAttribute('id')
  svg.setAttribute('style', 'background:#fbfaf7')
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  title.setAttribute('x', String(b.minX + 0.2))
  title.setAttribute('y', String(b.maxY + 0.4))
  title.setAttribute('font-size', '0.28')
  title.setAttribute('font-family', 'sans-serif')
  title.setAttribute('fill', '#333')
  const total = plan.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0)
  title.textContent = `${plan.name} · ${total.toFixed(1)} m²`
  svg.appendChild(title)
  return new XMLSerializer().serializeToString(svg)
}

export async function planPNG(pxPerMetre = 150): Promise<Blob> {
  const svgText = await planSVG()
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const el = doc.documentElement
  const vb = el.getAttribute('viewBox')!.split(' ').map(Number)
  const W = Math.round(vb[2] * pxPerMetre)
  const H = Math.round(vb[3] * pxPerMetre)
  el.setAttribute('width', String(W))
  el.setAttribute('height', String(H))
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(el)], { type: 'image/svg+xml' }))
  const img = new Image()
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
    img.src = url
  })
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#fbfaf7'
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(img, 0, 0, W, H)
  URL.revokeObjectURL(url)
  return canvasBlob(cv, 'image/png')
}

function canvasBlob(cv: HTMLCanvasElement, type: string, q = 0.92) {
  return new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Export failed'))), type, q))
}

function need3D() {
  const { gl, scene, camera } = threeRef
  if (!gl || !scene || !camera || !gl.domElement.isConnected) throw new Error('Open the 3D view first')
  return { gl, scene, camera }
}

/** High-resolution render of the current 3D camera. */
export async function render3D(mult = 2): Promise<Blob> {
  const { gl, scene, camera } = need3D()
  const old = gl.getPixelRatio()
  gl.setPixelRatio(Math.min(4, old * mult))
  gl.render(scene, camera)
  const blob = await canvasBlob(gl.domElement, 'image/png')
  gl.setPixelRatio(old)
  gl.render(scene, camera)
  return blob
}

/** Equirectangular 360° panorama (2:1 JPG) from the current camera position. */
export async function render360(width = 4096): Promise<Blob> {
  const { gl, scene, camera } = need3D()
  const size = width / 4
  const cubeRT = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: false })
  const cubeCam = new THREE.CubeCamera(0.05, 1000, cubeRT)
  const st = useStore.getState()
  if (st.mode3d === 'orbit') {
    const p = panoPoint(st.plan, st.activeViewpoint)
    cubeCam.position.set(p.x, p.z, p.y)
  } else cubeCam.position.copy(camera.position)
  const hidden: THREE.Object3D[] = []
  scene.traverse((o) => { if (o.name === 'ceiling' && !o.visible) { o.visible = true; hidden.push(o) } })
  scene.updateMatrixWorld()
  cubeCam.update(gl, scene)
  hidden.forEach((o) => (o.visible = false))

  const H = width / 2
  const rt = new THREE.WebGLRenderTarget(width, H, { colorSpace: THREE.SRGBColorSpace })
  const mat = new THREE.ShaderMaterial({
    uniforms: { env: { value: cubeRT.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform samplerCube env; varying vec2 vUv;
      void main(){
        float lon = (vUv.x - 0.5) * 6.28318530718;
        float lat = (vUv.y - 0.5) * 3.14159265359;
        vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
        gl_FragColor = textureCube(env, vec3(-dir.x, dir.y, dir.z));
        #include <colorspace_fragment>
      }`,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  const s = new THREE.Scene()
  s.add(quad)
  const oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const prevRT = gl.getRenderTarget()
  gl.setRenderTarget(rt)
  gl.render(s, oc)
  const px = new Uint8Array(width * H * 4)
  gl.readRenderTargetPixels(rt, 0, 0, width, H, px)
  gl.setRenderTarget(prevRT)
  const cv = document.createElement('canvas')
  cv.width = width
  cv.height = H
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(width, H)
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * width * 4, (H - y) * width * 4), y * width * 4)
  ctx.putImageData(img, 0, 0)
  cubeRT.dispose()
  rt.dispose()
  mat.dispose()
  return canvasBlob(cv, 'image/jpeg', 0.9)
}

export async function exportGLB(): Promise<Blob> {
  const { scene } = need3D()
  const exporter = new GLTFExporter()
  const root = new THREE.Group()
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && o.visible && !mesh.geometry.type.startsWith('Plane') && !(mesh.material as THREE.ShaderMaterial).isShaderMaterial) {
      const m = o as THREE.Mesh
      const c = new THREE.Mesh(m.geometry, m.material)
      m.updateWorldMatrix(true, false)
      c.applyMatrix4(m.matrixWorld)
      root.add(c)
    }
  })
  const res = await exporter.parseAsync(root, { binary: true })
  return new Blob([res as ArrayBuffer], { type: 'model/gltf-binary' })
}

export function planJSON(): Blob {
  return new Blob([JSON.stringify(useStore.getState().plan, null, 2)], { type: 'application/json' })
}

export async function exportPDF(): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const plan = useStore.getState().plan
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pw = 297, ph = 210
  const addImage = async (blob: Blob, title: string) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise((r) => ((img.onload = r), (img.src = url)))
    const k = Math.min((pw - 20) / img.width, (ph - 30) / img.height)
    pdf.setFontSize(14)
    pdf.text(title, 10, 12)
    pdf.addImage(img, blob.type === 'image/png' ? 'PNG' : 'JPEG', (pw - img.width * k) / 2, 18, img.width * k, img.height * k)
    URL.revokeObjectURL(url)
  }
  let first = true
  try {
    await addImage(await planPNG(120), `${plan.name} — floor plan`)
    first = false
  } catch { /* 2D not mounted */ }
  try {
    const r = await render3D(2)
    if (!first) pdf.addPage()
    await addImage(r, `${plan.name} — 3D view`)
    first = false
  } catch { /* 3D not mounted */ }
  if (!first) pdf.addPage()
  pdf.setFontSize(14)
  pdf.text(`${plan.name} — rooms`, 10, 12)
  pdf.setFontSize(10)
  let y = 22
  let total = 0
  for (const r of plan.rooms) {
    const a = polygonArea(r.polygon)
    total += a
    pdf.text(`${r.name}`, 12, y)
    pdf.text(`${a.toFixed(2)} m²`, 90, y)
    pdf.text(`${r.floor ?? plan.settings.defaultFloor}`, 120, y)
    y += 6
  }
  pdf.setFont('helvetica', 'bold')
  pdf.text(`Total`, 12, y + 2)
  pdf.text(`${total.toFixed(2)} m²`, 90, y + 2)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Electrical points: ${plan.electrical.length}   Plumbing points: ${plan.plumbing.length}   Ceiling height: ${plan.settings.wallHeight} m`, 12, y + 12)
  return pdf.output('blob')
}

// ---------- sharing ----------
export type ShareTarget = 'native' | 'telegram' | 'whatsapp' | 'instagram'

export async function copyImage(blob: Blob) {
  let png = blob
  if (blob.type !== 'image/png') {
    const bmp = await createImageBitmap(blob)
    const cv = document.createElement('canvas')
    cv.width = bmp.width
    cv.height = bmp.height
    cv.getContext('2d')!.drawImage(bmp, 0, 0)
    png = await canvasBlob(cv, 'image/png')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

/**
 * Share a file. Uses the OS share sheet when available (mobile: Telegram, WhatsApp, Instagram…).
 * On desktop, downloads the file, copies images to the clipboard and opens the messenger so the user can paste.
 */
export async function shareFile(blob: Blob, filename: string, target: ShareTarget, text: string): Promise<string> {
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (window.isSecureContext && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text })
      return 'Shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'Share cancelled'
    }
  }
  download(blob, filename)
  let copied = false
  if (blob.type.startsWith('image/') && window.isSecureContext && 'ClipboardItem' in window) {
    try {
      await copyImage(blob)
      copied = true
    } catch { /* clipboard not permitted */ }
  }
  const msg = encodeURIComponent(text)
  if (target === 'telegram') window.open(`https://t.me/share/url?url=${encodeURIComponent(location.origin)}&text=${msg}`, '_blank')
  if (target === 'whatsapp') window.open(`https://wa.me/?text=${msg}`, '_blank')
  if (target === 'instagram') window.open('https://www.instagram.com/direct/inbox/', '_blank')
  return copied
    ? `Downloaded ${filename} and copied the image — paste it (Ctrl/Cmd+V) into the chat`
    : `Downloaded ${filename} — attach it in the chat`
}
