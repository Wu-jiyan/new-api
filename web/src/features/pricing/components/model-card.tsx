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
import { ChevronRight, Copy, Lock, Play, Sparkles } from 'lucide-react'
import { memo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'

import type { CharacterView } from '@/features/character/types'
import { StoryPlayer } from '@/features/character/components/story-player'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import { DEFAULT_TOKEN_UNIT } from '../constants'
import {
  getCardExamplePrice,
  getDynamicDisplayGroupRatio,
  getDynamicPriceUnitLabelKey,
  getDynamicPricingSummary,
  isUnconfiguredTaskUsageModel,
} from '../lib/dynamic-price'
import { getTaskNumberFields } from '../lib/task-expr'
import { parseTags } from '../lib/filters'
import { isTokenBasedModel } from '../lib/model-helpers'
import { formatPrice, formatRequestPrice } from '../lib/price'
import type { PricingModel, TokenUnit } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'
import { ModelPerfBadge, type ModelPerfBadgeData } from './model-perf-badge'
import { RatingBadge } from './rating-badge'

export interface ModelCardProps {
  model: PricingModel
  onClick: () => void
  priceRate?: number
  usdExchangeRate?: number
  tokenUnit?: TokenUnit
  showRechargePrice?: boolean
  selectedGroup?: string
  perf?: ModelPerfBadgeData
  character?: CharacterView
}

export const ModelCard = memo(function ModelCard(props: ModelCardProps) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const navigate = useNavigate()
  const [storyOpen, setStoryOpen] = useState(false)
  const tokenUnit = props.tokenUnit ?? DEFAULT_TOKEN_UNIT
  const priceRate = props.priceRate ?? 1
  const usdExchangeRate = props.usdExchangeRate ?? 1
  const showRechargePrice = props.showRechargePrice ?? false
  const isTokenBased = isTokenBasedModel(props.model)
  const tokenUnitLabel = tokenUnit === 'K' ? '1K' : '1M'
  const tags = parseTags(props.model.tags)
  const groups = props.model.enable_groups || []
  const endpoints = props.model.supported_endpoint_types || []
  const modelIconKey = props.model.icon || props.model.vendor_icon
  const modelIcon = modelIconKey ? getLobeIcon(modelIconKey, 28) : null
  const initial = props.model.model_name?.charAt(0).toUpperCase() || '?'
  const isDynamicPricing =
    props.model.billing_mode === 'tiered_expr' &&
    Boolean(props.model.billing_expr)
  const isUnconfiguredTaskUsage = isUnconfiguredTaskUsageModel(props.model)
  const hasCachedPrice = isTokenBased && props.model.cache_ratio != null
  const character = props.character
  const stage0Image = character?.stages?.[0]?.image_url
  const stage0Silhouette = character?.stages?.[0]?.silhouette_url
  const showPortrait = Boolean(
    character &&
      character.max_stage >= 0 &&
      character.total_calls >= 1 &&
      stage0Image
  )
  const showSilhouette = Boolean(character && !showPortrait)
  const portraitUrl = showPortrait
    ? character?.stages?.[character.max_stage]?.image_url || stage0Image
    : stage0Silhouette
  const dynamicPriceOptions = {
    tokenUnit,
    showRechargePrice,
    priceRate,
    usdExchangeRate,
    groupRatioMultiplier: getDynamicDisplayGroupRatio(
      props.model,
      props.selectedGroup
    ),
  }
  const dynamicSummary = isDynamicPricing
    ? getDynamicPricingSummary(props.model, dynamicPriceOptions)
    : null
  const cardExamplePrice = getCardExamplePrice(
    props.model,
    dynamicPriceOptions
  )
  const showTaskFieldLabels =
    getTaskNumberFields(props.model.billing_usage_schema).length > 1

  const primaryGroup = groups[0]
  const bottomTags = [...endpoints.slice(0, 2), ...tags.slice(0, 2)]
  const hiddenCount =
    Math.max(groups.length - 1, 0) +
    Math.max(endpoints.length - 2, 0) +
    Math.max(tags.length - 2, 0)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    copyToClipboard(props.model.model_name || '')
  }

  const handleCharacterClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate({
      to: '/character/$modelName',
      params: { modelName: props.model.model_name || '' },
    })
  }

  let priceSummary: ReactNode
  if (dynamicSummary) {
    if (dynamicSummary.isSpecialExpression) {
      priceSummary = (
        <span className='min-w-0'>
          <span className='text-amber-700 dark:text-amber-300'>
            {t('Special billing expression')}
          </span>
          <code className='text-muted-foreground/70 mt-0.5 line-clamp-1 block font-mono text-[11px] break-all'>
            {dynamicSummary.rawExpression}
          </code>
        </span>
      )
    } else if (dynamicSummary.primaryEntries.length > 0) {
      priceSummary = (
        <>
          {dynamicSummary.primaryEntries.map((entry) => {
            const unitLabelKey = getDynamicPriceUnitLabelKey(entry)
            let fieldPrefix: ReactNode = null
            if (entry.labelKind !== 'schema') {
              fieldPrefix = <>{t(entry.shortLabel)} </>
            } else if (showTaskFieldLabels) {
              fieldPrefix = (
                <>
                  <code className='font-mono text-[11px]'>
                    {entry.shortLabel}
                  </code>{' '}
                </>
              )
            }
            return (
              <span
                key={entry.key}
                className='text-muted-foreground whitespace-nowrap'
              >
                {fieldPrefix}
                <span className='text-foreground font-mono font-semibold'>
                  {entry.formattedRange ?? entry.formatted}
                  {unitLabelKey && <>/{t(unitLabelKey)}</>}
                </span>
              </span>
            )
          })}
          {cardExamplePrice && (
            <span className='text-muted-foreground/70 min-w-0 max-w-full truncate text-xs'>
              {cardExamplePrice.label} ≈ {cardExamplePrice.formatted}
            </span>
          )}
          {dynamicSummary.isTaskUsage &&
            dynamicSummary.tier?.label &&
            !dynamicSummary.primaryEntries.some(
              (entry) => entry.formattedRange
            ) && (
              <span className='text-muted-foreground text-xs'>
                ({dynamicSummary.tier.label})
              </span>
            )}
        </>
      )
    } else {
      priceSummary = (
        <span className='text-muted-foreground text-sm'>
          {t('Dynamic Pricing')}
        </span>
      )
    }
  } else if (isUnconfiguredTaskUsage) {
    priceSummary = (
      <span className='text-muted-foreground text-sm'>
        {t('Usage-based billing · price not configured')}
      </span>
    )
  } else if (isTokenBased) {
    priceSummary = (
      <>
        <span className='text-muted-foreground whitespace-nowrap'>
          {t('Input')}{' '}
          <span className='text-foreground font-mono font-semibold'>
            {formatPrice(
              props.model,
              'input',
              tokenUnit,
              showRechargePrice,
              priceRate,
              usdExchangeRate,
              props.selectedGroup
            )}
          </span>
        </span>
        <span className='text-muted-foreground whitespace-nowrap'>
          {t('Output')}{' '}
          <span className='text-foreground font-mono font-semibold'>
            {formatPrice(
              props.model,
              'output',
              tokenUnit,
              showRechargePrice,
              priceRate,
              usdExchangeRate,
              props.selectedGroup
            )}
          </span>
        </span>
        {hasCachedPrice && (
          <span className='text-muted-foreground whitespace-nowrap'>
            {t('Cached')}{' '}
            <span className='text-foreground font-mono font-semibold'>
              {formatPrice(
                props.model,
                'cache',
                tokenUnit,
                showRechargePrice,
                priceRate,
                usdExchangeRate,
                props.selectedGroup
              )}
            </span>
          </span>
        )}
      </>
    )
  } else {
    priceSummary = (
      <span className='text-muted-foreground whitespace-nowrap'>
        <span className='text-foreground font-mono font-semibold'>
          {formatRequestPrice(
            props.model,
            showRechargePrice,
            priceRate,
            usdExchangeRate,
            props.selectedGroup
          )}
        </span>{' '}
        / {t('request')}
      </span>
    )
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border p-3 transition-colors sm:p-5',
        'hover:bg-muted/20'
      )}
    >
      {/* Character portrait / silhouette background */}
      {showPortrait && portraitUrl && (
        <div className='pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]'>
          <img
            src={portraitUrl}
            alt=''
            className='absolute inset-y-0 right-0 h-full w-2/5 object-cover object-top opacity-70'
            style={{
              maskImage: 'linear-gradient(to left, black 30%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to left, black 30%, transparent 100%)',
            }}
          />
          <div className='absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-transparent' />
        </div>
      )}
      {showSilhouette && (
        <div className='pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]'>
          {stage0Silhouette ? (
            <>
              <img
                src={stage0Silhouette}
                alt=''
                className='absolute inset-y-0 right-0 h-full w-2/5 object-cover object-top opacity-60'
                style={{
                  maskImage:
                    'linear-gradient(to left, black 30%, transparent 100%)',
                  WebkitMaskImage:
                    'linear-gradient(to left, black 30%, transparent 100%)',
                }}
              />
              <div className='absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-transparent' />
            </>
          ) : (
            <div className='absolute inset-0 flex items-end justify-end p-3'>
              <div className='relative h-3/4 w-2/5'>
                <div
                  className='bg-muted-foreground/10 absolute inset-0 rounded-t-full'
                  style={{
                    maskImage:
                      'radial-gradient(ellipse at center, black, transparent)',
                    WebkitMaskImage:
                      'radial-gradient(ellipse at center, black, transparent)',
                  }}
                />
              </div>
            </div>
          )}
          <div className='text-muted-foreground absolute right-2 bottom-2 flex items-center gap-1 rounded-full border bg-background/70 px-2 py-0.5 text-[11px]'>
            <Lock className='h-3 w-3' />
            {t('character.unlockHint')}
          </div>
        </div>
      )}

      {/* Header: icon + name + price + actions */}
      <div className='relative flex items-start justify-between gap-2.5 sm:gap-3'>
        <div className='flex min-w-0 items-start gap-2.5 sm:gap-3'>
          <div className='bg-muted/40 flex size-9 shrink-0 items-center justify-center rounded-lg sm:size-10 sm:rounded-xl'>
            {modelIcon || (
              <span className='text-muted-foreground text-sm font-bold'>
                {initial}
              </span>
            )}
          </div>
          <div className='min-w-0'>
            <div className='flex items-center gap-1.5'>
              <h3 className='text-foreground truncate font-mono text-[15px] leading-tight font-bold'>
                {props.model.model_name}
              </h3>
              <RatingBadge rating={props.model.rating} className='shrink-0' />
            </div>
            <div className='mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm sm:mt-1 sm:gap-x-3'>
              {priceSummary}
            </div>
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-1.5'>
          {character && (
            <button
              type='button'
              onClick={handleCharacterClick}
              className='text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors sm:px-2.5 sm:py-1.5'
            >
              <Sparkles className='size-3.5' />
              {t('character.entry')}
            </button>
          )}
          {showPortrait && character && (
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                setStoryOpen(true)
              }}
              className='text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors sm:px-2.5 sm:py-1.5'
            >
              <Play className='size-3.5' />
              {t('character.story.enter')}
            </button>
          )}
          <button
            type='button'
            onClick={props.onClick}
            className='text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors sm:px-2.5 sm:py-1.5'
          >
            {t('Details')}
            <ChevronRight className='size-3.5' />
          </button>
          <button
            type='button'
            onClick={handleCopy}
            className='text-muted-foreground hover:text-foreground hover:bg-muted rounded-md border p-1.5 transition-colors'
            title={t('Copy')}
          >
            <Copy className='size-3.5' />
          </button>
        </div>
      </div>

      {/* Description */}
      <p className='text-muted-foreground relative mt-2 line-clamp-1 flex-1 text-[13px] leading-relaxed sm:mt-4 sm:line-clamp-2 sm:min-h-[2.5rem]'>
        {props.model.description || t('No description available.')}
      </p>

      {/* Footer: left metadata and right performance summary share row alignment */}
      <div className='relative mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 sm:mt-4'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          {primaryGroup && (
            <span className='text-muted-foreground text-sm font-medium'>
              {primaryGroup}
            </span>
          )}
          <ModelBillingModeBadge model={props.model} />
        </div>
        <ModelPerfBadge perf={props.perf} className='row-span-2 self-start' />

        <div className='flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 sm:gap-x-3 sm:gap-y-1'>
          {bottomTags.map((item) => (
            <span key={item} className='text-muted-foreground/70 text-xs'>
              {item}
            </span>
          ))}
          {!dynamicSummary?.isTaskUsage && !isUnconfiguredTaskUsage && (
            <span className='text-muted-foreground/50 text-xs'>
              {tokenUnitLabel}
            </span>
          )}
          {hiddenCount > 0 && (
            <span className='text-muted-foreground/40 text-xs'>
              +{hiddenCount}
            </span>
          )}
        </div>
      </div>

      {character && (
        <StoryPlayer open={storyOpen} onOpenChange={setStoryOpen} character={character} />
      )}
    </div>
  )
})
