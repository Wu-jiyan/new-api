/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { ChevronDown, RotateCcw } from 'lucide-react'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { isFreeGroupRatio } from '@/lib/group-ratio'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  ENDPOINT_TYPES,
  MODEL_MODALITIES,
  FILTER_ALL,
  QUOTA_TYPES,
  RATING_TIERS,
  getEndpointTypeLabels,
  getModalityLabels,
  getQuotaTypeLabels,
} from '../constants'
import { getModelQuotaType, parseTags } from '../lib/filters'
import { sortGroups, type GroupSortMode } from '../lib/group-sort'
import { getGroupForcedPrice } from '../lib/model-helpers'
import { tierForDimension, type ScoreDimension } from '../lib/scores'
import type { PricingModel, PricingVendor } from '../types'
import { GroupSortControl } from './group-sort-control'

type FilterOption = {
  value: string
  label: string
  count?: number
  suffix?: string
  icon?: ReactNode
}

type FilterSectionProps = {
  title: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
  /** Optional control rendered above the options, e.g. a sort selector */
  action?: ReactNode
  /** 长选项列表的折叠配置：先显示前 visibleOptions 个，其余点「展开」看。 */
  collapse?: FilterCollapseConfig
}

/** 筛选侧栏的折叠展示配置，来自后台「模型广场默认设置」。 */
export type FilterCollapseConfig = {
  enabled: boolean
  /** 每个筛选组默认显示的选项个数（不是视觉行数）。 */
  visibleOptions: number
}

export interface PricingSidebarProps {
  quotaTypeFilter: string
  endpointTypeFilter: string
  modalityFilter: string
  vendorFilter: string
  groupFilter: string
  tagFilter: string
  ratingFilter: string /** Rating tiers shown here follow the selected score dimension */
  dimension: ScoreDimension
  onQuotaTypeChange: (value: string) => void
  onEndpointTypeChange: (value: string) => void
  onModalityChange: (value: string) => void
  onVendorChange: (value: string) => void
  onGroupChange: (value: string) => void
  onTagChange: (value: string) => void
  onRatingChange: (value: string) => void
  vendors: PricingVendor[]
  groups: string[]
  groupRatios?: Record<string, number>
  /** Groups that charge one flat price per request instead of a model price */
  groupForcedPrice?: Record<string, number>
  /** Automatic group chain, used by the "Auto group chain" ordering */
  autoGroups?: string[]
  groupSort: GroupSortMode
  onGroupSortChange: (value: GroupSortMode) => void
  tags: string[]
  models: PricingModel[]
  hasActiveFilters: boolean
  onClearFilters: () => void
  /** 长选项列表的折叠展示配置；缺省时不折叠。 */
  collapse?: FilterCollapseConfig
  className?: string
}

function formatGroupRatio(
  ratio: number | undefined,
  freeLabel: string
): string | undefined {
  if (ratio == null) return undefined
  if (isFreeGroupRatio(ratio)) return freeLabel
  const formatted = Number.isInteger(ratio)
    ? ratio.toString()
    : ratio.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `x${formatted}`
}

function FilterChip(props: {
  option: FilterOption
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      type='button'
      variant={props.active ? 'secondary' : 'outline'}
      size='sm'
      onClick={props.onClick}
      aria-pressed={props.active}
      className='h-auto max-w-full gap-1.5 px-2 py-1 text-xs'
      title={props.option.label}
    >
      {props.option.icon && (
        <span className='shrink-0'>{props.option.icon}</span>
      )}
      <span className='truncate'>{props.option.label}</span>
      {(props.option.suffix || props.option.count != null) && (
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 text-[12px]',
            props.active
              ? 'bg-background text-foreground'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {props.option.suffix ?? props.option.count}
        </span>
      )}
    </Button>
  )
}

function FilterSection(props: FilterSectionProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const limit = props.collapse?.visibleOptions ?? 0
  const canCollapse =
    Boolean(props.collapse?.enabled) &&
    limit > 0 &&
    props.options.length > limit

  // 折叠时必须让当前选中项保持可见，否则用户看到「筛选已生效」却找不到选中的
  // 那一项，会以为筛选坏了。
  let visibleOptions = props.options
  if (canCollapse && !expanded) {
    const head = props.options.slice(0, limit)
    const selected = props.options.find(
      (option) => option.value === props.value
    )
    visibleOptions =
      selected && !head.some((option) => option.value === selected.value)
        ? [...head, selected]
        : head
  }

  return (
    <Collapsible
      defaultOpen
      className='border-border/70 border-b pb-3 last:border-b-0'
    >
      <CollapsibleTrigger className='group flex w-full items-center justify-between py-2.5 text-left'>
        <span className='text-foreground text-sm font-semibold'>
          {props.title}
        </span>
        <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {props.action && (
          <div className='mb-2 flex justify-end'>{props.action}</div>
        )}
        <div className='flex flex-wrap gap-1.5'>
          {visibleOptions.map((option) => (
            <FilterChip
              key={option.value}
              option={option}
              active={props.value === option.value}
              onClick={() => props.onChange(option.value)}
            />
          ))}
        </div>
        {canCollapse && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            className='text-muted-foreground mt-1.5 h-auto gap-1 px-1.5 py-1 text-xs'
          >
            {expanded ? t('Show less') : t('Show more')}
            <ChevronDown
              aria-hidden
              className={cn(
                'size-3 transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export const PricingSidebar = memo(function PricingSidebar(
  props: PricingSidebarProps
) {
  const { t } = useTranslation()
  const counts = useMemo(() => {
    const vendors = new Map<string, number>()
    const tags = new Map<string, number>()
    const endpoints = new Map<string, number>()
    const ratings = new Map<string, number>()
    const quotas = { token: 0, request: 0, task: 0 }
    for (const model of props.models) {
      const tier = tierForDimension(model, props.dimension)
      if (tier) {
        ratings.set(tier, (ratings.get(tier) ?? 0) + 1)
      }
      if (model.vendor_name) {
        vendors.set(
          model.vendor_name,
          (vendors.get(model.vendor_name) ?? 0) + 1
        )
      }
      for (const tag of new Set(
        parseTags(model.tags).map((tag) => tag.toLowerCase())
      )) {
        tags.set(tag, (tags.get(tag) ?? 0) + 1)
      }
      for (const endpoint of new Set(model.supported_endpoint_types ?? [])) {
        endpoints.set(endpoint, (endpoints.get(endpoint) ?? 0) + 1)
      }
      const quotaType = getModelQuotaType(model)
      if (quotaType) quotas[quotaType]++
    }
    return { vendors, tags, endpoints, ratings, quotas }
  }, [props.models, props.dimension])
  const quotaTypeLabels = getQuotaTypeLabels(t)
  const endpointTypeLabels = getEndpointTypeLabels(t)

  const vendorOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Vendors'),
      count: props.models.length,
    },
    ...props.vendors
      .map((vendor) => ({
        value: vendor.name,
        label: vendor.name,
        count: counts.vendors.get(vendor.name) ?? 0,
        icon: vendor.icon ? getLobeIcon(vendor.icon, 14) : undefined,
      }))
      .filter((vendor) => vendor.count > 0),
  ]

  // 分组按用户选择的顺序展示；未指定时用自动分组链顺序，结果始终确定。
  const orderedGroups = sortGroups(props.groups, props.groupSort, {
    autoGroups: props.autoGroups,
    groupRatios: props.groupRatios,
  })
  const groupOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Groups'),
    },
    ...orderedGroups.map((group) => {
      const forcedPrice = getGroupForcedPrice(props.groupForcedPrice, group)
      return {
        value: group,
        label: group,
        suffix:
          forcedPrice !== undefined
            ? formatBillingCurrencyFromUSD(forcedPrice, {
                digitsLarge: 4,
                digitsSmall: 4,
                abbreviate: false,
              })
            : formatGroupRatio(props.groupRatios?.[group], t('Free of charge')),
      }
    }),
  ]

  const quotaOptions: FilterOption[] = [
    {
      value: QUOTA_TYPES.ALL,
      label: quotaTypeLabels[QUOTA_TYPES.ALL],
      count: props.models.length,
    },
    {
      value: QUOTA_TYPES.TOKEN,
      label: quotaTypeLabels[QUOTA_TYPES.TOKEN],
      count: counts.quotas.token,
    },
    {
      value: QUOTA_TYPES.REQUEST,
      label: quotaTypeLabels[QUOTA_TYPES.REQUEST],
      count: counts.quotas.request,
    },
    {
      value: QUOTA_TYPES.TASK,
      label: quotaTypeLabels[QUOTA_TYPES.TASK],
      count: counts.quotas.task,
    },
  ]

  const tagOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Tags'),
      count: props.models.length,
    },
    ...props.tags.map((tag) => ({
      value: tag,
      label: tag,
      count: counts.tags.get(tag.toLowerCase()) ?? 0,
    })),
  ]

  const endpointOptions: FilterOption[] = [
    {
      value: ENDPOINT_TYPES.ALL,
      label: endpointTypeLabels[ENDPOINT_TYPES.ALL],
      count: props.models.length,
    },
    ...Object.entries(endpointTypeLabels)
      .filter(([value]) => value !== ENDPOINT_TYPES.ALL)
      .map(([value, label]) => ({
        value,
        label,
        count: counts.endpoints.get(value) ?? 0,
      })),
  ]

  // 模态计数单独统计，避免改动主 counts memo 的内部结构。
  const modalityCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const model of props.models) {
      for (const modality of new Set([
        ...(model.input_modalities ?? []),
        ...(model.output_modalities ?? []),
      ])) {
        counts.set(modality, (counts.get(modality) ?? 0) + 1)
      }
    }
    return counts
  }, [props.models])

  const modalityTypeLabels = getModalityLabels(t)

  const modalityOptions: FilterOption[] = [
    {
      value: MODEL_MODALITIES.ALL,
      label: modalityTypeLabels[MODEL_MODALITIES.ALL],
      count: props.models.length,
    },
    ...Object.entries(modalityTypeLabels)
      .filter(([value]) => value !== MODEL_MODALITIES.ALL)
      .map(([value, label]) => ({
        value,
        label,
        count: modalityCounts.get(value) ?? 0,
      })),
  ]

  const ratingOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Ratings'),
      count: props.models.length,
    },
    ...RATING_TIERS.map((tier) => ({
      value: tier,
      label: tier,
      count: counts.ratings.get(tier) ?? 0,
    })),
  ]

  const hasAnyRating = ratingOptions.some(
    (option) => option.value !== FILTER_ALL && (option.count ?? 0) > 0
  )

  return (
    <aside className={cn('bg-card rounded-xl border p-3', props.className)}>
      <div className='mb-2.5 flex items-center justify-between gap-2'>
        <div>
          <h2 className='text-foreground text-sm font-bold'>{t('Filter')}</h2>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Refine models by provider, group, type, and tags.')}
          </p>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={props.onClearFilters}
          disabled={!props.hasActiveFilters}
          className='h-7 gap-1.5 px-2 text-xs'
        >
          <RotateCcw className='size-3.5' />
          {t('Reset')}
        </Button>
      </div>

      {props.hasActiveFilters && (
        <Badge variant='secondary' className='mb-3'>
          {t('Filters active')}
        </Badge>
      )}

      <div className='space-y-1'>
        <FilterSection
          title={t('Groups')}
          value={props.groupFilter}
          options={groupOptions}
          onChange={props.onGroupChange}
          collapse={props.collapse}
          action={
            <GroupSortControl
              value={props.groupSort}
              onChange={props.onGroupSortChange}
            />
          }
        />
        <FilterSection
          title={t('All Vendors')}
          value={props.vendorFilter}
          options={vendorOptions}
          onChange={props.onVendorChange}
          collapse={props.collapse}
        />
        <FilterSection
          title={t('Model Tags')}
          value={props.tagFilter}
          options={tagOptions}
          onChange={props.onTagChange}
          collapse={props.collapse}
        />
        <FilterSection
          title={t('Pricing Type')}
          value={props.quotaTypeFilter}
          options={quotaOptions}
          onChange={props.onQuotaTypeChange}
          collapse={props.collapse}
        />
        <FilterSection
          title={t('Endpoint Type')}
          value={props.endpointTypeFilter}
          options={endpointOptions}
          onChange={props.onEndpointTypeChange}
          collapse={props.collapse}
        />
        <FilterSection
          title={t('Modality')}
          value={props.modalityFilter}
          options={modalityOptions}
          onChange={props.onModalityChange}
          collapse={props.collapse}
        />
        {hasAnyRating && (
          <FilterSection
            title={t('Rarity')}
            value={props.ratingFilter}
            options={ratingOptions}
            onChange={props.onRatingChange}
            collapse={props.collapse}
          />
        )}
      </div>
    </aside>
  )
})
