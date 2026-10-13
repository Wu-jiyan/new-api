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
  SORT_OPTIONS,
  FILTER_ALL,
  QUOTA_TYPES,
  QUOTA_TYPE_VALUES,
  ENDPOINT_TYPES,
} from '../constants'
import type { PricingModel } from '../types'
import { hasTaskUsageSchema } from './dynamic-price'
import {
  DEFAULT_SCORE_DIMENSION,
  scoreForDimension,
  tierForDimension,
  type ScoreDimension,
} from './scores'

// ----------------------------------------------------------------------------
// Filter Utilities
// ----------------------------------------------------------------------------

/**
 * 可被搜索命中的字段范围。默认只搜索模型名：描述、标签与供应商名常包含与用户
 * 预期无关的文本，一次命中全部字段会让搜索结果产生误导。
 */
export const SEARCH_SCOPES = ['name', 'description', 'tags', 'vendor'] as const

export type SearchScope = (typeof SEARCH_SCOPES)[number]

export const DEFAULT_SEARCH_SCOPES: readonly SearchScope[] = ['name']

type SearchableField = 'model_name' | 'description' | 'tags' | 'vendor_name'

const SEARCH_SCOPE_FIELDS: Record<SearchScope, SearchableField> = {
  name: 'model_name',
  description: 'description',
  tags: 'tags',
  vendor: 'vendor_name',
}

/**
 * 解析检索范围：忽略未知值，空值或全部无效时回落到默认（仅模型名）。
 */
export function parseSearchScopes(
  value: string | readonly string[] | undefined
): SearchScope[] {
  const requested =
    typeof value === 'string'
      ? value.split(',').map((scope) => scope.trim())
      : (value ?? [])
  const scopes = SEARCH_SCOPES.filter((scope) => requested.includes(scope))
  return scopes.length > 0 ? [...scopes] : [...DEFAULT_SEARCH_SCOPES]
}

/**
 * Filter models by search query within the selected scopes
 */
export function filterBySearch(
  models: PricingModel[],
  query: string,
  scopes?: readonly string[]
): PricingModel[] {
  if (!query) return models

  const lowerQuery = query.toLowerCase()
  const fields = parseSearchScopes(scopes).map(
    (scope) => SEARCH_SCOPE_FIELDS[scope]
  )
  return models.filter((m) =>
    fields.some((field) => m[field]?.toLowerCase().includes(lowerQuery))
  )
}

/**
 * Filter models by vendor
 */
export function filterByVendor(
  models: PricingModel[],
  vendor: string
): PricingModel[] {
  if (vendor === FILTER_ALL) return models
  return models.filter((m) => m.vendor_name === vendor)
}

/**
 * Filter models by group
 */
export function filterByGroup(
  models: PricingModel[],
  group: string
): PricingModel[] {
  if (group === FILTER_ALL) return models
  return models.filter((m) => m.enable_groups?.includes(group))
}

/**
 * Filter models by quota type
 */
export function filterByQuotaType(
  models: PricingModel[],
  quotaType: string
): PricingModel[] {
  if (quotaType === QUOTA_TYPES.ALL) return models
  // Task-usage models form their own bucket, disjoint from token/request.
  if (quotaType === QUOTA_TYPES.TASK) {
    return models.filter((m) => hasTaskUsageSchema(m))
  }
  const targetType =
    quotaType === QUOTA_TYPES.TOKEN
      ? QUOTA_TYPE_VALUES.TOKEN
      : QUOTA_TYPE_VALUES.REQUEST
  return models.filter(
    (m) => m.quota_type === targetType && !hasTaskUsageSchema(m)
  )
}

/**
 * Filter models by endpoint type
 */
export function filterByEndpointType(
  models: PricingModel[],
  endpointType: string
): PricingModel[] {
  if (endpointType === ENDPOINT_TYPES.ALL) return models
  return models.filter((m) =>
    m.supported_endpoint_types?.includes(endpointType)
  )
}

/**
 * Filter models by rating tier (N / R / SR / SSR / UR) on the selected dimension
 */
export function filterByRating(
  models: PricingModel[],
  rating: string,
  dimension: ScoreDimension = DEFAULT_SCORE_DIMENSION
): PricingModel[] {
  if (rating === FILTER_ALL) return models
  return models.filter((m) => tierForDimension(m, dimension) === rating)
}

/**
 * Get model price for sorting
 */
function getModelPrice(model: PricingModel): number {
  return model.quota_type === 0 ? model.model_ratio : model.model_price || 0
}

/**
 * 按展示名比较模型。分数或价格相等时，后端返回顺序不可依赖，必须有确定的次序。
 */
function compareModelDisplayName(a: PricingModel, b: PricingModel): number {
  return (a.model_name || '').localeCompare(b.model_name || '')
}

/**
 * Sort models by specified option. Score sorting uses the selected dimension,
 * and unrated models are placed last. Ties always fall back to the model name
 * so equal keys keep a deterministic order.
 */
export function sortModels(
  models: PricingModel[],
  sortBy: string,
  dimension: ScoreDimension = DEFAULT_SCORE_DIMENSION
): PricingModel[] {
  const sorted = [...models]

  switch (sortBy) {
    case SORT_OPTIONS.NAME:
      sorted.sort(compareModelDisplayName)
      break
    case SORT_OPTIONS.PRICE_LOW:
      sorted.sort(
        (a, b) =>
          getModelPrice(a) - getModelPrice(b) || compareModelDisplayName(a, b)
      )
      break
    case SORT_OPTIONS.PRICE_HIGH:
      sorted.sort(
        (a, b) =>
          getModelPrice(b) - getModelPrice(a) || compareModelDisplayName(a, b)
      )
      break
    case SORT_OPTIONS.SCORE_HIGH:
      sorted.sort((a, b) => {
        const scoreA = scoreForDimension(a, dimension)
        const scoreB = scoreForDimension(b, dimension)
        const hasA = scoreA > 0
        const hasB = scoreB > 0
        if (hasA !== hasB) return hasA ? -1 : 1
        if (scoreA !== scoreB) return scoreB - scoreA
        return compareModelDisplayName(a, b)
      })
      break
  }

  return sorted
}

/**
 * Apply all filters and sorting to models
 */
export function filterAndSortModels(
  models: PricingModel[],
  filters: {
    search: string
    searchScopes?: readonly string[]
    vendor: string
    group: string
    quotaType: string
    endpointType: string
    tag: string
    rating: string
    sortBy: string
    dimension?: ScoreDimension
  }
): PricingModel[] {
  const dimension = filters.dimension ?? DEFAULT_SCORE_DIMENSION
  let result = filterBySearch(models, filters.search, filters.searchScopes)
  result = filterByVendor(result, filters.vendor)
  result = filterByGroup(result, filters.group)
  result = filterByQuotaType(result, filters.quotaType)
  result = filterByEndpointType(result, filters.endpointType)
  result = filterByTag(result, filters.tag)
  result = filterByRating(result, filters.rating, dimension)
  result = sortModels(result, filters.sortBy, dimension)

  return result
}

/**
 * Parse tags from comma-separated string
 */
export function parseTags(tagsString?: string): string[] {
  if (!tagsString) return []
  return tagsString
    .split(/[,;|\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * Extract all unique tags from models
 */
export function extractAllTags(models: PricingModel[]): string[] {
  const tagSet = new Set<string>()

  models.forEach((model) => {
    if (model.tags) {
      const tags = parseTags(model.tags)
      tags.forEach((tag) => {
        tagSet.add(tag.toLowerCase())
      })
    }
  })

  return [...tagSet].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter models by tag
 */
export function filterByTag(
  models: PricingModel[],
  tag: string
): PricingModel[] {
  if (tag === FILTER_ALL) return models

  const tagLower = tag.toLowerCase()
  return models.filter((m) => {
    if (!m.tags) return false
    const modelTags = parseTags(m.tags).map((t) => t.toLowerCase())
    return modelTags.includes(tagLower)
  })
}
