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
import { EXCLUDED_GROUPS, FILTER_ALL, QUOTA_TYPE_VALUES } from '../constants'
import type { PricingModel } from '../types'

// ----------------------------------------------------------------------------
// Model Helper Utilities
// ----------------------------------------------------------------------------

/**
 * Get available groups for a model
 */
export function getAvailableGroups(
  model: PricingModel,
  usableGroup: Record<string, { desc: string; ratio: number }>
): string[] {
  const modelEnableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []

  return Object.keys(usableGroup)
    .filter((g) => !EXCLUDED_GROUPS.includes(g))
    .filter((g) => modelEnableGroups.includes(g))
}

/**
 * Read a configured group ratio while preserving valid zero ratios.
 */
export function getConfiguredGroupRatio(
  groupRatio: Record<string, number>,
  group: string
): number {
  const ratio = groupRatio[group]
  return typeof ratio === 'number' && Number.isFinite(ratio) ? ratio : 1
}

/**
 * Read the flat per-request price a group charges instead of model pricing.
 * Returns undefined when the group has no forced price, so callers can fall
 * back to ratio-based pricing.
 */
export function getGroupForcedPrice(
  groupForcedPrice: Record<string, number> | undefined,
  group: string | undefined
): number | undefined {
  if (!groupForcedPrice || !group || group === FILTER_ALL) return undefined
  const price = groupForcedPrice[group]
  return typeof price === 'number' && Number.isFinite(price) && price > 0
    ? price
    : undefined
}

/**
 * Resolve the flat per-request price shown for a model.
 *
 * When no group filter is active this mirrors getDisplayGroupRatio: the model
 * square shows the best price available to the viewer, which for forced-price
 * groups is the cheapest flat fee. Returns undefined when no forced price
 * applies and ratio-based pricing must be used instead.
 */
export function getDisplayGroupForcedPrice(
  model: PricingModel,
  groupForcedPrice: Record<string, number> | undefined,
  selectedGroup?: string
): number | undefined {
  const modelEnableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []

  if (
    selectedGroup &&
    selectedGroup !== FILTER_ALL &&
    modelEnableGroups.includes(selectedGroup)
  ) {
    return getGroupForcedPrice(groupForcedPrice, selectedGroup)
  }

  // "Every group" quotes the chain's flat fee: a forced price belonging to a
  // group outside the chain is only shown when that group is selected.
  if (model.auto_chain_forced_price !== undefined) {
    return model.auto_chain_forced_price
  }

  let minPrice = Number.POSITIVE_INFINITY
  for (const group of modelEnableGroups) {
    const price = getGroupForcedPrice(groupForcedPrice, group)
    if (price !== undefined && price < minPrice) minPrice = price
  }
  return minPrice === Number.POSITIVE_INFINITY ? undefined : minPrice
}

/**
 * Resolve the group ratio used by model square summary prices.
 *
 * When no specific group is selected, the model square shows the best price
 * available to the viewer. When a group filter is active, it shows that
 * group's price instead.
 */
export function getDisplayGroupRatio(
  model: PricingModel,
  selectedGroup?: string
): number {
  const modelEnableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  const groupRatio = model.group_ratio || {}

  if (
    selectedGroup &&
    selectedGroup !== FILTER_ALL &&
    modelEnableGroups.includes(selectedGroup)
  ) {
    return getConfiguredGroupRatio(groupRatio, selectedGroup)
  }

  // "Every group" quotes the Auto Group Chain price, so a free group outside the
  // chain (ratio 0) can no longer make every model in the square look free.
  if (model.auto_chain_ratio !== undefined) {
    return model.auto_chain_ratio
  }

  if (modelEnableGroups.length === 0) {
    return 1
  }

  let minRatio = Number.POSITIVE_INFINITY

  for (const group of modelEnableGroups) {
    const ratio = groupRatio[group]
    if (
      typeof ratio === 'number' &&
      Number.isFinite(ratio) &&
      ratio < minRatio
    ) {
      minRatio = ratio
    }
  }

  return minRatio === Number.POSITIVE_INFINITY ? 1 : minRatio
}

/**
 * Replace model placeholder in endpoint path
 */
export function replaceModelInPath(path: string, modelName: string): string {
  return path.replaceAll('{model}', modelName)
}

/**
 * Check if model is token-based pricing
 */
export function isTokenBasedModel(model: PricingModel): boolean {
  return model.quota_type === QUOTA_TYPE_VALUES.TOKEN
}

// ----------------------------------------------------------------------------
// Auto Group Chain scoping
// ----------------------------------------------------------------------------

/**
 * Groups of the Auto Group Chain the model is actually offered in.
 *
 * The chain is the ordered list of groups a normal request routes through, so
 * only those groups describe what the model square is offering by default. A
 * group outside the chain (free, promotional) is reachable only after selecting
 * it explicitly.
 */
export function getAutoChainGroups(
  model: PricingModel,
  autoGroups?: readonly string[]
): string[] {
  if (!autoGroups || autoGroups.length === 0) return []
  const modelEnableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  return autoGroups.filter((group) => modelEnableGroups.includes(group))
}

/**
 * Cheapest group ratio inside the model's Auto Group Chain.
 *
 * Returns undefined when no chain is configured or the model is only offered
 * outside it, so callers keep the previous "best price of every group" display.
 */
export function getAutoChainRatio(
  model: PricingModel,
  autoGroups?: readonly string[],
  groupRatio?: Record<string, number>
): number | undefined {
  const ratios = groupRatio ?? model.group_ratio ?? {}
  let minRatio: number | undefined
  for (const group of getAutoChainGroups(model, autoGroups)) {
    const ratio = ratios[group]
    if (typeof ratio !== 'number' || !Number.isFinite(ratio)) continue
    if (minRatio === undefined || ratio < minRatio) minRatio = ratio
  }
  return minRatio
}

/**
 * Cheapest flat per-request price inside the model's Auto Group Chain.
 *
 * A forced-price group replaces model pricing entirely, so it has to be scoped
 * the same way the ratio is.
 */
export function getAutoChainForcedPrice(
  model: PricingModel,
  autoGroups?: readonly string[],
  groupForcedPrice?: Record<string, number>
): number | undefined {
  let minPrice: number | undefined
  for (const group of getAutoChainGroups(model, autoGroups)) {
    const price = getGroupForcedPrice(groupForcedPrice, group)
    if (price !== undefined && (minPrice === undefined || price < minPrice)) {
      minPrice = price
    }
  }
  return minPrice
}
