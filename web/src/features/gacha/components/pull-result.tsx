import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { formatQuotaWithCurrency } from '@/lib/currency'

import { gachaAudio } from '../lib/audio'
import type { PullCardResult } from '../types'

const RARITY_STYLE: Record<string, { border: string; glow: string; badge: string }> = {
  N: {
    border: 'border-slate-400',
    glow: '',
    badge: 'bg-slate-500/20 text-slate-300',
  },
  R: {
    border: 'border-blue-500',
    glow: 'shadow-[0_0_20px_rgba(59,130,246,0.5)]',
    badge: 'bg-blue-500/20 text-blue-300',
  },
  SR: {
    border: 'border-purple-500',
    glow: 'shadow-[0_0_24px_rgba(147,51,234,0.6)]',
    badge: 'bg-purple-500/20 text-purple-300',
  },
  SSR: {
    border: 'border-amber-500',
    glow: 'shadow-[0_0_32px_rgba(245,158,11,0.8)]',
    badge: 'bg-amber-500/20 text-amber-300',
  },
  UR: {
    border: 'border-pink-500',
    glow: 'shadow-[0_0_40px_rgba(236,72,153,0.9)]',
    badge: 'bg-pink-500/25 text-pink-200',
  },
}

export function PullResult({ cards }: { cards: PullCardResult[] }) {
  const [flipped, setFlipped] = useState<boolean[]>(cards.map(() => false))
  const timers = useRef<number[]>([])

  useEffect(() => {
    cards.forEach((card, i) => {
      const delay = 450 + i * 380
      const t = window.setTimeout(() => {
        setFlipped((prev) => prev.map((f, j) => (j === i ? true : f)))
        gachaAudio.reveal(card.rarity)
      }, delay)
      timers.current.push(t)
    })
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
  }, [cards])

  return (
    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5'>
      {cards.map((card, i) => {
        const style = RARITY_STYLE[card.rarity] ?? RARITY_STYLE.N
        return (
          <div key={`${card.card_id}-${i}`} className='relative aspect-[3/4] [perspective:900px]'>
            <div
              className={cn(
                'relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] ease-[cubic-bezier(.2,.7,.3,1.15)]',
                flipped[i] && '[transform:rotateY(180deg)]'
              )}
            >
              <div className='absolute inset-0 flex items-center justify-center rounded-xl border-2 border-slate-700 bg-slate-900 [backface-visibility:hidden]'>
                <span className='text-3xl font-black text-slate-600'>?</span>
              </div>
              <div
                className={cn(
                  'absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 bg-slate-800 p-2 [backface-visibility:hidden] [transform:rotateY(180deg)]',
                  style.border,
                  flipped[i] && style.glow,
                  flipped[i] && 'animate-[gacha-pop_.5s_cubic-bezier(.2,.9,.3,1.4)]'
                )}
              >
                <span
                  className={cn(
                    'absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold',
                    style.badge
                  )}
                >
                  {card.rarity || 'N'}
                </span>
                <span className='truncate text-center text-xs font-semibold'>
                  {card.model_name}
                </span>
                <span className='max-w-full truncate text-[10px] text-muted-foreground'>
                  {card.group}
                </span>
                <span className='text-[10px] text-muted-foreground'>
                  {formatQuotaWithCurrency(card.quota)}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
