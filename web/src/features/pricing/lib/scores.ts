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
import type { PricingModel } from '../types'

/**
 * 评分维度。DeepSWE 是独立榜单的编码维度，AA 三个维度来自 Artificial Analysis。
 * 维度只影响展示、排序与档位筛选，不改变抽卡使用的 DeepSWE 档位。
 */
export const SCORE_DIMENSIONS = [
  'deepswe',
  'aa_intelligence',
  'aa_coding',
  'aa_agentic',
] as const

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number]

export const DEFAULT_SCORE_DIMENSION: ScoreDimension = 'deepswe'

/** DeepSWE 之外的维度均由 Artificial Analysis 提供，页面上需要标注来源。 */
export const AA_DIMENSIONS: readonly ScoreDimension[] = [
  'aa_intelligence',
  'aa_coding',
  'aa_agentic',
]

export function isScoreDimension(value: unknown): value is ScoreDimension {
  return (
    typeof value === 'string' &&
    (SCORE_DIMENSIONS as readonly string[]).includes(value)
  )
}

const DIMENSION_FIELDS: Record<
  ScoreDimension,
  { score: keyof PricingModel; tier: keyof PricingModel }
> = {
  deepswe: { score: 'rating_score', tier: 'rating' },
  aa_intelligence: {
    score: 'aa_intelligence_score',
    tier: 'aa_intelligence_rating',
  },
  aa_coding: { score: 'aa_coding_score', tier: 'aa_coding_rating' },
  aa_agentic: { score: 'aa_agentic_score', tier: 'aa_agentic_rating' },
}

/** 该维度的分数；未评分返回 0。 */
export function scoreForDimension(
  model: PricingModel,
  dimension: ScoreDimension
): number {
  return (model[DIMENSION_FIELDS[dimension].score] as number | undefined) ?? 0
}

/** 该维度的稀有度档位；未评分返回空字符串。 */
export function tierForDimension(
  model: PricingModel,
  dimension: ScoreDimension
): string {
  const tier = model[DIMENSION_FIELDS[dimension].tier]
  return typeof tier === 'string' ? tier : ''
}