import { Crown, Moon, Star, Sun } from 'lucide-react'

// 抽卡档位与等级展示工具（统一源：卡库、抽卡动画、管理端共用）。

export const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR'] as const

export type Rarity = (typeof RARITIES)[number]

// 档位 -> 卡面/边框样式（与抽卡动画一致）：N 灰蓝、R 蓝、SR 紫、SSR 金、UR 粉金
export const RARITY_CARD_CLASS: Record<string, string> = {
  N: 'border-slate-400/30 bg-slate-500/5',
  R: 'border-blue-500/40 bg-blue-500/5',
  SR: 'border-purple-500/40 bg-purple-500/5',
  SSR: 'border-amber-500/50 bg-amber-500/5',
  UR: 'border-pink-500/60 bg-gradient-to-br from-pink-500/15 via-orange-500/5 to-amber-400/10',
}

export const RARITY_TEXT_CLASS: Record<string, string> = {
  N: 'text-slate-400',
  R: 'text-blue-500',
  SR: 'text-purple-500',
  SSR: 'text-amber-500',
  UR: 'text-pink-500',
}

// 抽卡动画样式（全屏翻卡）：边框/辉光/角标/背景渐变/粒子颜色
export interface RarityStyle {
  border: string
  glow: string
  badge: string
  bg: string
  burst: string[]
}

export const RARITY_STYLE: Record<string, RarityStyle> = {
  N: {
    border: 'border-slate-400',
    glow: '',
    badge: 'bg-slate-500/20 text-slate-300',
    bg: 'from-slate-900 via-slate-950 to-slate-900',
    burst: [],
  },
  R: {
    border: 'border-blue-500',
    glow: 'shadow-[0_0_24px_rgba(59,130,246,0.6)]',
    badge: 'bg-blue-500/20 text-blue-300',
    bg: 'from-blue-950/95 via-slate-950 to-blue-950/95',
    burst: ['#3b82f6', '#bfdbfe'],
  },
  SR: {
    border: 'border-purple-500',
    glow: 'shadow-[0_0_30px_rgba(147,51,234,0.7)]',
    badge: 'bg-purple-500/20 text-purple-300',
    bg: 'from-purple-950/95 via-slate-950 to-purple-950/95',
    burst: ['#9333ea', '#c4b5fd'],
  },
  SSR: {
    border: 'border-amber-500',
    glow: 'shadow-[0_0_36px_rgba(245,158,11,0.85)]',
    badge: 'bg-amber-500/20 text-amber-300',
    bg: 'from-amber-950/95 via-slate-950 to-amber-950/95',
    burst: ['#f59e0b', '#fde68a', '#ffffff'],
  },
  UR: {
    border: 'border-pink-500',
    glow: 'shadow-[0_0_48px_rgba(236,72,153,0.95)]',
    badge: 'bg-pink-500/25 text-pink-200',
    bg: 'from-pink-950 via-slate-950 to-amber-950',
    burst: ['#ec4899', '#f59e0b', '#ffffff', '#fda4af'],
  },
}

// QQ 等级制度：星星 -> 月亮 -> 太阳 -> 皇冠，每 4 个低一级升级，无上限。
// count 为抽中次数：第 1 次为 0 星（无图标），之后每多抽中一次累加一个等级图标。
export function QQLevel({ count, className }: { count: number; className?: string }) {
  const n = Math.max(0, count - 1)
  if (n <= 0) return null
  let stars = n
  const moons = Math.floor(stars / 4)
  stars %= 4
  const suns = Math.floor(moons / 4)
  let moon = moons % 4
  const crowns = Math.floor(suns / 4)
  let sun = suns % 4
  const iconCls = `size-3.5 ${className ?? ''}`
  return (
    <span className='flex flex-wrap items-center gap-0.5'>
      {Array.from({ length: crowns }).map((_, i) => (
        <Crown key={`c${i}`} className={`${iconCls} fill-amber-400 text-amber-400`} />
      ))}
      {Array.from({ length: sun }).map((_, i) => (
        <Sun key={`s${i}`} className={`${iconCls} fill-orange-400 text-orange-400`} />
      ))}
      {Array.from({ length: moon }).map((_, i) => (
        <Moon key={`m${i}`} className={`${iconCls} fill-sky-300 text-sky-300`} />
      ))}
      {Array.from({ length: stars }).map((_, i) => (
        <Star key={`x${i}`} className={`${iconCls} fill-yellow-400 text-yellow-400`} />
      ))}
    </span>
  )
}

// 档位展示名：统一使用 SSR 等拉丁命名。
export function rarityName(rarity?: string): string {
  return (rarity || 'N').toUpperCase()
}
