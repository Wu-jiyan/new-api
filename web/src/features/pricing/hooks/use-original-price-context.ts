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
import { useMemo } from 'react'

import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  createOriginalPriceDisplay,
  type OriginalPriceContext,
} from '../lib/original-price'
import type { OriginalPriceSettings } from '../types'

export type OriginalPriceContextParams = {
  /** `original_price_settings` of the pricing payload */
  settings?: OriginalPriceSettings
  /** Whether this visitor currently wants the original price shown */
  visible: boolean
  /** Site display rate, as returned by `usePricingData` */
  usdExchangeRate: number
  groupRatio?: Record<string, number>
  groupForcedPrice?: Record<string, number>
  /** Group filter active in the square; scopes the discount to one group */
  selectedGroup?: string
  /** Auto Group Chain, which bounds what "all groups" means */
  autoGroups?: readonly string[]
}

/**
 * Scope object the original-price components need, or undefined when the
 * feature is off site-wide or this visitor turned it off.
 *
 * `usdExchangeRate` is the site display rate. The real market rate used to
 * convert an official USD price lives in `settings.usd_cny_rate` and is never
 * mixed with it.
 */
export function useOriginalPriceContext(
  params: OriginalPriceContextParams
): OriginalPriceContext | undefined {
  const currency = useSystemConfigStore((state) => state.config.currency)
  const settings = params.settings
  const enabled = settings?.enabled === true && params.visible

  return useMemo(() => {
    if (!enabled || !settings) return undefined
    return {
      display: createOriginalPriceDisplay({
        quotaDisplayType: currency.quotaDisplayType,
        usdExchangeRate: params.usdExchangeRate,
        customCurrencyExchangeRate: currency.customCurrencyExchangeRate,
      }),
      usdCnyRate: settings.usd_cny_rate,
      groupRatio: params.groupRatio,
      groupForcedPrice: params.groupForcedPrice,
      selectedGroup: params.selectedGroup,
      autoGroups: params.autoGroups,
    }
  }, [
    enabled,
    settings,
    currency,
    params.usdExchangeRate,
    params.groupRatio,
    params.groupForcedPrice,
    params.selectedGroup,
    params.autoGroups,
  ])
}
