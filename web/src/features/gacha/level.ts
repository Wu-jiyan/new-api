// 抽卡档位与等级展示工具。

export const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR'] as const

export type Rarity = (typeof RARITIES)[number]

export const RARITY_LABEL: Record<string, string> = {
  N: '普通',
  R: '稀有',
  SR: '超稀有',
  SSR: '传说',
  UR: '神话',
}

export const RARITY_CARD_CLASS: Record<string, string> = {
  N: 'border-slate-400/30 bg-slate-500/5',
  R: 'border-green-500/40 bg-green-500/5',
  SR: 'border-sky-500/40 bg-sky-500/5',
  SSR: 'border-purple-500/40 bg-purple-500/5',
  UR: 'border-amber-500/50 bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-yellow-400/10',
}

export const RARITY_TEXT_CLASS: Record<string, string> = {
  N: 'text-slate-400',
  R: 'text-green-500',
  SR: 'text-sky-500',
  SSR: 'text-purple-500',
  UR: 'text-amber-500',
}

// QQ 等级制度：星星 -> 月亮 -> 太阳 -> 皇冠，每 4 个低一级升级，无上限。
// count 为抽中次数：第 1 次为 0 星（无图标），之后每多抽中一次累加一个等级图标。
export function qqLevelIcons(count: number): string {
  const n = Math.max(0, count - 1)
  if (n <= 0) return ''
  let stars = n
  const moons = Math.floor(stars / 4)
  stars %= 4
  const suns = Math.floor(moons / 4)
  let moon = moons % 4
  const crowns = Math.floor(suns / 4)
  let sun = suns % 4
  let icons = ''
  for (let i = 0; i < crowns; i++) icons += '👑'
  for (let i = 0; i < sun; i++) icons += '☀️'
  for (let i = 0; i < moon; i++) icons += '🌙'
  for (let i = 0; i < stars; i++) icons += '⭐'
  return icons
}

// qqLevelText 返回等级文本（如 "x3"），无等级时为空。
export function qqLevelText(count: number): string {
  return count > 1 ? `x${count}` : ''
}
