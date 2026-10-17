import { ExternalLink, KeyRound, Settings2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { getSortLabels, SORT_OPTIONS } from '@/features/pricing/constants'
import { toIntlLocale } from '@/i18n/languages'

import {
  getSquareDefaults,
  updateAASettings,
  updateSquareDefaults,
} from '../api'
import {
  DEFAULT_SQUARE_DEFAULTS,
  DEFAULT_SQUARE_FILTER,
  DIMENSION_META,
  RATING_DIMENSIONS,
  SQUARE_FILTER_VISIBLE_OPTIONS_RANGE,
} from '../constants'
import type { AASyncStatus, RatingDimension } from '../types'

const AA_ATTRIBUTION_URL = 'https://artificialanalysis.ai/'

function SquareDefaultsCard(props: { onChanged: () => void }) {
  const { t } = useTranslation()
  const [sort, setSort] = useState<string | undefined>()
  const [dimension, setDimension] = useState<RatingDimension | undefined>()
  const [collapsible, setCollapsible] = useState<boolean | undefined>()
  const [visibleOptions, setVisibleOptions] = useState<number | undefined>()
  const [saving, setSaving] = useState(false)
  const sortLabels = getSortLabels(t)

  // 配置加载完成前禁用控件，避免让人以为改了却没保存。
  const loaded =
    sort !== undefined &&
    dimension !== undefined &&
    collapsible !== undefined &&
    visibleOptions !== undefined

  const visibleOptionsInRange =
    visibleOptions !== undefined &&
    visibleOptions >= SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.min &&
    visibleOptions <= SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.max

  const dirty =
    loaded &&
    (sort !== DEFAULT_SQUARE_DEFAULTS.sort ||
      dimension !== DEFAULT_SQUARE_DEFAULTS.dimension ||
      collapsible !== DEFAULT_SQUARE_FILTER.collapsible ||
      visibleOptions !== DEFAULT_SQUARE_FILTER.visibleOptions)

  useEffect(() => {
    let cancelled = false
    getSquareDefaults()
      .then((res) => {
        if (cancelled || !res.defaults) return
        setSort(res.defaults.sort)
        setDimension(res.defaults.dimension)
        setCollapsible(
          res.filter?.collapsible ?? DEFAULT_SQUARE_FILTER.collapsible
        )
        // 0 不在合法区间内（后端最小 1），所以越界值按「未配置」回落默认，
        // 而不是把一个不可能生效的数字当成有效配置显示出来。
        const stored = res.filter?.visible_options
        setVisibleOptions(
          typeof stored === 'number' &&
            Number.isFinite(stored) &&
            stored >= SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.min &&
            stored <= SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.max
            ? stored
            : DEFAULT_SQUARE_FILTER.visibleOptions
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : t('Load failed'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [t])

  async function save() {
    if (
      sort === undefined ||
      dimension === undefined ||
      collapsible === undefined ||
      visibleOptions === undefined ||
      visibleOptions < SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.min ||
      visibleOptions > SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.max
    ) {
      return
    }
    setSaving(true)
    try {
      await updateSquareDefaults(
        { sort, dimension },
        { collapsible, visible_options: visibleOptions }
      )
      toast.success(t('Model square defaults updated'))
      props.onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Update failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className='p-4'>
      <div className='flex items-center gap-2 text-sm font-semibold'>
        <Settings2 className='size-4' />
        {t('Model square defaults')}
      </div>
      <p className='text-muted-foreground mt-1 text-xs'>
        {t(
          'Applied when a visitor opens the model square without a sort or dimension in the URL. Visitors can still switch afterwards; their choice wins and is kept in the link.'
        )}
      </p>
      <p className='text-muted-foreground mt-1 text-xs'>
        {t(
          'Long filter lists in the sidebar show only the first options; visitors expand them to see the rest.'
        )}
      </p>
      <div className='mt-3 flex flex-wrap items-end gap-3'>
        <div className='flex min-w-48 flex-col gap-1'>
          <Label htmlFor='square-default-sort'>{t('Default sort')}</Label>
          <Select
            id='square-default-sort'
            // Base UI 的 SelectValue 依赖 Root 上的 items 解析当前项文案，
            // 缺失时下拉框会渲染成空白，所以这里必须和选项列表保持一致。
            items={Object.values(SORT_OPTIONS).map((value) => ({
              value,
              label: sortLabels[value],
            }))}
            value={sort ?? ''}
            disabled={sort === undefined}
            onValueChange={(value) => setSort(value ?? undefined)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue placeholder={t('Loading')} />
            </SelectTrigger>
            <SelectContent>
              {Object.values(SORT_OPTIONS).map((value) => (
                <SelectItem key={value} value={value}>
                  {sortLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex min-w-48 flex-col gap-1'>
          <Label htmlFor='square-default-dimension'>
            {t('Default score dimension')}
          </Label>
          <Select
            id='square-default-dimension'
            items={RATING_DIMENSIONS.map((dim) => ({
              value: dim,
              label: DIMENSION_META[dim].label,
            }))}
            value={dimension ?? ''}
            disabled={dimension === undefined}
            onValueChange={(value) => setDimension(value as RatingDimension)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue placeholder={t('Loading')} />
            </SelectTrigger>
            <SelectContent>
              {RATING_DIMENSIONS.map((dim) => (
                <SelectItem key={dim} value={dim}>
                  {DIMENSION_META[dim].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-col gap-1'>
          <Label htmlFor='square-filter-collapsible'>
            {t('Collapse long filter lists')}
          </Label>
          <div className='flex h-9 items-center gap-2'>
            <Switch
              id='square-filter-collapsible'
              checked={collapsible ?? false}
              disabled={collapsible === undefined}
              onCheckedChange={(checked) => setCollapsible(checked)}
            />
            <span className='text-muted-foreground text-xs'>
              {t('Expand on demand')}
            </span>
          </div>
        </div>
        <div className='flex min-w-36 flex-col gap-1'>
          <Label htmlFor='square-filter-visible-options'>
            {t('Filter options shown first')}
          </Label>
          <Input
            id='square-filter-visible-options'
            type='number'
            inputMode='numeric'
            min={SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.min}
            max={SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.max}
            value={visibleOptions ?? ''}
            disabled={collapsible !== true}
            aria-invalid={!visibleOptionsInRange}
            onChange={(event) => {
              // 空输入保持「未填写」：0 在这里不是合法取值，不能悄悄补成 0。
              const parsed = Number.parseFloat(event.target.value)
              setVisibleOptions(Number.isFinite(parsed) ? parsed : undefined)
            }}
            className='h-9 w-28'
          />
        </div>
        <Button
          size='sm'
          disabled={saving || !dirty || !visibleOptionsInRange}
          onClick={() => void save()}
        >
          {t('Save')}
        </Button>
      </div>
      {!visibleOptionsInRange && visibleOptions !== undefined && (
        <p className='text-destructive mt-2 text-xs'>
          {t('Must be between {{min}} and {{max}}', {
            min: SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.min,
            max: SQUARE_FILTER_VISIBLE_OPTIONS_RANGE.max,
          })}
        </p>
      )}
      {dirty && (
        <p className='text-muted-foreground mt-2 text-xs'>
          {t('Unsaved changes')}
        </p>
      )}
    </Card>
  )
}

export function SettingsTab(props: { aa: AASyncStatus; onReload: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const configured = await updateAASettings(apiKey)
      setApiKey('')
      toast.success(
        configured
          ? t('Artificial Analysis API key saved')
          : t('Artificial Analysis API key cleared')
      )
      props.onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Update failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='space-y-4'>
      <SquareDefaultsCard onChanged={props.onReload} />
      <Card className='p-4'>
        <div className='flex items-center gap-2 text-sm font-semibold'>
          <KeyRound className='size-4' />
          {t('Artificial Analysis API key')}
        </div>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t(
            'Required to sync the AA Intelligence, Coding and Agentic dimensions. Stored on the server only and never returned to the browser. The free tier allows 100 requests per 24-hour window, and one daily sync uses about two.'
          )}
        </p>
        <div className='mt-3 flex flex-wrap items-end gap-2'>
          <div className='flex min-w-64 flex-1 flex-col gap-1'>
            <Label htmlFor='aa-api-key'>{t('API key')}</Label>
            <Input
              id='aa-api-key'
              type='password'
              autoComplete='off'
              placeholder={
                props.aa.api_key_set
                  ? t('Configured, enter a new key to replace')
                  : t('Not configured')
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <Button
            size='sm'
            disabled={saving || apiKey.trim() === ''}
            onClick={() => void save()}
          >
            {t('Save')}
          </Button>
          {props.aa.api_key_set && (
            <Button
              size='sm'
              variant='outline'
              disabled={saving}
              onClick={() => {
                setApiKey('')
                void updateAASettings('')
                  .then(() =>
                    toast.success(t('Artificial Analysis API key cleared'))
                  )
                  .then(() => props.onReload())
                  .catch((error: unknown) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : t('Update failed')
                    )
                  )
              }}
            >
              <Trash2 className='mr-1.5 size-4' /> {t('Clear key')}
            </Button>
          )}
        </div>
        <div className='text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs'>
          <span>
            {props.aa.api_key_set
              ? t('Status: configured')
              : t('Status: not configured')}
          </span>
          <span>
            {props.aa.last_sync_at > 0
              ? t('Last sync: {{time}} · updated {{count}}', {
                  time: new Date(props.aa.last_sync_at * 1000).toLocaleString(
                    locale
                  ),
                  count: props.aa.last_sync_num,
                })
              : t('Never synced')}
          </span>
        </div>
        {props.aa.last_error && (
          <p className='text-destructive mt-2 text-xs'>{props.aa.last_error}</p>
        )}
      </Card>

      <Card className='p-4'>
        <div className='text-sm font-semibold'>{t('Attribution')}</div>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t(
            'The Artificial Analysis free tier requires crediting the source when the data is displayed. Model scores in the model square link back to the provider.'
          )}
        </p>
        <a
          href={AA_ATTRIBUTION_URL}
          target='_blank'
          rel='noreferrer'
          className='text-primary mt-2 inline-flex items-center text-xs underline-offset-2 hover:underline'
        >
          {AA_ATTRIBUTION_URL.replace(/^https?:\/\//, '')}
          <ExternalLink className='ml-1.5 size-3.5' />
        </a>
      </Card>
    </div>
  )
}
