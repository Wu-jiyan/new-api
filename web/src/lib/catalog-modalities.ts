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
/**
 * Catalogue modalities, mirroring the closed set the backend accepts in
 * model/model_catalog_fields.go.
 *
 * Both the admin metadata form and the pricing catalogue read from here. The
 * set is closed on the server: anything else is rejected on write, and the
 * pricing view would fall back to rendering an unknown value verbatim, so the
 * two sides have to stay in step.
 */
export const CATALOG_MODALITIES = [
  'text',
  'image',
  'audio',
  'video',
  'file',
] as const

export type CatalogModality = (typeof CATALOG_MODALITIES)[number]

/** Display labels. Values are English source strings resolved through t(). */
export const CATALOG_MODALITY_LABELS: Record<CatalogModality, string> = {
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  file: 'File',
}

/**
 * i18n key for one modality value, for callers holding an untyped value read
 * back from the API.
 *
 * The set is closed on the server, but a value outside it must still render as
 * something: returning it verbatim keeps the mismatch visible instead of
 * leaving a blank cell. Every renderer has to resolve the key through t() —
 * rendering CATALOG_MODALITY_LABELS directly shows English in every language.
 */
export function catalogModalityLabelKey(value: string): string {
  const labels: Record<string, string | undefined> = CATALOG_MODALITY_LABELS
  return labels[value] ?? value
}
