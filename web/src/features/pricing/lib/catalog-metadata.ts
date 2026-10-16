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
import {
  CATALOG_MODALITIES,
  CATALOG_MODALITY_LABELS,
  type CatalogModality,
} from '@/lib/catalog-modalities'
import { formatNumber } from '@/lib/format'

import type { PricingModel } from '../types'

export { CATALOG_MODALITY_LABELS }

export function normalizeCatalogItems(items?: string[]): string[] {
  return items ?? []
}

/**
 * Context/token counts for display. Takes the resolved Intl locale so the value
 * follows a language switch — a formatter bound to the default locale at module
 * load would keep rendering the old language's grouping until a full reload.
 */
export function formatCatalogTokenCount(
  tokens: number | undefined,
  // Required on purpose. An omitted locale makes Intl fall back to the operating
  // system locale, which is not the interface language: a Chinese Windows with an
  // English interface would render "12,8" instead of "12.8".
  locale: Intl.LocalesArgument
): string {
  // Context windows and output limits are quoted in K/M tokens across the whole
  // industry and in every provider's own documentation, so the unit suffix stays
  // fixed and only the decimal separator follows the interface language. Compact
  // notation would render the same window as "12.8万" here, which is not how a
  // context window is ever described.
  if (tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens >= 1_000_000) return `${formatNumber(tokens / 1_000_000, locale)}M`
  if (tokens >= 1_000) return `${formatNumber(tokens / 1_000, locale)}K`
  return formatNumber(tokens, locale)
}

/** Distinct modalities across both directions, in catalogue order. */
export function collectModalities(model: PricingModel): CatalogModality[] {
  const merged = new Set([
    ...normalizeCatalogItems(model.input_modalities),
    ...normalizeCatalogItems(model.output_modalities),
  ])
  return CATALOG_MODALITIES.filter((key) => merged.has(key))
}
