import { useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { RatingBadge } from '@/features/pricing/components/rating-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  batchResetModelRatings,
  setAAScores,
  setDeepSweScore,
  syncAARatings,
  syncDeepSweRatings,
  updateRatingThresholds,
} from '../api'
import { AA_SCORE_FIELDS, DIMENSION_META, RATINGS_PAGE_SIZE } from '../constants'
import type {
  ModelRatingItem,
  RatingDimension,
  RatingThresholds,
  SyncSummary,
} from '../types'

/** 档位由分数与该维度阈值推导，与后端 MapScoreToRatingWith 保持一致。 */
function ratingForScore(score: number, thresholds: RatingThresholds): string {
  if (score <= 0) return ''
  if (score >= thresholds.ur) return 'UR'
  if (score >= thresholds.ssr) return 'SSR'
  if (score >= thresholds.sr) return 'SR'
  if (score >= thresholds.r) return 'R'
  return 'N'
}

const AA_FIELD_TO_DIMENSION: Record<(typeof AA_SCORE_FIELDS)[number], RatingDimension> = {
  aa_intelligence_score: 'aa_intelligence',
  aa_coding_score: 'aa_coding',
  aa_agentic_score: 'aa_agentic',
}

function ThresholdsCard(props: {
  dimension: RatingDimension
  thresholds: RatingThresholds
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(props.thresholds)
  const [saving, setSaving] = useState(false)

  // 服务端阈值变化时同步草稿，避免保存后界面仍显示旧值。
  useEffect(() => {
    setDraft(props.thresholds)
  }, [props.thresholds])

  async function save() {
    setSaving(true)
    try {
      const retiered = await updateRatingThresholds(props.dimension, draft)
      props.onSaved()
      toast.success(
        retiered > 0
          ? t('Thresholds updated, retiered {{count}} models', { count: retiered })
          : t('Thresholds updated')
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Update failed'))
    } finally {
      setSaving(false)
    }
  }

  const invalid = !(draft.ur > draft.ssr && draft.ssr > draft.sr && draft.sr > draft.r && draft.r >= 0)

  return (
    <Card className='p-4'>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-xs'>
        <span className='font-semibold'>{t('Tier thresholds')}</span>
        {(['ur', 'ssr', 'sr', 'r'] as const).map((key) => (
          <label key={key} className='flex items-center gap-1'>
            <span className='uppercase'>{key} ≥</span>
            <Input
              className='h-7 w-16'
              type='number'
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <Button size='sm' variant='outline' disabled={saving || invalid} onClick={() => void save()}>
          {t('Save thresholds')}
        </Button>
        <span className='text-muted-foreground'>
          {props.dimension === 'deepswe'
            ? t('Saving retiers every DeepSWE model by the new thresholds')
            : t('Tier is derived on read, so new thresholds take effect immediately')}
        </span>
      </div>
    </Card>
  )
}

function ScoreRow(props: {
  item: ModelRatingItem
  dimension: RatingDimension
  thresholds: RatingThresholds
  locale: string | undefined
  onSave: (id: number, value: number) => Promise<void>
}) {
  const { t } = useTranslation()
  const meta = DIMENSION_META[props.dimension]
  const stored = props.item[meta.scoreField] ?? 0
  const [edited, setEdited] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const score = edited ?? stored
  const dirty = score !== stored
  const displayRating = score > 0 ? ratingForScore(score, props.thresholds) : (props.item.rating ?? '')
  const isManual =
    meta.source === 'deepswe' ? props.item.rating_source === 'manual' : props.item.aa_source === 'manual'
  const otherFields = AA_SCORE_FIELDS.filter((field) => field !== meta.scoreField)

  async function saveScore(next: number) {
    setSaving(true)
    try {
      await props.onSave(props.item.id, next)
      setEdited(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Save failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm'>
      <div className='flex min-w-0 flex-wrap items-center gap-2'>
        <span className='truncate font-mono'>{props.item.model_name}</span>
        <RatingBadge rating={displayRating} />
        {isManual && <Badge variant='secondary'>{t('Manual')}</Badge>}
        {/* AA 三维度来自同一次同步，后端按三个维度整体写入，因此另两个维度只读展示。 */}
        {meta.source === 'aa' &&
          otherFields.map((field) => (
            <span key={field} className='text-xs text-muted-foreground'>
              {DIMENSION_META[AA_FIELD_TO_DIMENSION[field]].label}:{' '}
              {formatNumber(props.item[field] ?? 0, props.locale)}
            </span>
          ))}
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        <div className='relative'>
          <Input
            aria-label={`${props.item.model_name} ${meta.label}`}
            className='h-7 w-20 pr-7 text-right'
            type='number'
            step='0.1'
            min='0'
            max='100'
            value={score || ''}
            placeholder={t('Score')}
            onChange={(e) => setEdited(Number(e.target.value))}
          />
          <span className='absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground'>
            %
          </span>
        </div>
        <Button
          size='sm'
          variant='outline'
          className='h-7'
          disabled={saving || !dirty}
          onClick={() => void saveScore(score)}
        >
          {t('Save')}
        </Button>
        {score > 0 && (
          <Button
            size='sm'
            variant='ghost'
            className='h-7 px-2 text-muted-foreground hover:text-destructive'
            disabled={saving}
            onClick={() => {
              setEdited(0)
              void saveScore(0)
            }}
          >
            <Trash2 className='size-3.5' /> {t('Clear')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function DimensionTab(props: {
  dimension: RatingDimension
  items: ModelRatingItem[]
  total: number
  page: number
  keyword: string
  thresholds: RatingThresholds
  deepsweSync: { last_sync_at: number; last_sync_num: number }
  aaKeySet: boolean
  onKeywordChange: (value: string) => void
  onPageChange: (page: number) => void
  onReload: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const meta = DIMENSION_META[props.dimension]
  const isDeepSwe = meta.source === 'deepswe'
  const [syncing, setSyncing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncSummary | null>(null)

  const totalPages = Math.max(1, Math.ceil(props.total / RATINGS_PAGE_SIZE))

  // 同步状态提示：DeepSWE 显示上次同步时间，AA 未配置密钥时引导去设置页。
  let syncStatusCard = null
  if (isDeepSwe) {
    const lastSyncAt = props.deepsweSync.last_sync_at
    syncStatusCard = (
      <Card className='p-4 text-xs text-muted-foreground'>
        {lastSyncAt > 0
          ? t('Last sync: {{time}} · updated {{count}}', {
              time: new Date(lastSyncAt * 1000).toLocaleString(locale),
              count: props.deepsweSync.last_sync_num,
            })
          : t('Never synced')}
      </Card>
    )
  } else if (!props.aaKeySet) {
    syncStatusCard = (
      <Card className='border-primary/30 bg-primary/5 p-4 text-sm'>
        {t('Artificial Analysis API key is not configured yet. Add it in Settings to enable sync.')}
      </Card>
    )
  }

  async function doSync() {
    setSyncing(true)
    try {
      const res = isDeepSwe ? await syncDeepSweRatings() : await syncAARatings()
      setSyncResult({
        updated: res.updated,
        unchanged: res.unchanged,
        unmatched: res.unmatched,
        skippedManual: res.skipped_manual,
        // AA 同步一次覆盖三个维度，列表统一展示该维度写入的分数。
        models: res.updated_models.map((m) => ({
          modelName: m.model_name,
          score: 'rating_score' in m ? m.rating_score : m.aa_coding_score,
        })),
      })
      toast.success(t('Sync completed, updated {{count}} models', { count: res.updated }))
      props.onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Sync failed'))
    } finally {
      setSyncing(false)
    }
  }

  async function resetCurrentPage() {
    if (props.items.length === 0) return
    setResetting(true)
    try {
      const n = props.items.length
      await batchResetModelRatings(props.items.map((m) => m.id))
      toast.success(t('Cleared ratings for {{count}} models', { count: n }))
      props.onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Clear failed'))
    } finally {
      setResetting(false)
    }
  }

  async function saveScore(id: number, value: number) {
    if (isDeepSwe) {
      await setDeepSweScore(id, value)
    } else {
      const target = props.items.find((m) => m.id === id)
      // 后端按三个维度整体写入，因此必须带上当前另外两个维度的值。
      const scores = {
        aa_intelligence_score: target?.aa_intelligence_score ?? 0,
        aa_coding_score: target?.aa_coding_score ?? 0,
        aa_agentic_score: target?.aa_agentic_score ?? 0,
      }
      if (meta.scoreField === 'aa_intelligence_score') {
        scores.aa_intelligence_score = value
      } else if (meta.scoreField === 'aa_coding_score') {
        scores.aa_coding_score = value
      } else {
        scores.aa_agentic_score = value
      }
      await setAAScores(id, scores)
    }
    toast.success(value > 0 ? t('Score saved') : t('Rating cleared'))
    props.onReload()
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Input
          className='max-w-xs'
          placeholder={t('Search model name')}
          value={props.keyword}
          onChange={(e) => props.onKeywordChange(e.target.value)}
        />
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={props.items.length === 0 || resetting}
            onClick={() => void resetCurrentPage()}
          >
            <Trash2 className='mr-1.5 size-4' /> {t('Clear ratings on this page')}
          </Button>
          <Button size='sm' variant='outline' disabled={syncing} onClick={() => void doSync()}>
            <RefreshCw className={`mr-1.5 size-4 ${syncing ? 'animate-spin' : ''}`} />
            {t('Sync {{source}}', { source: meta.label })}
          </Button>
        </div>
      </div>

      <ThresholdsCard
        dimension={props.dimension}
        thresholds={props.thresholds}
        onSaved={() => void props.onReload()}
      />

      {syncStatusCard}

      {syncResult && (
        <Card className='border-primary/30 bg-primary/5 p-4'>
          <div className='flex items-center justify-between gap-2 text-sm'>
            <span className='font-semibold'>{t('Sync result')}</span>
            <Button size='sm' variant='ghost' className='h-6 px-2' onClick={() => setSyncResult(null)}>
              {t('Close')}
            </Button>
          </div>
          <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
            <span className='text-green-600'>{t('Updated {{count}}', { count: syncResult.updated })}</span>
            <span>{t('Unchanged {{count}}', { count: syncResult.unchanged })}</span>
            <span>{t('Unmatched {{count}}', { count: syncResult.unmatched })}</span>
            <span>{t('Manual skipped {{count}}', { count: syncResult.skippedManual })}</span>
          </div>
          {syncResult.models.length > 0 && (
            <div className='mt-2 max-h-32 space-y-1 overflow-y-auto'>
              {syncResult.models.map((m) => (
                <div key={m.modelName} className='flex items-center gap-2 text-xs'>
                  <span className='min-w-0 flex-1 truncate font-mono'>{m.modelName}</span>
                  <span className='shrink-0 text-muted-foreground'>
                    {formatNumber(m.score, locale)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <div className='space-y-1.5'>
        <div className='flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground'>
          <span>
            {t('{{count}} models total', { count: props.total })} ·{' '}
            {t('rated on this page {{count}}', {
              count: props.items.filter((m) => (m[meta.scoreField] ?? 0) > 0).length,
            })}
          </span>
          <span>{t('Tier cannot be edited directly; it is computed from score and thresholds')}</span>
        </div>
        {props.items.map((item) => (
          <ScoreRow
            key={item.id}
            item={item}
            dimension={props.dimension}
            thresholds={props.thresholds}
            locale={locale}
            onSave={saveScore}
          />
        ))}
        {props.items.length === 0 && (
          <p className='py-10 text-center text-sm text-muted-foreground'>{t('No models')}</p>
        )}
        {totalPages > 1 && (
          <div className='flex items-center justify-between pt-3 text-xs text-muted-foreground'>
            <span>
              {t('Page {{page}} / {{total}}', { page: props.page, total: totalPages })}
            </span>
            <div className='flex items-center gap-1.5'>
              <Button
                size='sm'
                variant='outline'
                disabled={props.page <= 1}
                onClick={() => props.onPageChange(props.page - 1)}
              >
                {t('Previous')}
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={props.page >= totalPages}
                onClick={() => props.onPageChange(props.page + 1)}
              >
                {t('Next')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}