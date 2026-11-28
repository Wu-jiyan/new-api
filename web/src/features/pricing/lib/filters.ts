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
import { parseModalityFilter } from '@/lib/catalog-modalities'

import {
  SORT_OPTIONS,
  MODEL_ORDER_SORTS,
  FILTER_ALL,
  QUOTA_TYPES,
  QUOTA_TYPE_VALUES,
  ENDPOINT_TYPES,
  MODEL_KINDS,
  MODEL_MODALITIES,
  type ModelKind,
  type QuotaTypeOption,
  type SortOption,
} from '../constants'
import type { ModelOrder, PricingModel } from '../types'
import { compileBillingExpression } from './billing-expression/parser'
import { visitExpression } from './billing-expression/types'
import {
  getCardExamplePrice,
  getDynamicPricingSummary,
  hasTaskUsageSchema,
  isUnconfiguredTaskUsageModel,
} from './dynamic-price'
import { getAutoChainGroups, isTokenBasedModel } from './model-helpers'
import { withBasePricing } from './plugin-pricing'
import { calculateTokenPrice } from './price'
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
 *
 * "All groups" means the groups the square actually offers by default, i.e. the
 * Auto Group Chain. A model only reachable through an off-chain group (free,
 * promotional) would otherwise be quoted a price nobody defaults to, so it is
 * listed only when that group is selected explicitly.
 */
export function filterByGroup(
  models: PricingModel[],
  group: string,
  autoGroups?: readonly string[]
): PricingModel[] {
  if (group !== FILTER_ALL) {
    return models.filter((m) => m.enable_groups?.includes(group))
  }
  if (!autoGroups || autoGroups.length === 0) return models
  return models.filter((m) => getAutoChainGroups(m, autoGroups).length > 0)
}

/** Pricing category of the active configuration, shared by filters and counts. */
export function getModelQuotaType(
  listedModel: PricingModel
): Exclude<QuotaTypeOption, 'all'> | undefined {
  const model = withBasePricing(listedModel)
  // Task-usage models retain their own category.
  if (hasTaskUsageSchema(model)) return QUOTA_TYPES.TASK

  if (model.billing_mode === 'tiered_expr' && model.billing_expr) {
    const compiled = compileBillingExpression(model.billing_expr)
    if (compiled.status === 'ready') {
      if (!compiled.functions.has('fixed')) return QUOTA_TYPES.TOKEN

      // Only models whose pricing leaves are all fixed count as per-request.
      let hasTokenPricing = false
      visitExpression(compiled.ast, (node) => {
        if (node.kind !== 'call' || node.name !== 'tier') return
        const price = node.args[1]
        if (price.kind !== 'call' || price.name !== 'fixed') {
          hasTokenPricing = true
        }
      })
      return hasTokenPricing ? QUOTA_TYPES.TOKEN : QUOTA_TYPES.REQUEST
    }
  }

  // Preserve legacy classification when the expression cannot be parsed.
  if (model.quota_type === QUOTA_TYPE_VALUES.TOKEN) return QUOTA_TYPES.TOKEN
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return QUOTA_TYPES.REQUEST
  }
  return undefined
}

/**
 * Filter models by quota type
 */
export function filterByQuotaType(
  models: PricingModel[],
  quotaType: string
): PricingModel[] {
  if (quotaType === QUOTA_TYPES.ALL) return models
  return models.filter((model) => getModelQuotaType(model) === quotaType)
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
 * Filter models by modality in the requested direction.
 *
 * `text_in` / `image_out` match one direction only, because "image input"
 * (vision) and "image output" (generation) are different capabilities. A bare
 * legacy value such as `image` keeps meaning "input or output" so bookmarked
 * URLs keep working, and an unparseable value filters nothing rather than
 * emptying the list.
 */
export function filterByModality(
  models: PricingModel[],
  modality: string
): PricingModel[] {
  if (modality === MODEL_MODALITIES.ALL) return models
  const parsed = parseModalityFilter(modality)
  if (!parsed) return models
  return models.filter((m) => {
    if (parsed.direction === 'either') {
      return (
        m.input_modalities?.includes(parsed.modality) ||
        m.output_modalities?.includes(parsed.modality)
      )
    }
    const declared =
      parsed.direction === 'in' ? m.input_modalities : m.output_modalities
    return declared?.includes(parsed.modality)
  })
}

/** 类型页签对应的模型标签。与侧栏标签筛选共用同一份中文词表。 */
const MODEL_KIND_TAGS = {
  [MODEL_KINDS.TEXT]: '文本',
  [MODEL_KINDS.IMAGE]: '图片',
  [MODEL_KINDS.VIDEO]: '视频',
} as const

export function parseModelKind(value: string | undefined): ModelKind {
  const kinds = Object.values(MODEL_KINDS) as string[]
  return value && kinds.includes(value) ? (value as ModelKind) : MODEL_KINDS.ALL
}

/**
 * Filter models by the square's type tab. Classification reads the model's
 * tags, so a model can belong to several tabs (e.g. text + image output).
 * The `other` tab is the complement: models whose tags carry none of the three
 * type words (tools, ASR, safety classifiers…), so every model stays reachable
 * from exactly one of the five tabs.
 */
export function filterByKind(
  models: PricingModel[],
  kind: string | undefined
): PricingModel[] {
  const variant = parseModelKind(kind)
  if (variant === MODEL_KINDS.ALL) return models
  if (variant === MODEL_KINDS.OTHER) {
    const typeTags = new Set(
      Object.values(MODEL_KIND_TAGS).map((tag) => tag.toLowerCase())
    )
    return models.filter((m) => {
      const tags = parseTags(m.tags).map((tag) => tag.toLowerCase())
      return !tags.some((tag) => typeTags.has(tag))
    })
  }
  const wanted = MODEL_KIND_TAGS[variant].toLowerCase()
  return models.filter((m) =>
    parseTags(m.tags).some((tag) => tag.toLowerCase() === wanted)
  )
}

type SortPriceKind = 'input' | 'output' | 'request'

const PRICE_SORTS: Partial<
  Record<SortOption, { kind: SortPriceKind; dir: 1 | -1 }>
> = {
  [SORT_OPTIONS.INPUT_PRICE_LOW]: { kind: 'input', dir: 1 },
  [SORT_OPTIONS.INPUT_PRICE_HIGH]: { kind: 'input', dir: -1 },
  [SORT_OPTIONS.OUTPUT_PRICE_LOW]: { kind: 'output', dir: 1 },
  [SORT_OPTIONS.OUTPUT_PRICE_HIGH]: { kind: 'output', dir: -1 },
  [SORT_OPTIONS.REQUEST_PRICE_LOW]: { kind: 'request', dir: 1 },
  [SORT_OPTIONS.REQUEST_PRICE_HIGH]: { kind: 'request', dir: -1 },
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
 * Base USD price shown on the model card: input/output per 1M tokens, request
 * per call (task models use their first usage example). Undefined when the
 * model has no price of that kind.
 */
function getSortPrice(
  listedModel: PricingModel,
  kind: SortPriceKind
): number | undefined {
  const model = withBasePricing(listedModel)
  if (kind === 'request') {
    const example = getCardExamplePrice(model, { tokenUnit: 'M' })
    if (example) return example.total
  }
  const summary = getDynamicPricingSummary(model, { tokenUnit: 'M' })
  if (kind === 'request') {
    if (summary) {
      return summary.entries.find(
        (entry) => entry.field === 'fixedPrice' || entry.field === 'modelPrice'
      )?.value
    }
    return isTokenBasedModel(model) ? undefined : model.model_price
  }
  if (summary) {
    const field = kind === 'input' ? 'inputPrice' : 'outputPrice'
    return summary.entries.find(
      (entry) => entry.field === field && entry.unit === 'token'
    )?.value
  }
  if (!isTokenBasedModel(model) || isUnconfiguredTaskUsageModel(model)) {
    return undefined
  }
  return calculateTokenPrice(model, kind, 1)
}

/**
 * 按模型名比较。分数或价格相等时，后端返回顺序不可依赖，必须有确定的次序。
 */
function compareModelNames(a: PricingModel, b: PricingModel): number {
  return (a.model_name || '').localeCompare(b.model_name || '')
}

/**
 * Orders models for the usage sorts of the model square: most used first,
 * equal usage in plain string order like the server's list, and models
 * without usage by name like the rest of the square.
 */
export function compareModelUsage(
  a: { name: string; usage: number },
  b: { name: string; usage: number }
): number {
  if (a.usage !== b.usage) return b.usage - a.usage
  if (a.usage === 0) return a.name.localeCompare(b.name)
  if (a.name === b.name) return 0
  return a.name < b.name ? -1 : 1
}

/**
 * Sort models by specified option. Score sorting uses the selected dimension,
 * and unrated models are placed last. Ties always fall back to the model name
 * so equal keys keep a deterministic order.
 */
export function sortModels(
  models: PricingModel[],
  sortBy: string,
  dimension: ScoreDimension = DEFAULT_SCORE_DIMENSION,
  modelOrder?: ModelOrder
): PricingModel[] {
  const sorted = [...models]

  const priceSort = PRICE_SORTS[sortBy as SortOption]
  if (priceSort) {
    // Extracting the price parses the billing expression, so compute once
    const price = new Map(
      sorted.map((m) => [m, getSortPrice(m, priceSort.kind)])
    )
    // Models without this kind of price stay last in both directions
    sorted.sort((a, b) => {
      const priceA = price.get(a)
      const priceB = price.get(b)
      if (priceA === undefined || priceB === undefined) {
        return Number(priceA === undefined) - Number(priceB === undefined)
      }
      return priceSort.dir * (priceA - priceB) || compareModelNames(a, b)
    })
    return sorted
  }

  if (MODEL_ORDER_SORTS.has(sortBy)) {
    // Models missing from the order follow it by name
    const order = modelOrder?.[sortBy as keyof ModelOrder] ?? []
    const rank = new Map(order.map((name, index) => [name, index]))
    sorted.sort(
      (a, b) =>
        (rank.get(a.model_name) ?? order.length) -
          (rank.get(b.model_name) ?? order.length) || compareModelNames(a, b)
    )
    return sorted
  }

  switch (sortBy) {
    case SORT_OPTIONS.NAME:
      sorted.sort(compareModelNames)
      break
    case SORT_OPTIONS.CONTEXT_HIGH:
    case SORT_OPTIONS.CONTEXT_LOW: {
      const direction = sortBy === SORT_OPTIONS.CONTEXT_HIGH ? -1 : 1
      // Models with no configured window sink to the bottom in both directions:
      // "unknown" is not the same as "smallest".
      sorted.sort((a, b) => {
        const contextA = a.context_length ?? 0
        const contextB = b.context_length ?? 0
        if (contextA === 0 || contextB === 0) {
          return Number(contextA === 0) - Number(contextB === 0)
        }
        return direction * (contextA - contextB) || compareModelNames(a, b)
      })
      break
    }
    case SORT_OPTIONS.SCORE_HIGH:
      sorted.sort((a, b) => {
        const scoreA = scoreForDimension(a, dimension)
        const scoreB = scoreForDimension(b, dimension)
        const hasA = scoreA > 0
        const hasB = scoreB > 0
        if (hasA !== hasB) return hasA ? -1 : 1
        if (scoreA !== scoreB) return scoreB - scoreA
        return compareModelNames(a, b)
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
    modality: string
    /** Type tab; omitted or `all` means every model. */
    kind?: string
    tag: string
    rating: string
    sortBy: string
    dimension?: ScoreDimension
    /** Auto Group Chain; scopes what "all groups" means. */
    autoGroups?: readonly string[]
    /** Server-side recommended order and usage ranking */
    modelOrder?: ModelOrder
  }
): PricingModel[] {
  const dimension = filters.dimension ?? DEFAULT_SCORE_DIMENSION
  let result = filterBySearch(models, filters.search, filters.searchScopes)
  result = filterByVendor(result, filters.vendor)
  result = filterByGroup(result, filters.group, filters.autoGroups)
  result = filterByQuotaType(result, filters.quotaType)
  result = filterByEndpointType(result, filters.endpointType)
  result = filterByModality(result, filters.modality)
  result = filterByKind(result, filters.kind)
  result = filterByTag(result, filters.tag)
  result = filterByRating(result, filters.rating, dimension)
  result = sortModels(result, filters.sortBy, dimension, filters.modelOrder)

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
