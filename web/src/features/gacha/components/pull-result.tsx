import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { formatQuotaWithCurrency } from '@/lib/currency'

import { RARITY_STYLE, RARITY_TEXT_CLASS, rarityName } from '../level'
import { MergeBadgeView } from '../merge-badge'
import { gachaAudio } from '../lib/audio'
import { burstAtCenter, rain } from '../lib/fx'
import type { PullResult } from '../types'

const RARITY_ORDER: Record<string, number> = { N: 0, R: 1, SR: 2, SSR: 3, UR: 4 }

export function PullResult({ cards, onClose }: { cards: PullResult[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [flipped, setFlipped] = useState<boolean[]>(() => cards.map(() => false))
  const [done, setDone] = useState(false)
  const [shake, setShake] = useState(false)
  const timers = useRef<number[]>([])

  const top = useMemo(() => {
    let best = 'N'
    for (const c of cards) {
      if ((RARITY_ORDER[c.rarity] ?? 0) > (RARITY_ORDER[best] ?? 0)) best = c.rarity
    }
    return best
  }, [cards])

  // A ten-pull can stack several results onto the same entitlement, so the
  // subscription id alone is not unique; the occurrence counter keeps keys
  // stable without indexing by position.
  const keyed = useMemo(() => {
    const seen = new Map<number, number>()
    return cards.map((card) => {
      const occurrence = seen.get(card.subscription_id) ?? 0
      seen.set(card.subscription_id, occurrence + 1)
      return { card, key: occurrence === 0 ? String(card.subscription_id) : `${card.subscription_id}-${occurrence}` }
    })
  }, [cards])

  const style = RARITY_STYLE[top] ?? RARITY_STYLE.N

  useEffect(() => {
    cards.forEach((card, i) => {
      const delay = 350 + i * 420
      const t = window.setTimeout(() => {
        setFlipped((prev) => prev.map((f, j) => (j === i ? true : f)))
        gachaAudio.reveal(card.rarity)
        const burstColors = (RARITY_STYLE[card.rarity] ?? RARITY_STYLE.N).burst
        if (burstColors.length > 0) burstAtCenter(burstColors)
        if (i === cards.length - 1) {
          const t2 = window.setTimeout(() => {
            setDone(true)
            setShake(true)
            const topColors = style.burst
            if (topColors.length > 0) rain(topColors, top === 'UR' || top === 'SSR' ? 2400 : 1500)
          }, 720)
          timers.current.push(t2)
        }
      }, delay)
      timers.current.push(t)
    })
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards])

  const glowColor =
    { UR: 'rgba(236,72,153,0.55)', SSR: 'rgba(245,158,11,0.5)', SR: 'rgba(147,51,234,0.45)', R: 'rgba(59,130,246,0.4)' }[top] ??
    'rgba(100,116,139,0.3)'

  return (
    <div
      className={cn('fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br to-slate-950 via-slate-950 p-6', style.bg, shake && 'gacha-shake')}
      onClick={onClose}
    >
      {/* 背景光晕 */}
      <div className='pointer-events-none absolute inset-0'>
        <div
          className='gacha-bg-pulse absolute top-1/2 left-1/2 h-[85vmin] w-[85vmin] rounded-full blur-3xl'
          style={{ background: glowColor }}
        />
      </div>

      <div className='relative z-10 flex w-full max-w-5xl flex-col items-center gap-6'>
        <header className='text-center'>
          <div className='text-xs font-semibold tracking-[0.5em] text-muted-foreground uppercase'>GACHA RESULT</div>
          <h2 className='gacha-title-in mt-1 text-3xl font-black tracking-tight text-white md:text-4xl'>抽卡结果</h2>
          {done && top !== 'N' && (
            <div
              className={cn(
                'gacha-title-in mt-3 text-2xl font-black tracking-[0.2em] md:text-3xl',
                RARITY_TEXT_CLASS[top]
              )}
            >
              ★ {rarityName(top)} 降临 ★
            </div>
          )}
        </header>

        <div className={cn('grid gap-4', cards.length > 5 ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3')}>
          {keyed.map(({ card, key }, i) => {
            const s = RARITY_STYLE[card.rarity] ?? RARITY_STYLE.N
            return (
              <div key={key} className='relative aspect-[3/4] w-28 sm:w-32 md:w-36 [perspective:1000px]'>
                <div
                  className={cn(
                    'relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] ease-[cubic-bezier(.2,.7,.3,1.15)]',
                    flipped[i] && '[transform:rotateY(180deg)]'
                  )}
                >
                  {/* 卡背 */}
                  <div className='absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-slate-600 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 [backface-visibility:hidden]'>
                    <span className='animate-pulse text-4xl font-black text-slate-500'>?</span>
                    <span className='absolute bottom-2 text-[9px] tracking-widest text-slate-600'>NEW API</span>
                  </div>
                  {/* 卡面 */}
                  <div
                    className={cn(
                      'absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 bg-gradient-to-br p-2 [backface-visibility:hidden] [transform:rotateY(180deg)]',
                      s.border,
                      s.bg,
                      flipped[i] && s.glow,
                      flipped[i] && 'animate-[gacha-pop_.5s_cubic-bezier(.2,.9,.3,1.4)]'
                    )}
                  >
                    <span className={cn('absolute top-2 right-2 rounded px-1.5 py-0.5 text-[11px] font-black', s.badge)}>
                      {rarityName(card.rarity)}
                    </span>
                    <MergeBadgeView count={card.merge_count} className='text-[10px]' />
                    <span className='max-w-full truncate text-center text-xs font-bold text-white sm:text-sm'>
                      {card.models[0] ?? t('All models')}
                    </span>
                    {card.models.length > 1 && (
                      <span className='max-w-full truncate text-[10px] text-muted-foreground'>
                        {t('+{{count}} more', { count: card.models.length - 1 })}
                      </span>
                    )}
                    {card.group && (
                      <span className='max-w-full truncate text-[10px] text-muted-foreground'>{card.group}</span>
                    )}
                    <span className='text-[11px] font-bold text-amber-300'>{formatQuotaWithCurrency(card.quota)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {done && cards.some((card) => card.merged) && (
          <div className='w-full max-w-xl space-y-1 rounded-xl border border-white/15 bg-black/25 p-3 text-left'>
            <p className='text-sm font-semibold text-white'>{t('Stacked onto existing entitlements')}</p>
            <p className='text-xs text-slate-300'>
              {t(
                'Quota was added to a matching entitlement instead of creating a new one. Use your own API token — the balance is deducted automatically.'
              )}
            </p>
          </div>
        )}

        <footer className='h-6'>
          {done ? (
            <span className='animate-pulse text-sm text-muted-foreground'>点击任意处继续</span>
          ) : (
            <span className='text-sm text-muted-foreground/70'>翻转中…</span>
          )}
        </footer>
      </div>
    </div>
  )
}
