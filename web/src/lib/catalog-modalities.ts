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

/**
 * 模态方向。模型广场按输入/输出分别筛选：同一个「图片」既可能是视觉输入，
 * 也可能是生图输出，合并成一个选项会让用户无法表达自己真正想要的那一种。
 */
export const MODALITY_DIRECTIONS = ['in', 'out'] as const

export type ModalityDirection = (typeof MODALITY_DIRECTIONS)[number]

/** 方向限定的筛选值，形如 `text_in` / `image_out`；同时用作 URL 参数值。 */
export function modalityDirectionValue(
  modality: CatalogModality,
  direction: ModalityDirection
): string {
  return `${modality}_${direction}`
}

/** 方向限定标签的 i18n 键，例如 `Text input` / `Image output`。 */
export function modalityDirectionLabelKey(
  modality: CatalogModality,
  direction: ModalityDirection
): string {
  return `${CATALOG_MODALITY_LABELS[modality]} ${direction === 'in' ? 'input' : 'output'}`
}

export function isCatalogModality(value: string): value is CatalogModality {
  return (CATALOG_MODALITIES as readonly string[]).includes(value)
}

export type ModalityFilter = {
  modality: CatalogModality
  /** `either` 只来自历史遗留的裸值，保持「输入或输出」语义。 */
  direction: ModalityDirection | 'either'
}

/**
 * 解析模态筛选值。
 *
 * `text_in` / `image_out` 按方向匹配；遗留的裸值（如 `image`）继续表示
 * 「输入或输出」，使旧书签不至于失效；无法识别的值返回 null，调用方按不筛选
 * 处理，避免 URL 里的脏数据把列表清空。
 */
export function parseModalityFilter(value: string): ModalityFilter | null {
  const [modality, direction, ...rest] = value.split('_')
  if (!modality || !isCatalogModality(modality)) return null
  if (rest.length > 0) return null
  if (direction === undefined) return { modality, direction: 'either' }
  if (direction === 'in' || direction === 'out') return { modality, direction }
  return null
}
