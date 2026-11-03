import type { RatingDimension } from './types'

export const RATING_DIMENSIONS: RatingDimension[] = [
  'deepswe',
  'aa_intelligence',
]

export const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR'] as const

export const RATINGS_PAGE_SIZE = 20

/**
 * 每个维度的展示元数据。DeepSWE 走独立榜单且无需密钥；AA 综合指数由一次
 * AA API 同步写入，与管理页共享同一份密钥配置。
 */
export const DIMENSION_META: Record<
  RatingDimension,
  {
    label: string
    scoreField: 'rating_score' | 'aa_intelligence_score'
    source: 'deepswe' | 'aa'
  }
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
}

/** AA 综合指数的分数字段，供手动保存时提交。 */
export const AA_SCORE_FIELDS = ['aa_intelligence_score'] as const

/** 与后端 model.DefaultModelSquareDefaults 保持一致，用于判断「未改动」。 */
export const DEFAULT_SQUARE_DEFAULTS = {
  sort: 'name',
  dimension: 'deepswe',
} as const

/** 与后端 model.DefaultModelSquareFilter 保持一致。 */
export const DEFAULT_SQUARE_FILTER = {
  collapsible: true,
  visibleOptions: 8,
} as const

/** 与后端 SetModelSquareFilter 的取值范围保持一致。 */
export const SQUARE_FILTER_VISIBLE_OPTIONS_RANGE = {
  min: 1,
  max: 50,
} as const
