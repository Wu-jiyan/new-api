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
import { formatTokenCount } from '@/lib/format'

import type { PricingModel } from '../types'

/**
 * Label vocabulary for catalog modalities. Mirrors the closed set the backend
 * accepts in `model/model_catalog_fields.go`; the pricing view and the admin
 * form both resolve names through here so one model never shows two spellings
 * of the same modality.
 */
export const CATALOG_MODALITY_LABELS: Record<string, string> = {
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  file: 'File',
}

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
  locale?: Intl.LocalesArgument
): string {
  return formatTokenCount(tokens, locale)
}

/** Distinct modalities across both directions, in stable catalog order. */
export function collectModalities(model: PricingModel): string[] {
  const merged = new Set([
    ...normalizeCatalogItems(model.input_modalities),
    ...normalizeCatalogItems(model.output_modalities),
  ])
  return Object.keys(CATALOG_MODALITY_LABELS).filter((key) => merged.has(key))
}
