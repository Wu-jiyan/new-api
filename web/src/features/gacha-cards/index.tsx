import { useEffect, useMemo, useState } from 'react'
import { Layers, PackageOpen } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchGachaCards } from '@/features/gacha/api'
import {
  qqLevelIcons,
  qqLevelText,
  RARITY_CARD_CLASS,
  RARITY_LABEL,
  RARITY_TEXT_CLASS,
} from '@/features/gacha/level'
import { formatQuotaWithCurrency } from '@/lib/currency'

import type { UserGachaCard } from '@/features/gacha/types'

const STATUS_LABEL: Record<number, { text: string; className: string }> = {
  0: { text: '可用', className: 'bg-green-500/15 text-green-600' },
  1: { text: '已用完', className: 'bg-slate-500/15 text-slate-500' },
  2: { text: '已过期', className: 'bg-slate-500/15 text-slate-500' },
  3: { text: '已禁用', className: 'bg-red-500/15 text-red-500' },
}

function StatusBadge({ status }: { status: number }) {
  const st = STATUS_LABEL[status] ?? STATUS_LABEL[0]
  return <Badge className={st.className}>{st.text}</Badge>
}

function CardView({ card, rating }: { card: UserGachaCard; rating?: string }) {
  const icons = qqLevelIcons(card.merge_count ?? 1)
  const levelText = qqLevelText(card.merge_count ?? 1)
  const rarity = rating || ''
  return (
    <Card
      className={`relative flex flex-col gap-3 overflow-hidden border-2 p-4 shadow-lg shadow-primary/5 ${RARITY_CARD_CLASS[rarity] ?? 'border-border/70 bg-card/80'}`}
    >
      {rarity && (
        <span
          className={`absolute top-2 right-3 text-[10px] font-bold tracking-widest uppercase ${RARITY_TEXT_CLASS[rarity] ?? 'text-muted-foreground'}`}
        >
          {RARITY_LABEL[rarity] ?? rarity}
        </span>
      )}
      <div className='flex items-start justify-between gap-2'>
        <span className='truncate font-mono text-sm font-bold'>{card.model_name}</span>
        <StatusBadge status={card.status} />
      </div>
      {levelText && (
        <div className='flex items-center gap-2 text-xs'>
          <span className='text-base leading-none'>{icons || '✨'}</span>
          <span className='rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground'>
            {levelText}
          </span>
        </div>
      )}
      <div className='flex items-center justify-between text-xs'>
        <span className='text-muted-foreground'>分组</span>
        <code className='rounded bg-muted px-1.5 py-0.5'>{card.group}</code>
      </div>
      <div className='flex items-center justify-between text-sm'>
        <span className='text-muted-foreground'>剩余额度</span>
        <span className='font-semibold'>{formatQuotaWithCurrency(card.remain_quota)}</span>
      </div>
      {card.total_quota !== card.remain_quota && (
        <div className='flex items-center justify-between text-[11px] text-muted-foreground'>
          <span>累计获得</span>
          <span>{formatQuotaWithCurrency(card.total_quota)}</span>
        </div>
      )}
      <div className='flex items-center justify-between text-xs text-muted-foreground'>
        <span>有效期</span>
        <span>
          {card.expired_time === -1
            ? '永久'
            : new Date(card.expired_time * 1000).toLocaleDateString()}
        </span>
      </div>
      <p className='mt-auto rounded-lg bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground'>
        调用时携带请求头：
        <code className='mt-1 block break-all rounded bg-background px-1.5 py-0.5 font-mono'>
          New-Api-Card: {card.id}
        </code>
      </p>
    </Card>
  )
}

export default function GachaCardsPage() {
  const [cards, setCards] = useState<UserGachaCard[]>([])
  const [ratings, setRatings] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    setLoading(true)
    void fetchGachaCards(filter)
      .then((r) => {
        setCards(r.data)
        setRatings(r.ratings)
        setTotal(r.total)
      })
      .finally(() => setLoading(false))
  }, [filter])

  const usable = useMemo(() => cards.filter((c) => c.status === 0).length, [cards])

  const filters: Array<{ label: string; value?: number }> = [
    { label: '全部' },
    { label: '可用', value: 0 },
    { label: '已用完', value: 1 },
    { label: '已过期', value: 2 },
  ]

  return (
    <main className='min-h-0 flex-1 overflow-y-auto'>
      <div className='container mx-auto max-w-6xl space-y-6 py-8'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div className='space-y-1'>
          <div className='flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-primary'>
            <Layers className='size-4' /> My Cards
          </div>
          <h1 className='text-2xl font-bold'>我的卡库</h1>
          <p className='text-sm text-muted-foreground'>
            共 {total} 张 · 本页可用 {usable} 张 · 重复卡自动合并叠加
          </p>
        </div>
        <div className='flex gap-2'>
          {filters.map((f) => (
            <Button
              key={f.label}
              size='sm'
              variant={filter === f.value ? 'default' : 'outline'}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className='h-44 rounded-2xl' />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className='flex flex-col items-center gap-3 rounded-2xl border border-dashed py-16 text-muted-foreground'>
          <PackageOpen className='size-10' />
          <p>还没有抽到卡，去抽卡页试试手气吧</p>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
          {cards.map((card) => (
            <CardView key={card.id} card={card} rating={ratings[card.model_name]} />
          ))}
        </div>
      )}
      </div>
    </main>
  )
}
