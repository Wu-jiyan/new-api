import type { RatingDimension } from './types'

export const RATING_DIMENSIONS: RatingDimension[] = [
  'deepswe',
  'aa_intelligence',
  'aa_coding',
  'aa_agentic',
]

export const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR'] as const

export const RATINGS_PAGE_SIZE = 20

/**
 * 每个维度的展示元数据。DeepSWE 走独立榜单且无需密钥；AA 三个维度共用一次
 * AA API 同步，因此共享密钥配置。
 */
export const DIMENSION_META: Record<
  RatingDimension,
  { label: string; scoreField: 'rating_score' | 'aa_intelligence_score' | 'aa_coding_score' | 'aa_agentic_score'; source: 'deepswe' | 'aa' }
> = {
  deepswe: {
    label: 'DeepSWE',
    scoreField: 'rating_score',
    source: 'deepswe',
  },
  aa_intelligence: {
    label: 'AA Intelligence',
    scoreField: 'aa_intelligence_score',
    source: 'aa',
  },
  aa_coding: {
    label: 'AA Coding',
    scoreField: 'aa_coding_score',
    source: 'aa',
  },
  aa_agentic: {
    label: 'AA Agentic',
    scoreField: 'aa_agentic_score',
    source: 'aa',
  },
}

/** AA 三个维度的分数字段，供手动保存时一次性提交全部三个值。 */
export const AA_SCORE_FIELDS = [
  'aa_intelligence_score',
  'aa_coding_score',
  'aa_agentic_score',
] as const

/** 与后端 model.DefaultModelSquareDefaults 保持一致，用于判断「未改动」。 */
export const DEFAULT_SQUARE_DEFAULTS = {
  sort: 'name',
  dimension: 'deepswe',
} as const