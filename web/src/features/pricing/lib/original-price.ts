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
import type { CurrencyDisplayType } from '@/stores/system-config-store'

import { FILTER_ALL, QUOTA_TYPE_VALUES } from '../constants'
import type { OriginalPrice, PricingModel } from '../types'
import {
  getDynamicPricingSummary,
  hasTaskUsageSchema,
  isDynamicPricingModel,
} from './dynamic-price'
import {
  getAutoChainGroups,
  getConfiguredGroupRatio,
  getGroupForcedPrice,
} from './model-helpers'
import { calculateTokenPrice } from './price'

// ----------------------------------------------------------------------------
// Original (official) price and discount
// ----------------------------------------------------------------------------
//
// The discount a visitor sees is what they actually pay divided by the model's
// official price, both expressed in the site's display currency. Getting there
// needs two different exchange rates:
//
// - the site display rate (`usd_exchange_rate`), which is what the price list
//   already uses to show system USD as CNY, and
// - the real market rate (`usd_cny_rate`), the only correct way to turn an
//   official USD price into CNY. Using the display rate there would rescale the
//   official price by the operator's recharge margin and invent a discount.

/** Candidate discounts count as "exact" when they agree this closely. */
const DISCOUNT_TOLERANCE = 0.001

/** Price type a discount was computed for. */
export type DiscountPriceType =
  | 'input'
  | 'output'
  | 'cache'
  | 'create_cache'
  | 'request'

/** How the site shows money, mirroring `formatBillingCurrencyFromUSD`. */
export type OriginalPriceDisplay = {
  mode: CurrencyDisplayType
  /**
   * Multiplier from system USD to the display currency. 1 for USD and for
   * TOKENS, because billing displays never fall back to token units.
   */
  usdFactor: number
}

/** Everything the discount math needs beyond the model itself. */
export type OriginalPriceContext = {
  display: OriginalPriceDisplay
  /** Real market CNY per USD; <= 0 while the hourly sync has no value. */
  usdCnyRate: number
  /** Group ratios of the pricing payload, keyed by group name. */
  groupRatio?: Record<string, number>
  /** Groups that charge one flat price per request instead of a model price. */
  groupForcedPrice?: Record<string, number>
  /** Group selected in the toolbar; scopes the discount to that single group. */
  selectedGroup?: string
  /** Auto Group Chain: defines what "all groups" means for the square. */
  autoGroups?: readonly string[]
}

/** Official price converted into the site's display currency. */
export type OriginalPriceAmounts = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  request?: number
}

export type ModelDiscount = {
  /**
   * Paid price / official price, rounded to the tenth of a 折 (two decimals),
   * which is the precision the label prints. Always < 1.
   */
  ratio: number
  /** Every candidate carries the same discount, so the label omits "from". */
  exact: boolean
  /** Group that produced the deepest discount. */
  group?: string
  /** Price type that produced the deepest discount. */
  priceType?: DiscountPriceType
}

type DiscountCandidate = {
  ratio: number
  group: string
  priceType: DiscountPriceType
}

/** Token price types a discount can be computed for. */
type TokenDiscountPriceType = Exclude<DiscountPriceType, 'request'>

/** Token price types and the official price field each one is compared with. */
const TOKEN_PRICE_TYPES: {
  priceType: TokenDiscountPriceType
  originalKey: keyof OriginalPriceAmounts
}[] = [
  { priceType: 'input', originalKey: 'input' },
  { priceType: 'output', originalKey: 'output' },
  { priceType: 'cache', originalKey: 'cacheRead' },
  { priceType: 'create_cache', originalKey: 'cacheWrite' },
]

/** Official amount field behind each price type, for the expression path. */
const OFFICIAL_FIELD_BY_PRICE_TYPE: Record<
  TokenDiscountPriceType,
  'input' | 'output' | 'cacheRead' | 'cacheWrite'
> = {
  input: 'input',
  output: 'output',
  cache: 'cacheRead',
  create_cache: 'cacheWrite',
}

/**
 * Build the display-currency descriptor from the site currency settings.
 *
 * CNY uses the status exchange rate, CUSTOM the custom-currency rate, and
 * TOKENS behaves like USD because billing displays are never shown in tokens.
 */
export function createOriginalPriceDisplay(config: {
  quotaDisplayType: CurrencyDisplayType
  usdExchangeRate: number
  customCurrencyExchangeRate: number
}): OriginalPriceDisplay {
  if (config.quotaDisplayType === 'CNY') {
    return { mode: 'CNY', usdFactor: config.usdExchangeRate }
  }
  if (config.quotaDisplayType === 'CUSTOM') {
    return { mode: 'CUSTOM', usdFactor: config.customCurrencyExchangeRate }
  }
  if (config.quotaDisplayType === 'TOKENS') {
    return { mode: 'TOKENS', usdFactor: 1 }
  }
  return { mode: 'USD', usdFactor: 1 }
}

/**
 * Convert an official amount into the display currency.
 *
 * Returns null when the conversion needs a market rate the sync has not
 * produced yet: a missing rate must hide the feature, never guess a number.
 */
function toDisplayCurrency(
  amount: number,
  currency: OriginalPrice['currency'],
  display: OriginalPriceDisplay,
  usdCnyRate: number
): number | null {
  // An official CNY price shown in CNY needs no rate at all.
  if (currency === 'CNY' && display.mode === 'CNY') return amount
  if (!(usdCnyRate > 0)) return null

  const amountCny = currency === 'CNY' ? amount : amount * usdCnyRate
  if (display.mode === 'CNY') return amountCny
  if (display.mode === 'CUSTOM') {
    return (amountCny / usdCnyRate) * display.usdFactor
  }
  // USD and TOKENS both display in USD.
  return amountCny / usdCnyRate
}

/**
 * Official price converted into the display currency, or null when nothing is
 * configured or a configured amount cannot be converted.
 */
export function getOriginalPriceAmounts(
  original: OriginalPrice | undefined,
  context: Pick<OriginalPriceContext, 'display' | 'usdCnyRate'>
): OriginalPriceAmounts | null {
  if (!original) return null

  const convert = (amount?: number): number | null | undefined => {
    if (amount === undefined) return undefined
    if (!Number.isFinite(amount)) return null
    return toDisplayCurrency(
      amount,
      original.currency,
      context.display,
      context.usdCnyRate
    )
  }

  const input = convert(original.input)
  const output = convert(original.output)
  const cacheRead = convert(original.cache_read)
  const cacheWrite = convert(original.cache_write)
  const request = convert(original.request)
  const values = [input, output, cacheRead, cacheWrite, request]

  if (values.every((value) => value === undefined)) return null
  // One unconvertible amount hides the whole feature: quoting the rest would
  // present a discount that was never verified.
  if (values.some((value) => value === null)) return null

  return {
    input: input ?? undefined,
    output: output ?? undefined,
    cacheRead: cacheRead ?? undefined,
    cacheWrite: cacheWrite ?? undefined,
    request: request ?? undefined,
  }
}

/** A candidate ratio, or null when the pair cannot describe a discount. */
function candidateRatio(
  paid: number,
  official: number | undefined
): number | null {
  if (official === undefined || !(official > 0)) return null
  if (!Number.isFinite(paid)) return null
  const ratio = paid / official
  return Number.isFinite(ratio) ? ratio : null
}

/**
 * Groups the discount is computed over.
 *
 * A group selected in the toolbar is the only group that matters; otherwise the
 * Auto Group Chain bounds the quote, and a model outside the chain falls back
 * to every group it is enabled in.
 */
function getDiscountGroups(
  model: PricingModel,
  context: OriginalPriceContext
): string[] {
  const enableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  const selected = context.selectedGroup
  if (selected && selected !== FILTER_ALL && enableGroups.includes(selected)) {
    return [selected]
  }

  const chain = getAutoChainGroups(model, context.autoGroups)
  if (chain.length > 0) return chain
  return enableGroups
}

/** Discount candidates one group offers for this model. */
function getGroupCandidates(
  model: PricingModel,
  group: string,
  official: OriginalPriceAmounts,
  context: OriginalPriceContext
): DiscountCandidate[] {
  // A forced price replaces model pricing, so only the flat per-request price
  // can be compared, and only with a configured per-request official price.
  const forced = getForcedPriceCandidates(group, official, context)
  if (forced) return forced

  const groupRatio = getConfiguredGroupRatio(
    context.groupRatio ?? model.group_ratio ?? {},
    group
  )

  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    const paid =
      (model.model_price ?? Number.NaN) * groupRatio * context.display.usdFactor
    const ratio = candidateRatio(paid, official.request)
    if (ratio === null) return []
    return [{ ratio, group, priceType: 'request' }]
  }

  const candidates: DiscountCandidate[] = []
  for (const entry of TOKEN_PRICE_TYPES) {
    // calculateTokenPrice already returns NaN for a price type this model does
    // not price, so no separate ratio check is needed.
    const paid =
      calculateTokenPrice(model, entry.priceType, groupRatio) *
      context.display.usdFactor
    const ratio = candidateRatio(paid, official[entry.originalKey])
    if (ratio === null) continue
    candidates.push({ ratio, group, priceType: entry.priceType })
  }
  return candidates
}

/** Flat per-request group price, or null when the group charges normal pricing. */
function getForcedPriceCandidates(
  group: string,
  official: OriginalPriceAmounts,
  context: OriginalPriceContext
): DiscountCandidate[] | null {
  const forcedPrice = getGroupForcedPrice(context.groupForcedPrice, group)
  if (forcedPrice === undefined) return null
  const ratio = candidateRatio(
    forcedPrice * context.display.usdFactor,
    official.request
  )
  return ratio === null ? [] : [{ ratio, group, priceType: 'request' }]
}

/**
 * Expression fields that describe the same price type as an official amount.
 * Cache-1h, image-input and image-output prices have no official counterpart in
 * the metadata form, so they are left out instead of being compared against a
 * different quantity.
 */
const EXPRESSION_TOKEN_FIELDS: Record<string, TokenDiscountPriceType> = {
  inputPrice: 'input',
  outputPrice: 'output',
  cacheReadPrice: 'cache',
  cacheCreatePrice: 'create_cache',
}

/**
 * Discounts for expression-priced (tiered) models.
 *
 * These models have no model_ratio; their sold price is whatever the billing
 * expression evaluates to for the currently displayed tier. The expression is
 * already per 1M tokens in system USD, so the same comparison applies after the
 * group ratio.
 */
function getExpressionCandidates(
  model: PricingModel,
  group: string,
  official: OriginalPriceAmounts,
  context: OriginalPriceContext
): DiscountCandidate[] {
  const forced = getForcedPriceCandidates(group, official, context)
  if (forced) return forced

  const summary = getDynamicPricingSummary(model, { tokenUnit: 'M' })
  if (!summary) return []
  const groupRatio = getConfiguredGroupRatio(
    context.groupRatio ?? model.group_ratio ?? {},
    group
  )
  const candidates: DiscountCandidate[] = []
  for (const entry of summary.entries) {
    let priceType: DiscountPriceType | undefined
    let officialAmount: number | undefined
    if (entry.unit === 'token') {
      priceType = EXPRESSION_TOKEN_FIELDS[entry.field]
      if (!priceType) continue
      officialAmount = official[OFFICIAL_FIELD_BY_PRICE_TYPE[priceType]]
    } else if (entry.unit === 'request' || entry.unit === 'image') {
      priceType = 'request'
      officialAmount = official.request
    } else {
      continue
    }
    const paid = entry.value * groupRatio * context.display.usdFactor
    const ratio = candidateRatio(paid, officialAmount)
    if (ratio === null) continue
    candidates.push({ ratio, group, priceType })
  }
  return candidates
}

/**
 * Deepest discount of a model in the scope the square currently shows.
 *
 * Returns null when the model has no original price, when no conversion is
 * possible, or when nothing is actually discounted (a "10折" is no discount).
 */
export function computeModelDiscount(
  model: PricingModel,
  context: OriginalPriceContext
): ModelDiscount | null {
  // Task-plugin usage prices are quoted per unit of a usage schema (seconds,
  // credits, images), not per token or per request, so the ratio math below
  // cannot describe their discount.
  if (hasTaskUsageSchema(model)) return null

  const official = getOriginalPriceAmounts(model.original_price, context)
  if (!official) return null

  // Expression-priced models quote the evaluated tier instead of model_ratio.
  const collect = isDynamicPricingModel(model)
    ? getExpressionCandidates
    : getGroupCandidates
  const candidates: DiscountCandidate[] = []
  for (const group of getDiscountGroups(model, context)) {
    candidates.push(...collect(model, group, official, context))
  }
  if (candidates.length === 0) return null

  let best = candidates[0]
  let minRatio = candidates[0].ratio
  let maxRatio = candidates[0].ratio
  for (const candidate of candidates) {
    if (candidate.ratio < best.ratio) best = candidate
    if (candidate.ratio < minRatio) minRatio = candidate.ratio
    if (candidate.ratio > maxRatio) maxRatio = candidate.ratio
  }

  // Round to the printed 折 precision (0.1折 = 1% of the official price) before
  // deciding there is no discount, so 0.996 reports nothing instead of "10折".
  const ratio = Math.round(best.ratio * 100) / 100
  if (!(ratio < 1)) return null

  return {
    ratio,
    exact: maxRatio - minRatio <= DISCOUNT_TOLERANCE,
    group: best.group,
    priceType: best.priceType,
  }
}

/**
 * Discount depth as percent off, rounded to one decimal for display.
 *
 * Kept numeric so no formatting precision leaks into the math.
 */
export function discountPercentOff(ratio: number): number {
  return Math.round((1 - ratio) * 1000) / 10
}

/**
 * The number interpolated into the discount label.
 *
 * Chinese quotes a discount as 折 (a tenth of the official price, so 0.8 reads
 * as 8折) and every other locale quotes percent off (20%). The label keys keep
 * the same `{{value}}` placeholder in every locale so the placeholder-integrity
 * check stays meaningful, which means the number itself has to be picked by the
 * interface language rather than by the translation.
 */
export function discountLabelValue(ratio: number, language: string): number {
  if (language.toLowerCase().startsWith('zh')) {
    return Math.round(ratio * 100) / 10
  }
  return discountPercentOff(ratio)
}
