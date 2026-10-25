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
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, Lock, Play, Sparkles } from 'lucide-react'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { StoryPlayer } from '@/features/character/components/story-player'
import type { CharacterView } from '@/features/character/types'
import { toIntlLocale } from '@/i18n/languages'
import { catalogModalityLabelKey } from '@/lib/catalog-modalities'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { DEFAULT_TOKEN_UNIT } from '../constants'
import { useBillingTime } from '../hooks/use-billing-time'
import {
  collectModalities,
  formatCatalogTokenCount,
} from '../lib/catalog-metadata'
import {
  getCardExamplePrice,
  getDynamicDisplayGroupRatio,
  getDynamicPriceUnitLabelKey,
  getDynamicPricingSummary,
  isUnconfiguredTaskUsageModel,
} from '../lib/dynamic-price'
import { parseTags } from '../lib/filters'
import {
  getDisplayGroupForcedPrice,
  isTokenBasedModel,
} from '../lib/model-helpers'
import {
  computeModelDiscount,
  type OriginalPriceContext,
} from '../lib/original-price'
import { formatPrice, formatRequestPrice } from '../lib/price'
import {
  DEFAULT_SCORE_DIMENSION,
  tierForDimension,
  type ScoreDimension,
} from '../lib/scores'
import { taskPriceLabel, taskUsageUnitLabel } from '../lib/task-price-display'
import type { PricingModel, PriceType, TokenUnit } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'
import { ModelPerfBadge, type ModelPerfBadgeData } from './model-perf-badge'
import { ModelScores } from './model-scores'
import {
  OriginalPriceBadge,
  OriginalPriceSummary,
} from './original-price-display'
import { RatingBadge } from './rating-badge'
import { TokenCountValue } from './token-count-value'

export interface ModelCardProps {
  model: PricingModel
  onClick: (modelName: string) => void
  priceRate?: number
  usdExchangeRate?: number
  tokenUnit?: TokenUnit
  showRechargePrice?: boolean
  selectedGroup?: string
  /** Groups that charge one flat USD price per request instead of a model price */
  groupForcedPrice?: Record<string, number>
  perf?: ModelPerfBadgeData
  character?: CharacterView
  /** Selected score dimension: drives the tier badge and highlights one score */
  dimension?: ScoreDimension
  /**
   * Original-price scope. Present only when the visitor asked for it and the
   * site enabled the feature; undefined renders no badge at all.
   */
  originalPrice?: OriginalPriceContext
}

export const ModelCard = memo(function ModelCard(props: ModelCardProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [storyOpen, setStoryOpen] = useState(false)
  const tokenUnit = props.tokenUnit ?? DEFAULT_TOKEN_UNIT
  const priceRate = props.priceRate ?? 1
  const usdExchangeRate = props.usdExchangeRate ?? 1
  const showRechargePrice = props.showRechargePrice ?? false
  const dimension = props.dimension ?? DEFAULT_SCORE_DIMENSION
  const isTokenBased = isTokenBasedModel(props.model)
  const tokenUnitLabel = tokenUnit === 'K' ? '1K' : '1M'
  const tags = parseTags(props.model.tags)
  const groups = props.model.enable_groups || []
  const endpoints = props.model.supported_endpoint_types || []
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const contextLabel = formatCatalogTokenCount(
    props.model.context_length,
    locale
  )
  const modalities = collectModalities(props.model)
  const modelIconKey = props.model.icon || props.model.vendor_icon
  const modelIcon = modelIconKey ? getLobeIcon(modelIconKey, 28) : null
  const initial = props.model.model_name?.charAt(0).toUpperCase() || '?'
  const isUnconfiguredTaskUsage = isUnconfiguredTaskUsageModel(props.model)
  const billingTime = useBillingTime(props.model.billing_expr)
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

  const currency = useSystemConfigStore((state) => state.config.currency)
  const dynamicPriceOptions = useMemo(
    () => ({
      now: billingTime === undefined ? undefined : new Date(billingTime),
      tokenUnit,
      showRechargePrice,
      priceRate,
      usdExchangeRate,
      groupRatioMultiplier: getDynamicDisplayGroupRatio(
        props.model,
        props.selectedGroup
      ),
    }),
    [
      props.model,
      props.selectedGroup,
      billingTime,
      tokenUnit,
      showRechargePrice,
      priceRate,
      usdExchangeRate,
    ]
  )
  const dynamicSummary = useMemo(
    () => getDynamicPricingSummary(props.model, dynamicPriceOptions),
    // Currency is read indirectly by the price formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.model, dynamicPriceOptions, currency]
  )
  const cardExamplePrice = useMemo(
    () => getCardExamplePrice(props.model, dynamicPriceOptions),
    // Currency is read indirectly by the price formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.model, dynamicPriceOptions, currency]
  )
  const originalDiscount = useMemo(
    () =>
      props.originalPrice
        ? computeModelDiscount(props.model, props.originalPrice)
        : null,
    [props.model, props.originalPrice]
  )
  let priceSummary: ReactNode
  if (dynamicSummary) {
    const cacheReadEntries = dynamicSummary.secondaryEntries.filter(
      (entry) => entry.field === 'cacheReadPrice' && entry.unit === 'token'
    )
    if (dynamicSummary.isSpecialExpression) {
      priceSummary = (
        <div className='col-span-full min-w-0'>
          <span className='text-warning'>
            {t('Special billing expression')}
          </span>
          <code className='text-muted-foreground mt-1 line-clamp-2 block font-mono text-xs break-all'>
            {dynamicSummary.rawExpression}
          </code>
        </div>
      )
    } else if (
      dynamicSummary.primaryEntries.length > 0 ||
      cacheReadEntries.length > 0
    ) {
      priceSummary = (
        <>
          {[
            dynamicSummary.primaryEntries.slice(
              0,
              dynamicSummary.providerCount ? 2 : undefined
            ),
            cacheReadEntries,
          ]
            .flat()
            .map((entry) => {
              const unitLabelKey = getDynamicPriceUnitLabelKey(entry)
              const unitLabel = taskUsageUnitLabel(
                entry,
                i18n.language,
                unitLabelKey ? t(unitLabelKey) : tokenUnitLabel
              )
              let label: ReactNode = null
              if (entry.labelKind !== 'schema') {
                label = t(entry.shortLabel)
              } else {
                label = taskPriceLabel(
                  entry.description,
                  entry.shortLabel,
                  i18n.language
                )
              }
              return (
                <div
                  key={entry.key}
                  className={cn(
                    'flex min-w-0 flex-col gap-1',
                    dynamicSummary.isTaskUsage && 'col-span-full'
                  )}
                >
                  {label && (
                    <span className='text-muted-foreground text-xs break-words whitespace-normal'>
                      {label}
                    </span>
                  )}
                  <span className='flex flex-wrap items-baseline gap-x-1 font-mono text-sm font-semibold tabular-nums'>
                    <span>{entry.formattedRange ?? entry.formatted}</span>
                    <span className='text-muted-foreground text-xs font-normal whitespace-nowrap'>
                      {' '}
                      / {unitLabel}
                    </span>
                  </span>
                </div>
              )
            })}
          {dynamicSummary.isTimePricing && (
            <span className='text-muted-foreground col-span-full text-xs'>
              {t('Current period price')}
            </span>
          )}
          {dynamicSummary.isMixedBilling && (
            <span className='text-muted-foreground col-span-full text-xs'>
              {t('Token or per-call pricing')}
            </span>
          )}
          {cardExamplePrice && (
            <span className='text-muted-foreground col-span-full text-xs break-words'>
              {cardExamplePrice.label} ≈ {cardExamplePrice.formatted}
            </span>
          )}
          {dynamicSummary.isTaskUsage &&
            dynamicSummary.tierCount > 1 &&
            dynamicSummary.tier?.label &&
            !dynamicSummary.primaryEntries.some(
              (entry) => entry.formattedRange
            ) && (
              <span className='text-muted-foreground col-span-full text-xs break-words'>
                ({dynamicSummary.tier.label})
              </span>
            )}
        </>
      )
    } else {
      priceSummary = (
        <span className='text-muted-foreground col-span-full'>
          {dynamicSummary.hasUnconfiguredProviders
            ? t('Usage-based billing · price not configured')
            : t('Dynamic Pricing')}
        </span>
      )
    }
  } else if (isUnconfiguredTaskUsage) {
    priceSummary = (
      <span className='text-muted-foreground col-span-full'>
        {t('Usage-based billing · price not configured')}
      </span>
    )
  } else if (isTokenBased) {
    const prices: { type: PriceType; label: string }[] = [
      { type: 'input', label: t('Input') },
      { type: 'output', label: t('Output') },
      ...(props.model.cache_ratio != null
        ? [{ type: 'cache' as const, label: t('Cached') }]
        : []),
    ]
    priceSummary = prices.map((price) => (
      <div key={price.type} className='flex min-w-0 flex-col gap-1'>
        <span className='text-muted-foreground text-xs'>{price.label}</span>
        <span className='font-mono text-sm font-semibold tabular-nums'>
          {formatPrice(
            props.model,
            price.type,
            tokenUnit,
            showRechargePrice,
            priceRate,
            usdExchangeRate,
            props.selectedGroup
          )}
          <span className='text-muted-foreground text-xs font-normal'>
            {' '}
            / {tokenUnitLabel}
          </span>
        </span>
      </div>
    ))
  } else {
    priceSummary = (
      <div className='col-span-full flex min-w-0 flex-col gap-1'>
        <span className='font-mono text-sm font-semibold tabular-nums'>
          {formatRequestPrice(
            props.model,
            showRechargePrice,
            priceRate,
            usdExchangeRate,
            props.selectedGroup
          )}
          <span className='text-muted-foreground text-xs font-normal'>
            {' '}
            / {t('request')}
          </span>
        </span>
      </div>
    )
  }

  // A forced-price group replaces model pricing entirely, so every per-token
  // figure above would quote a price nobody is charged.
  const forcedPrice = getDisplayGroupForcedPrice(
    props.model,
    props.groupForcedPrice,
    props.selectedGroup
  )
  if (forcedPrice !== undefined) {
    const displayPrice = showRechargePrice
      ? (forcedPrice * priceRate) / usdExchangeRate
      : forcedPrice
    priceSummary = (
      <div className='col-span-full flex min-w-0 flex-col gap-1'>
        <span className='text-muted-foreground text-xs'>{t('Price')}</span>
        <span className='font-mono text-sm font-semibold tabular-nums'>
          {formatBillingCurrencyFromUSD(displayPrice, {
            digitsLarge: 4,
            digitsSmall: 6,
            abbreviate: false,
          })}
          <span className='text-muted-foreground text-xs font-normal'>
            {' '}
            / {t('request')}
          </span>
        </span>
      </div>
    )
  }

  const handleCharacterClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate({
      to: '/character/$modelName',
      params: { modelName: props.model.model_name || '' },
    })
  }

  return (
    <Card className='hover:ring-foreground/20 relative h-full min-w-0 gap-3 overflow-hidden transition-colors'>
      {/* Character portrait / silhouette background */}
      {showPortrait && portraitUrl && (
        <div className='pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]'>
          <img
            src={portraitUrl}
            alt=''
            className='absolute inset-y-0 right-0 h-full w-2/5 object-cover object-top opacity-70'
            style={{
              maskImage:
                'linear-gradient(to left, black 30%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to left, black 30%, transparent 100%)',
            }}
          />
          <div className='from-background/95 via-background/70 absolute inset-0 bg-gradient-to-r to-transparent' />
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
              <div className='from-background/95 via-background/70 absolute inset-0 bg-gradient-to-r to-transparent' />
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
          <div className='text-muted-foreground bg-background/70 absolute right-2 bottom-2 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]'>
            <Lock className='h-3 w-3' />
            {t('character.unlockHint')}
          </div>
        </div>
      )}

      <CardHeader className='relative flex flex-row items-start gap-3'>
        <div
          aria-hidden
          className='bg-muted/50 flex size-10 shrink-0 items-center justify-center rounded-lg'
        >
          {modelIcon || (
            <span className='text-muted-foreground text-sm font-bold'>
              {initial}
            </span>
          )}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1.5'>
            <h3
              className='line-clamp-2 font-mono text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]'
              title={props.model.model_name}
            >
              {props.model.model_name}
            </h3>
            <RatingBadge
              rating={tierForDimension(props.model, dimension)}
              className='shrink-0'
            />
          </div>
          {props.model.vendor_name && (
            <p
              className='text-muted-foreground mt-1 truncate text-xs'
              title={props.model.vendor_name}
            >
              {props.model.vendor_name}
            </p>
          )}
        </div>
        <CopyButton
          value={props.model.model_name}
          tooltip={t('Copy model name')}
          className='size-7'
          iconClassName='size-3.5'
        />
      </CardHeader>
      <CardContent className='relative flex flex-1 flex-col gap-3'>
        <ModelScores model={props.model} dimension={dimension} />
        <div className='flex min-w-0 flex-col gap-1.5'>
          <p className='text-muted-foreground line-clamp-2 text-[13px] leading-5 break-words'>
            {props.model.description || t('No description available.')}
          </p>
          {tags.length > 0 && (
            <div
              role='group'
              aria-label={t('Tags')}
              className='text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-xs'
            >
              <span className='shrink-0'>{t('Tags')}</span>
              <span className='truncate' title={tags.join(', ')}>
                {tags.slice(0, 2).join(', ')}
              </span>
              {tags.length > 2 && (
                <span className='shrink-0' title={tags.slice(2).join(', ')}>
                  +{tags.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
        <div
          role='group'
          aria-label={t('Pricing')}
          className='mt-auto flex min-w-0 flex-col gap-1.5'
        >
          <ModelBillingModeBadge model={props.model} appearance='caption' />
          {dynamicSummary?.providerCount && (
            <span className='text-muted-foreground text-xs break-words'>
              {t('{{count}} providers', {
                count: dynamicSummary.providerCount,
              })}
              {dynamicSummary.hasUnconfiguredProviders &&
                ` · ${t('Not configured for some providers')}`}
            </span>
          )}
          <div className='grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-x-3 gap-y-2'>
            {priceSummary}
          </div>
          {originalDiscount && props.originalPrice && (
            <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
              <OriginalPriceBadge discount={originalDiscount} />
              <OriginalPriceSummary
                model={props.model}
                context={props.originalPrice}
                tokenUnitLabel={tokenUnitLabel}
                level={originalDiscount.offPeak ? 'off_peak' : 'standard'}
              />
            </div>
          )}
        </div>
        {(groups.length > 0 ||
          endpoints.length > 0 ||
          contextLabel !== '' ||
          modalities.length > 0) && (
          <dl
            className={cn(
              'grid min-w-0 grid-cols-2 gap-3 text-xs',
              (groups.length === 0 || endpoints.length === 0) && 'grid-cols-1'
            )}
          >
            {groups.length > 0 && (
              <div className='flex min-w-0 items-baseline gap-1.5'>
                <dt className='text-muted-foreground shrink-0'>
                  {t('Groups')}
                </dt>
                <dd className='flex min-w-0 items-baseline gap-1'>
                  <span className='truncate' title={groups.join(', ')}>
                    {groups[0]}
                  </span>
                  {groups.length > 1 && (
                    <span
                      className='text-muted-foreground shrink-0'
                      title={groups.slice(1).join(', ')}
                    >
                      +{groups.length - 1}
                    </span>
                  )}
                </dd>
              </div>
            )}
            {endpoints.length > 0 && (
              <div className='flex min-w-0 items-baseline gap-1.5'>
                <dt className='text-muted-foreground shrink-0'>
                  {t('Endpoints')}
                </dt>
                <dd className='flex min-w-0 items-baseline gap-1'>
                  <span className='truncate' title={endpoints.join(', ')}>
                    {endpoints.slice(0, 2).join(', ')}
                  </span>
                  {endpoints.length > 2 && (
                    <span
                      className='text-muted-foreground shrink-0'
                      title={endpoints.slice(2).join(', ')}
                    >
                      +{endpoints.length - 2}
                    </span>
                  )}
                </dd>
              </div>
            )}
            {contextLabel !== '' && (
              <div className='flex min-w-0 items-baseline gap-1.5'>
                <dt className='text-muted-foreground shrink-0'>
                  {t('Context')}
                </dt>
                <dd className='min-w-0 truncate'>
                  <TokenCountValue tokens={props.model.context_length} />
                </dd>
              </div>
            )}
            {modalities.length > 0 && (
              <div className='flex min-w-0 items-baseline gap-1.5'>
                <dt className='text-muted-foreground shrink-0'>
                  {t('Modalities')}
                </dt>
                <dd
                  className='min-w-0 truncate'
                  title={modalities
                    .map((m) => t(catalogModalityLabelKey(m)))
                    .join(', ')}
                >
                  {modalities
                    .slice(0, 3)
                    .map((m) => t(catalogModalityLabelKey(m)))
                    .join(', ')}
                  {modalities.length > 3 && ` +${modalities.length - 3}`}
                </dd>
              </div>
            )}
          </dl>
        )}
      </CardContent>
      <CardFooter className='relative mt-auto border-0 bg-transparent pt-0'>
        <ModelPerfBadge
          perf={props.perf}
          className='border-border/60 border-t pt-2'
        >
          <div className='flex shrink-0 items-center gap-1.5'>
            {character && (
              <Button
                variant='outline'
                size='sm'
                onClick={handleCharacterClick}
                className='gap-1'
              >
                <Sparkles aria-hidden className='size-3.5' />
                {t('character.entry')}
              </Button>
            )}
            {character && showPortrait && (
              <Button
                variant='outline'
                size='sm'
                onClick={(e) => {
                  e.stopPropagation()
                  setStoryOpen(true)
                }}
                className='gap-1'
              >
                <Play aria-hidden className='size-3.5' />
                {t('character.story.enter')}
              </Button>
            )}
            <Button
              variant='ghost'
              size='sm'
              onClick={() => props.onClick(props.model.model_name || '')}
            >
              {t('Details')}
              <ChevronRight aria-hidden className='size-3.5' />
            </Button>
          </div>
        </ModelPerfBadge>
      </CardFooter>

      {character && (
        <StoryPlayer
          open={storyOpen}
          onOpenChange={setStoryOpen}
          character={character}
        />
      )}
    </Card>
  )
})
