let ctx: AudioContext | null = null
let muted = false

try {
  muted = localStorage.getItem('gacha_muted') === '1'
} catch {
  muted = false
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, vol = 0.2) {
  const c = ensureCtx()
  if (!c || muted) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, c.currentTime + start)
  gain.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur)
  osc.connect(gain).connect(c.destination)
  osc.start(c.currentTime + start)
  osc.stop(c.currentTime + start + dur + 0.05)
}

function sweep(freqA: number, freqB: number, start: number, dur: number, type: OscillatorType, vol = 0.2) {
  const c = ensureCtx()
  if (!c || muted) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freqA, c.currentTime + start)
  osc.frequency.exponentialRampToValueAtTime(freqB, c.currentTime + start + dur)
  gain.gain.setValueAtTime(0, c.currentTime + start)
  gain.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur)
  osc.connect(gain).connect(c.destination)
  osc.start(c.currentTime + start)
  osc.stop(c.currentTime + start + dur + 0.05)
}

export const gachaAudio = {
  get muted() {
    return muted
  },
  toggleMute() {
    muted = !muted
    try {
      localStorage.setItem('gacha_muted', muted ? '1' : '0')
    } catch {
      // ignore
    }
  },
  intro() {
    for (let i = 0; i < 4; i++) tone(160, i * 0.15, 0.1, 'square', 0.12)
  },
  flip() {
    tone(880, 0, 0.08, 'triangle', 0.18)
  },
  reveal(rarity: string) {
    if (rarity === 'UR') {
      sweep(500, 1600, 0, 0.7, 'sawtooth', 0.16)
      for (let i = 0; i < 6; i++) tone(1200 + i * 120, i * 0.08, 0.25, 'sine', 0.15)
    } else if (rarity === 'SSR') {
      sweep(400, 1200, 0, 0.5, 'triangle', 0.2)
      tone(1046, 0, 0.4, 'sine', 0.18)
      tone(1318, 0.08, 0.4, 'sine', 0.16)
    } else if (rarity === 'SR') {
      tone(784, 0, 0.25, 'sine', 0.18)
      tone(988, 0.08, 0.25, 'sine', 0.16)
    } else {
      tone(440, 0, 0.12, 'triangle', 0.14)
    }
  },
  coin() {
    for (let i = 0; i < 3; i++) tone(1400 + Math.random() * 300, i * 0.06, 0.12, 'sine', 0.1)
  },
  bad() {
    sweep(300, 120, 0, 0.3, 'sawtooth', 0.15)
  },
}
