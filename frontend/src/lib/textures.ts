import * as THREE from 'three'

const cache = new Map<string, THREE.Texture>()

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex)
  c.offsetHSL(0, 0, f)
  return `#${c.getHexString()}`
}

/** Procedural floor texture; UVs are in metres, so `size` is the tile size in metres. */
export function floorTexture(pattern: string, color: string): THREE.Texture {
  const key = `${pattern}|${color}`
  const hit = cache.get(key)
  if (hit) return hit
  const S = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const g = cv.getContext('2d')!
  g.fillStyle = color
  g.fillRect(0, 0, S, S)
  let size = 1
  const rnd = mulberry(pattern.length * 7919 + color.length)
  if (pattern === 'wood') {
    size = 1.2
    const rows = 7
    const h = S / rows
    for (let r = 0; r < rows; r++) {
      const off = rnd() * S
      for (let x = -S; x < S * 2; x += S / 1.5) {
        g.fillStyle = shade(color, (rnd() - 0.5) * 0.08)
        g.fillRect(x + off, r * h, S / 1.5 - 2, h - 2)
        g.strokeStyle = shade(color, -0.06)
        g.globalAlpha = 0.25
        for (let k = 0; k < 6; k++) {
          g.beginPath()
          const yy = r * h + rnd() * h
          g.moveTo(x + off, yy)
          g.bezierCurveTo(x + off + 80, yy + 4, x + off + 160, yy - 4, x + off + S / 1.5, yy + 2)
          g.stroke()
        }
        g.globalAlpha = 1
      }
    }
  } else if (pattern === 'herringbone') {
    size = 0.6
    const w = S / 8
    for (let y = -S; y < S * 2; y += w) {
      for (let x = -S; x < S * 2; x += w * 4) {
        g.save()
        g.translate(x + ((y / w) % 2) * w * 2, y)
        g.rotate(Math.PI / 4)
        g.fillStyle = shade(color, (rnd() - 0.5) * 0.1)
        g.fillRect(0, 0, w * 3, w - 2)
        g.rotate(Math.PI / 2)
        g.fillStyle = shade(color, (rnd() - 0.5) * 0.1)
        g.fillRect(0, 0, w * 3, w - 2)
        g.restore()
      }
    }
  } else if (pattern === 'tile') {
    size = 0.6
    g.fillStyle = shade(color, (rnd() - 0.5) * 0.03)
    g.fillRect(3, 3, S - 6, S - 6)
    g.strokeStyle = shade(color, -0.18)
    g.lineWidth = 6
    g.strokeRect(0, 0, S, S)
  } else if (pattern === 'stone') {
    size = 1.2
    g.strokeStyle = shade(color, -0.12)
    g.globalAlpha = 0.35
    for (let i = 0; i < 18; i++) {
      g.lineWidth = rnd() * 2
      g.beginPath()
      let x = rnd() * S
      let y = rnd() * S
      g.moveTo(x, y)
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.3) * 80
        y += (rnd() - 0.5) * 60
        g.lineTo(x, y)
      }
      g.stroke()
    }
    g.globalAlpha = 1
    g.strokeStyle = shade(color, -0.1)
    g.lineWidth = 3
    g.strokeRect(0, 0, S, S)
  } else {
    size = 1
    const img = g.getImageData(0, 0, S, S)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 14
      img.data[i] += n
      img.data[i + 1] += n
      img.data[i + 2] += n
    }
    g.putImageData(img, 0, 0)
  }
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / size, 1 / size)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  cache.set(key, t)
  return t
}

function mulberry(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
