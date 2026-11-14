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
 * Reasoning-effort suffixes a provider appends to a model name.
 *
 * Longer suffixes come first: `-nonthinking` must win over `-thinking`, and
 * `-xhigh` over `-high`, otherwise a variant would be chopped at the wrong
 * place and produce a base name that does not exist.
 *
 * `-tiered` is a pricing-mode marker rather than an effort level, but it is a
 * variant of the same base model, so it collapses with the rest.
 */
const EFFORT_SUFFIXES = [
  '-nonthinking',
  '-non-reasoning',
  '-minimal',
  '-minimum',
  '-medium',
  '-xhigh',
  '-thinking',
  '-high',
  '-low',
  '-tiered',
  '-max',
  '-off',
] as const

export type EffortVariant = {
  /** Model name without the effort suffix. */
  base: string
  /** Suffix without its leading dash, e.g. `high`. */
  effort: string
}

/**
 * Split a reasoning-effort variant into its base model and effort level.
 * Returns null when the name carries no recognised suffix, and also when the
 * suffix is the whole name (nothing left to call a base).
 */
export function splitEffortVariant(modelName: string): EffortVariant | null {
  const lower = modelName.toLowerCase()
  for (const suffix of EFFORT_SUFFIXES) {
    if (!lower.endsWith(suffix)) continue
    const base = modelName.slice(0, modelName.length - suffix.length)
    if (!base) return null
    return { base, effort: suffix.slice(1) }
  }
  return null
}

/**
 * Whether a row is an effort variant of a base model that the caller is also
 * listing. A suffix without a listed base is a standalone model — hiding it
 * would make the model unreachable from the square.
 */
export function isListedEffortVariant(
  modelName: string,
  listedNames: ReadonlySet<string>
): boolean {
  const variant = splitEffortVariant(modelName)
  return variant !== null && listedNames.has(variant.base)
}

/**
 * Drop the effort variants of listed base models, so one model occupies one
 * card and one count instead of five.
 *
 * `showVariants` returns the list untouched. A variant whose base is missing
 * stays: nothing else would put that model on the square.
 */
export function collapseEffortVariants<T extends { model_name?: string }>(
  models: T[],
  showVariants: boolean
): T[] {
  if (showVariants || models.length === 0) return models
  const listed = new Set(models.map((model) => model.model_name ?? ''))
  return models.filter(
    (model) => !isListedEffortVariant(model.model_name ?? '', listed)
  )
}

/** Model names that {@link collapseEffortVariants} would hide. */
export function hiddenEffortVariantNames<T extends { model_name?: string }>(
  models: T[]
): Set<string> {
  const listed = new Set(models.map((model) => model.model_name ?? ''))
  const hidden = new Set<string>()
  for (const model of models) {
    const name = model.model_name ?? ''
    if (isListedEffortVariant(name, listed)) hidden.add(name)
  }
  return hidden
}
