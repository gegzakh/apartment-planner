import * as THREE from 'three'

const cache = new Map<string, THREE.Texture>()

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex)
  c.offsetHSL(0, 0, f)
  return `#${c.getHexString()}`
}

/** Procedural texture; UVs are in metres, `userData.size` is the pattern repeat in metres. */
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
  } else if (pattern === 'brick' || pattern === 'subway') {
    const brick = pattern === 'brick'
    size = brick ? 0.5 : 0.3
    const rows = brick ? 8 : 6
    const h = S / rows
    g.fillStyle = brick ? shade(color, 0.25) : shade(color, -0.12)
    g.fillRect(0, 0, S, S)
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (S / 4)
      for (let x = -S / 2; x < S; x += S / 2) {
        g.fillStyle = shade(color, (rnd() - 0.5) * (brick ? 0.12 : 0.03))
        g.fillRect(x + off + 3, r * h + 3, S / 2 - 6, h - 6)
      }
    }
  } else if (pattern === 'hex') {
    size = 0.4
    const R = S / 6
    g.strokeStyle = shade(color, -0.2)
    g.lineWidth = 4
    for (let row = -1; row < 5; row++)
      for (let col = -1; col < 5; col++) {
        const x = col * R * 1.5
        const y = row * R * Math.sqrt(3) + (col % 2 ? (R * Math.sqrt(3)) / 2 : 0)
        g.beginPath()
        for (let k = 0; k < 6; k++) g.lineTo(x + R * Math.cos((k * Math.PI) / 3), y + R * Math.sin((k * Math.PI) / 3))
        g.closePath()
        g.fillStyle = shade(color, (rnd() - 0.5) * 0.05)
        g.fill()
        g.stroke()
      }
  } else if (pattern === 'fabric') {
    size = 0.15
    for (let y = 0; y < S; y += 4)
      for (let x = 0; x < S; x += 4) {
        g.fillStyle = shade(color, ((x + y) % 8 ? -0.03 : 0.03) + (rnd() - 0.5) * 0.04)
        g.fillRect(x, y, 4, 4)
      }
  } else if (pattern === 'brushed') {
    size = 0.5
    g.globalAlpha = 0.25
    for (let y = 0; y < S; y++) {
      g.fillStyle = shade(color, (rnd() - 0.5) * 0.12)
      g.fillRect(0, y, S, 1)
    }
    g.globalAlpha = 1
  } else if (pattern === 'stripes') {
    size = 0.5
    for (let x = 0; x < S; x += S / 8) {
      g.fillStyle = shade(color, -0.06)
      g.fillRect(x, 0, S / 16, S)
    }
  } else if (pattern === 'damask') {
    size = 0.5
    g.fillStyle = shade(color, -0.08)
    for (let y = 0; y < S; y += S / 4)
      for (let x = 0; x < S; x += S / 4) {
        const ox = (y / (S / 4)) % 2 ? S / 8 : 0
        g.beginPath()
        g.ellipse(x + ox + S / 8, y + S / 8, S / 22, S / 12, 0, 0, Math.PI * 2)
        g.fill()
      }
  } else if (pattern === 'terrazzo') {
    size = 0.6
    for (let i = 0; i < 260; i++) {
      g.fillStyle = shade(color, (rnd() - 0.5) * 0.5)
      g.beginPath()
      g.ellipse(rnd() * S, rnd() * S, 2 + rnd() * 9, 2 + rnd() * 6, rnd() * 3, 0, Math.PI * 2)
      g.fill()
    }
  } else if (pattern === 'panel') {
    size = 0.8
    const n = 6
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade(color, (rnd() - 0.5) * 0.08)
      g.fillRect((i * S) / n + 4, 0, S / n - 8, S)
    }
  } else if (pattern === 'plaster' || pattern === 'concrete' || pattern === 'leather') {
    size = pattern === 'leather' ? 0.3 : 1.5
    const amp = pattern === 'plaster' ? 10 : pattern === 'leather' ? 18 : 22
    const img = g.getImageData(0, 0, S, S)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * amp
      img.data[i] += n
      img.data[i + 1] += n
      img.data[i + 2] += n
    }
    g.putImageData(img, 0, 0)
    if (pattern !== 'leather') {
      g.globalAlpha = 0.08
      for (let i = 0; i < 40; i++) {
        g.fillStyle = shade(color, (rnd() - 0.5) * 0.3)
        g.beginPath()
        g.arc(rnd() * S, rnd() * S, 20 + rnd() * 60, 0, Math.PI * 2)
        g.fill()
      }
      g.globalAlpha = 1
    }
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
  t.userData.size = size
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
