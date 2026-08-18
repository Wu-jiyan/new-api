import { useEffect, useState } from 'react'
import { Coins, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { useAuthStore } from '@/stores/auth-store'

import { fetchGachaPools, pullGachaCards } from './api'
import { PullResult } from './components/pull-result'
import { gachaAudio } from './lib/audio'
import './lib/gacha.css'
import type { GachaPool, PullCardResult } from './types'

export default function GachaPage() {
  const { auth } = useAuthStore()
  const [pools, setPools] = useState<GachaPool[]>([])
  const [cards, setCards] = useState<PullCardResult[]>([])
  const [pulling, setPulling] = useState(false)
  const [muted, setMuted] = useState(gachaAudio.muted)

  useEffect(() => {
    void fetchGachaPools()
      .then(setPools)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : '卡池加载失败'))
  }, [])

  async function doPull(pool: GachaPool, count: 1 | 10) {
    if (pulling) return
    setPulling(true)
    setCards([])
    gachaAudio.intro()
    try {
      const result = await pullGachaCards(pool.id, count, crypto.randomUUID())
      setCards(result.cards)
      gachaAudio.coin()
    } catch (error: unknown) {
      gachaAudio.bad()
      toast.error(error instanceof Error ? error.message : '抽卡失败')
    } finally {
      setPulling(false)
    }
  }

  return (
    <main className='container mx-auto max-w-6xl space-y-8 py-8'>
      <section className='relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-background to-pink-500/10 p-6 md:p-10'>
        <div className='pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-pink-500/20 blur-3xl' />
        <div className='relative flex flex-wrap items-start justify-between gap-5'>
          <div className='space-y-3'>
            <div className='flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-primary'>
              <Sparkles className='size-4' /> Model Gacha
            </div>
            <h1 className='text-3xl font-black tracking-tight md:text-5xl'>抽出你的专属模型卡</h1>
            <p className='max-w-2xl text-muted-foreground'>每张卡都绑定真实模型、分组与 quota，抽到后即可在 API 请求中使用。</p>
          </div>
          <div className='flex items-center gap-2 rounded-full border bg-background/70 px-4 py-2 text-sm backdrop-blur'>
            <Coins className='size-4 text-amber-500' />
            <span>钱包余额</span>
            <strong>{formatQuotaWithCurrency(auth.user?.quota)}</strong>
          </div>
        </div>
      </section>

      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-xl font-bold'>选择卡池</h2>
          <p className='text-sm text-muted-foreground'>每个卡池拥有独立概率与保底进度</p>
        </div>
        <Button variant='outline' size='sm' onClick={() => { gachaAudio.toggleMute(); setMuted(gachaAudio.muted) }}>
          {muted ? <VolumeX className='mr-2 size-4' /> : <Volume2 className='mr-2 size-4' />}
          {muted ? '音效已关' : '音效已开'}
        </Button>
      </div>

      <div className='grid grid-cols-1 gap-5 md:grid-cols-3'>
        {pools.map((pool) => (
          <Card key={pool.id} className='border-border/70 bg-card/80 shadow-lg shadow-primary/5'>
            <CardHeader>
              <CardTitle className='flex items-center justify-between gap-3'>
                <span>{pool.name}</span>
                <span className='text-sm font-normal text-muted-foreground'>{formatQuotaWithCurrency(pool.price)}</span>
              </CardTitle>
              <CardDescription>{pool.description || '探索稀有模型与专属分组'}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground'>
                期望价值约 {formatQuotaWithCurrency(pool.ev_value)}
                {pool.pity_enabled && pool.pity_max > 0 ? ` · ${pool.pity_max} 抽保底 ${pool.pity_rarity || ''}` : ''}
              </div>
              <div className='flex gap-2'>
                <Button className='flex-1' disabled={pulling} onClick={() => void doPull(pool, 1)}>单抽</Button>
                <Button className='flex-1' variant='secondary' disabled={pulling || pool.ten_price <= 0} onClick={() => void doPull(pool, 10)}>
                  十连 {pool.ten_price > 0 ? formatQuotaWithCurrency(pool.ten_price) : '未开放'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {cards.length > 0 && <PullResult cards={cards} />}
    </main>
  )
}
