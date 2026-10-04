import { useEffect, useState } from 'react'
import { Layers, PackageOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchGachaEntitlements } from '@/features/gacha/api'
import {
  RARITY_CARD_CLASS,
  RARITY_TEXT_CLASS,
  rarityName,
} from '@/features/gacha/level'
import { MergeBadgeView } from '@/features/gacha/merge-badge'
import { formatQuotaWithCurrency } from '@/lib/currency'

import type { GachaEntitlement } from '@/features/gacha/types'

type StatusFilter = 'all' | 'active' | 'expired'

const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  if (status === 'active') {
    return (
      <Badge className='bg-green-500/15 text-green-600'>{t('Active')}</Badge>
    )
  }
  return <Badge className='bg-slate-500/15 text-slate-500'>{t('Expired')}</Badge>
}

/** 模型范围折叠：超过 3 个时只显示前几个并给出 +N。 */
function ModelRange({ models }: { models: string[] }) {
  const { t } = useTranslation()
  if (models.length === 0) {
    return <span className='text-muted-foreground'>{t('All models')}</span>
  }
  const shown = models.slice(0, 3)
  const rest = models.length - shown.length
  return (
    <div className='flex flex-wrap items-center gap-1'>
      {shown.map((model) => (
        <code
          key={model}
          className='max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]'
        >
          {model}
        </code>
      ))}
      {rest > 0 && (
        <span className='text-[11px] text-muted-foreground'>
          {t('+{{count}} more', { count: rest })}
        </span>
      )}
    </div>
  )
}

function EntitlementView({
  entitlement,
  rating,
}: {
  entitlement: GachaEntitlement
  rating?: string
}) {
  const { t } = useTranslation()
  const rarity = rarityName(rating)
  const models = entitlement.usable_models ?? []
  const groups = entitlement.usable_groups ?? []
  const remain = Math.max(entitlement.amount_total - entitlement.amount_used, 0)
  return (
    <Card
      className={`relative flex flex-col gap-3 overflow-hidden border-2 p-4 shadow-lg shadow-primary/5 ${RARITY_CARD_CLASS[rarity] ?? 'border-border/70 bg-card/80'}`}
    >
      <span
        className={`absolute top-2 right-3 text-[11px] font-black tracking-widest ${RARITY_TEXT_CLASS[rarity] ?? 'text-muted-foreground'}`}
      >
        {rarity}
      </span>
      <div className='flex items-start justify-between gap-2'>
        <span className='truncate text-sm font-bold'>
          {models.length > 0 ? models[0] : t('All models')}
        </span>
        <StatusBadge status={entitlement.status} />
      </div>
      <MergeBadgeView count={entitlement.merge_count} className='absolute top-9 right-3' />
      <div className='space-y-1'>
        <span className='text-[11px] text-muted-foreground'>{t('Model range')}</span>
        <ModelRange models={models} />
      </div>
      {groups.length > 0 && (
        <div className='flex items-center justify-between text-xs'>
          <span className='text-muted-foreground'>{t('Group')}</span>
          <code className='rounded bg-muted px-1.5 py-0.5'>{groups.join(', ')}</code>
        </div>
      )}
      <div className='flex items-center justify-between text-sm'>
        <span className='text-muted-foreground'>{t('Remaining balance')}</span>
        <span className='font-semibold'>{formatQuotaWithCurrency(remain)}</span>
      </div>
      {remain !== entitlement.amount_total && (
        <div className='flex items-center justify-between text-[11px] text-muted-foreground'>
          <span>{t('Total granted')}</span>
          <span>{formatQuotaWithCurrency(entitlement.amount_total)}</span>
        </div>
      )}
      <div className='flex items-center justify-between text-xs text-muted-foreground'>
        <span>{t('Expires at')}</span>
        <span>{new Date(entitlement.end_time * 1000).toLocaleDateString()}</span>
      </div>
    </Card>
  )
}

type EntitlementPageResult = {
  data: GachaEntitlement[]
  ratings: Record<string, string>
  total: number
}

export default function GachaEntitlementsPage() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<StatusFilter>('all')
  // The response is tagged with the filter it was fetched for, so switching
  // filters renders the skeleton without a synchronous state update.
  const [result, setResult] = useState<{
    filter: StatusFilter
    value: EntitlementPageResult
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchGachaEntitlements(filter === 'all' ? undefined : filter).then(
      (value) => {
        if (!cancelled) {
          setResult({ filter, value })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [filter])

  const loaded = result?.filter === filter ? result.value : null
  const entitlements = loaded?.data ?? []
  const total = loaded?.total ?? 0
  const activeCount = entitlements.filter(
    (item) => item.status === 'active'
  ).length

  const filters: Array<{ key: StatusFilter; label: string }> = [
    { key: 'all', label: t('All') },
    { key: 'active', label: t('Active') },
    { key: 'expired', label: t('Expired') },
  ]

  function renderEntitlements() {
    if (!loaded) {
      return (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className='h-44 rounded-2xl' />
          ))}
        </div>
      )
    }
    if (entitlements.length === 0) {
      return (
        <div className='flex flex-col items-center gap-3 rounded-2xl border border-dashed py-16 text-muted-foreground'>
          <PackageOpen className='size-10' />
          <p>{t('No entitlements yet — try your luck on the gacha page')}</p>
        </div>
      )
    }
    return (
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
        {entitlements.map((item) => (
          <EntitlementView
            key={item.id}
            entitlement={item}
            rating={loaded.ratings[item.usable_models?.[0] ?? '']}
          />
        ))}
      </div>
    )
  }

  return (
    <main className='min-h-0 flex-1 overflow-y-auto'>
      <div className='container mx-auto max-w-6xl space-y-6 py-8'>
        <div className='flex flex-wrap items-end justify-between gap-4'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2 text-sm font-semibold tracking-[0.2em] text-primary uppercase'>
              <Layers className='size-4' /> My Entitlements
            </div>
            <h1 className='text-2xl font-bold'>{t('My entitlements')}</h1>
            <p className='text-sm text-muted-foreground'>
              {t(
                'Pulled quota is a subscription restricted to its model range. Use your own API token — the balance is deducted automatically.'
              )}
            </p>
            <p className='text-xs text-muted-foreground'>
              {t('Total {{total}} · Active on this page {{active}}', {
                total,
                active: activeCount,
              })}
            </p>
          </div>
          <div className='flex gap-2'>
            {filters.map((item) => (
              <Button
                key={item.key}
                size='sm'
                variant={filter === item.key ? 'default' : 'outline'}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        {renderEntitlements()}
      </div>
    </main>
  )
}