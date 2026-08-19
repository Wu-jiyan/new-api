interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  decay: number
  color: string
  size: number
  gravity: number
}

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let particles: Particle[] = []
let raf = 0

function ensureCanvas() {
  if (canvas) return
  canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999'
  document.body.appendChild(canvas)
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  ctx = canvas.getContext('2d')
}

function loop() {
  if (!ctx || !canvas) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  particles = particles.filter((p) => p.life > 0)
  for (const p of particles) {
    p.x += p.vx
    p.y += p.vy
    p.vy += p.gravity
    p.vx *= 0.99
    p.life -= p.decay
    ctx.globalAlpha = Math.max(0, p.life)
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  if (particles.length === 0) {
    cancelAnimationFrame(raf)
    raf = 0
    canvas.remove()
    canvas = null
    ctx = null
  } else {
    raf = requestAnimationFrame(loop)
  }
}

export function burst(x: number, y: number, colors: string[], count = 40, power = 7) {
  ensureCanvas()
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = (Math.random() * 0.8 + 0.2) * power
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - power * 0.3,
      life: 1,
      decay: 0.015 + Math.random() * 0.02,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 2 + Math.random() * 3,
      gravity: 0.18,
    })
  }
  if (!raf) raf = requestAnimationFrame(loop)
}

export function burstAtCenter(colors: string[], count = 60, power = 9) {
  burst(window.innerWidth / 2, window.innerHeight / 2, colors, count, power)
}

// rain 全屏粒子雨（自上而下，适合稀有卡高潮）。durationMs 后自动停止。
export function rain(colors: string[], durationMs = 1800, count = 90) {
  ensureCanvas()
  const start = Date.now()
  const interval = window.setInterval(() => {
    if (!ctx || !canvas || Date.now() - start > durationMs) {
      window.clearInterval(interval)
      return
    }
    for (let i = 0; i < count / 10; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: -10 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 2.5 + Math.random() * 3.5,
        life: 1,
        decay: 0.006 + Math.random() * 0.008,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 1.5 + Math.random() * 3,
        gravity: 0.06,
      })
    }
    if (!raf) raf = requestAnimationFrame(loop)
  }, 60)
}
