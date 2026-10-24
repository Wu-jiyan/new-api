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
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatLocalCurrencyAmount } from '@/lib/currency'
import { cn } from '@/lib/utils'

import {
  discountLabelValue,
  discountPercentOff,
  getOriginalPriceAmounts,
  type ModelDiscount,
  type OriginalPriceContext,
} from '../lib/original-price'
import type { OriginalPriceCurrency, PricingModel } from '../types'

// Depth buckets. They are a display convention for how loud the pill looks, not
// data-derived thresholds. The label text stays on --foreground because
// --warning and --destructive fall below WCAG AA 4.5:1 once they sit on a
// tinted background, so the depth is carried by tint, border and weight.
const STRONG_PERCENT_OFF = 30
const MEDIUM_PERCENT_OFF = 10

const DEPTH_STYLES = {
  strong:
    'border-destructive/40 bg-destructive/10 text-foreground font-semibold',
  medium: 'border-warning/50 bg-warning/10 text-foreground',
  light: 'border-border bg-muted text-muted-foreground',
} as const

type DiscountDepth = keyof typeof DEPTH_STYLES

function depthOf(percentOff: number): DiscountDepth {
  if (percentOff >= STRONG_PERCENT_OFF) return 'strong'
  if (percentOff >= MEDIUM_PERCENT_OFF) return 'medium'
  return 'light'
}

/** Compact discount pill, with the "from" wording when the depth varies. */
export function OriginalPriceBadge(props: {
  discount: ModelDiscount
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const percentOff = discountPercentOff(props.discount.ratio)
  // Chinese prints 折, other locales print percent off; see discountLabelValue.
  const labelValue = discountLabelValue(
    props.discount.ratio,
    i18n.resolvedLanguage || i18n.language
  )
  const label = props.discount.exact
    ? t('{{value}}% off', { value: labelValue })
    : t('From {{value}}% off', { value: labelValue })

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 text-[11px] leading-none whitespace-nowrap tabular-nums',
        DEPTH_STYLES[depthOf(percentOff)],
        props.className
      )}
    >
      {label}
    </span>
  )
}

const AMOUNT_FORMAT = {
  digitsLarge: 4,
  digitsSmall: 6,
  abbreviate: false,
} as const

/**
 * The official price the badge refers to, e.g. "Original price $3 / $9 / 1M".
 *
 * Amounts arrive already converted into the display currency, so they use the
 * local-currency formatter: it applies the currency symbol without converting a
 * second time.
 */
export function OriginalPriceSummary(props: {
  model: PricingModel
  context: OriginalPriceContext
  /** Token unit the price grid quotes, e.g. 1M */
  tokenUnitLabel: string
  className?: string
}) {
  const { t } = useTranslation()
  const amounts = getOriginalPriceAmounts(
    props.model.original_price,
    props.context
  )
  if (!amounts) return null

  const tokenAmounts = [
    amounts.input,
    amounts.output,
    amounts.cacheRead,
    amounts.cacheWrite,
  ].filter((amount): amount is number => amount !== undefined)
  const quotesTokens = tokenAmounts.length > 0
  const values = quotesTokens ? tokenAmounts : []
  if (!quotesTokens && amounts.request !== undefined) {
    values.push(amounts.request)
  }
  if (values.length === 0) return null

  const unit = quotesTokens ? props.tokenUnitLabel : t('request')
  const formatted = values
    .map((amount) => formatLocalCurrencyAmount(amount, AMOUNT_FORMAT))
    .join(' / ')

  return (
    <span
      className={cn(
        'text-muted-foreground min-w-0 text-xs break-words',
        props.className
      )}
    >
      {t('Original price')} {formatted}
      {` / ${unit}`}
    </span>
  )
}

/**
 * An official amount in the currency the operator configured the model in.
 *
 * The shared currency formatters always convert to the site display currency,
 * which is the opposite of what the detail page shows here, so this is the
 * intended use of a direct Intl currency format.
 */
export function OriginalPriceAmount(props: {
  amount: number
  currency: OriginalPriceCurrency
}) {
  const { i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: props.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(props.amount) >= 1 ? 4 : 6,
  }).format(props.amount)

  return <span className='font-mono tabular-nums'>{formatted}</span>
}
