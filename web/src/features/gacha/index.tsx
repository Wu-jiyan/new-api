import { Coins, Info, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { useAuthStore } from '@/stores/auth-store'

import { fetchGachaPools, fetchGachaStats, pullGachaCards } from './api'
import { PullResult } from './components/pull-result'
import { gachaAudio } from './lib/audio'

import './lib/gacha.css'
import type {
  GachaPool,
  GachaStats,
  PullResult as PullResultType,
} from './types'

function ProbabilityDialog({ pool }: { pool: GachaPool }) {
  const entries = pool.entries ?? []
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size='sm'
        variant='ghost'
        className='h-6 px-1.5 text-xs'
        onClick={() => setOpen(true)}
      >
        <Info className='mr-1 size-3.5' /> 概率公示
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[80vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>{pool.name} · 概率公示</DialogTitle>
            <DialogDescription>
              {pool.pity_enabled && pool.pity_max > 0
                ? `${pool.pity_max} 抽硬保底 ${pool.pity_rarity} 及以上；`
                : ''}
              {pool.ten_guarantee ? `十连保底 ${pool.ten_guarantee}+；` : ''}
              保底规则以卡池配置为准。
            </DialogDescription>
          </DialogHeader>
          {totalWeight > 0 && (
            <div className='space-y-2 text-xs'>
              {entries.map((e) => (
                <div
                  key={e.id}
                  className='bg-muted/50 flex items-center justify-between rounded-lg px-3 py-1.5'
                >
                  <div className='flex min-w-0 items-center gap-2'>
                    <span className='truncate font-mono'>
                      {e.models
                        .split(',')
                        .map((name) => name.trim())
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                    <span className='bg-muted shrink-0 rounded px-1 py-0.5'>
                      {e.group}
                    </span>
                  </div>
                  <div className='text-muted-foreground flex shrink-0 gap-4'>
                    <span>{((e.weight / totalWeight) * 100).toFixed(2)}%</span>
                    <span>
                      {(e.quota_max ?? 0) > (e.quota_min ?? 0)
                        ? `${formatQuotaWithCurrency(e.quota_min ?? 0)}~${formatQuotaWithCurrency(e.quota_max ?? 0)}`
                        : formatQuotaWithCurrency(e.quota)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function rtpTextClass(rtp?: number): string {
  if ((rtp ?? 0) >= 1) return 'text-green-500'
  if ((rtp ?? 0) >= 0.8) return 'text-amber-500'
  return 'text-muted-foreground'
}

export default function GachaPage() {
  const { auth } = useAuthStore()
  const [pools, setPools] = useState<GachaPool[]>([])
  const [cards, setCards] = useState<PullResultType[]>([])
  const [stats, setStats] = useState<GachaStats | null>(null)
  const [pulling, setPulling] = useState(false)
  const [muted, setMuted] = useState(gachaAudio.muted)
  const balance = auth.user?.quota ?? 0

  useEffect(() => {
    void fetchGachaPools()
      .then(setPools)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : '卡池加载失败')
      )
  }, [])

  useEffect(() => {
    void fetchGachaStats()
      .then(setStats)
      .catch(() => undefined)
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
      void fetchGachaStats()
        .then(setStats)
        .catch(() => undefined)
    } catch (error: unknown) {
      gachaAudio.bad()
      toast.error(error instanceof Error ? error.message : '抽卡失败')
    } finally {
      setPulling(false)
    }
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>抽出你的专属模型卡</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={() => {
            gachaAudio.toggleMute()
            setMuted(gachaAudio.muted)
          }}
        >
          {muted ? (
            <VolumeX className='mr-2 size-4' />
          ) : (
            <Volume2 className='mr-2 size-4' />
          )}
          {muted ? '音效已关' : '音效已开'}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-8'>
          <section className='border-primary/20 from-primary/15 via-background relative overflow-hidden rounded-3xl border bg-gradient-to-br to-pink-500/10 p-6 md:p-10'>
            <div className='pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-pink-500/20 blur-3xl' />
            <div className='relative flex flex-wrap items-start justify-between gap-5'>
              <div className='space-y-3'>
                <div className='text-primary flex items-center gap-2 text-sm font-semibold tracking-[0.2em] uppercase'>
                  <Sparkles className='size-4' /> Model Gacha
                </div>
                <p className='text-muted-foreground max-w-2xl'>
                  每张卡都绑定真实模型、分组与 quota，抽到后即可在 API
                  请求中使用。
                </p>
              </div>
              <div className='bg-background/70 flex items-center gap-2 rounded-full border px-4 py-2 text-sm backdrop-blur'>
                <Coins className='size-4 text-amber-500' />
                <span>钱包余额</span>
                <strong>{formatQuotaWithCurrency(auth.user?.quota)}</strong>
              </div>
            </div>
          </section>

          {stats && (stats.recent_pulls ?? 0) > 0 && (
            <div className='bg-card/60 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3.5 text-sm'>
              <div className='flex items-center gap-2'>
                <span className='text-base'>
                  {stats.recent_rtp && stats.recent_rtp >= 1 ? '🎉' : '📊'}
                </span>
                <span className='text-muted-foreground'>
                  近 {stats.recent_pulls} 抽回本率
                </span>
                <strong className={rtpTextClass(stats.recent_rtp)}>
                  {((stats.recent_rtp ?? 0) * 100).toFixed(1)}%
                </strong>
                <span className='text-muted-foreground text-xs'>
                  投入 {formatQuotaWithCurrency(stats.recent_cost)} · 卡价值{' '}
                  {formatQuotaWithCurrency(stats.recent_value)}
                </span>
              </div>
              <span className='text-muted-foreground text-xs'>
                基于近几次真实抽卡数据统计，非概率承诺，仅供参考
              </span>
            </div>
          )}

          <div>
            <h2 className='text-xl font-bold'>选择卡池</h2>
            <p className='text-muted-foreground text-sm'>
              每个卡池拥有独立概率与保底进度
            </p>
          </div>

          <div className='grid grid-cols-1 gap-5 md:grid-cols-3'>
            {pools.map((pool) => (
              <Card
                key={pool.id}
                className='border-border/70 bg-card/80 shadow-primary/5 shadow-lg'
              >
                <CardHeader>
                  <CardTitle className='flex items-center justify-between gap-3'>
                    <span>{pool.name}</span>
                    <span className='text-muted-foreground text-sm font-normal'>
                      {formatQuotaWithCurrency(pool.price)}
                    </span>
                  </CardTitle>
                  <CardDescription>
                    {pool.description || '探索稀有模型与专属分组'}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div className='bg-muted/50 text-muted-foreground rounded-xl p-3 text-xs'>
                    期望价值约 {formatQuotaWithCurrency(pool.ev_value)}
                    {pool.pity_enabled && pool.pity_max > 0
                      ? ` · ${pool.pity_max} 抽保底 ${pool.pity_rarity || ''}`
                      : ''}
                  </div>
                  <div className='flex items-center justify-between'>
                    <div className='flex gap-2'>
                      <Button
                        className='flex-1'
                        disabled={pulling || balance < pool.price}
                        onClick={() => void doPull(pool, 1)}
                      >
                        单抽
                      </Button>
                      <Button
                        className='flex-1'
                        variant='secondary'
                        disabled={
                          pulling ||
                          pool.ten_price <= 0 ||
                          balance < pool.ten_price
                        }
                        onClick={() => void doPull(pool, 10)}
                      >
                        十连{' '}
                        {pool.ten_price > 0
                          ? formatQuotaWithCurrency(pool.ten_price)
                          : '未开放'}
                      </Button>
                    </div>
                    <ProbabilityDialog pool={pool} />
                  </div>
                  {balance < pool.price && (
                    <p className='text-destructive text-xs'>
                      余额不足，请先充值
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {cards.length > 0 && (
            <PullResult cards={cards} onClose={() => setCards([])} />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
