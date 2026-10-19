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
// ----------------------------------------------------------------------------
// Pricing Types
// ----------------------------------------------------------------------------

import type { ScoreDimension } from './lib/scores'

export type PricingVendor = {
  id: number
  name: string
  icon?: string
  description?: string
}

export type BillingUsageUnit = 'second' | 'count' | 'token' | 'credit'

export type BillingUsageFieldSchema = {
  type?: 'number' | 'boolean'
  unit?: BillingUsageUnit
  unitLabel?: string | Record<string, string>
  enum?: string[]
  enumLabels?: Record<string, string | Record<string, string>>
  description?: string | Record<string, string>
}

export type BillingUsageSchema = Record<string, BillingUsageFieldSchema>

export type BillingUsageExample = {
  label: string
  facts: Record<string, string | number>
}

export type BillingPluginVariant = {
  plugin_key: string
  plugin_name: string
  icon?: string
  billing_expr: string
  billing_mode?: 'ratio' | 'tiered_expr'
  billing_usage_schema: BillingUsageSchema
  billing_usage_examples?: BillingUsageExample[]
}

export type PricingModel = {
  billing_plugin_variants?: BillingPluginVariant[]
  id: number
  model_name: string
  description?: string
  icon?: string
  vendor_id?: number
  vendor_name?: string
  vendor_icon?: string
  vendor_description?: string
  quota_type: number
  model_ratio: number
  completion_ratio: number
  model_price?: number
  cache_ratio?: number | null
  create_cache_ratio?: number | null
  image_ratio?: number | null
  audio_ratio?: number | null
  audio_completion_ratio?: number | null
  enable_groups: string[]
  tags?: string
  supported_endpoint_types?: string[]
  key?: string
  group_ratio?: Record<string, number>
  /**
   * Cheapest group ratio among the model's Auto Group Chain groups, computed from
   * the pricing payload. Undefined when the chain is unconfigured or the model is
   * only offered outside it, in which case the display falls back to every group.
   */
  auto_chain_ratio?: number
  /** Cheapest flat per-request price among the model's Auto Group Chain groups. */
  auto_chain_forced_price?: number
  /** Billing mode (e.g. "tiered_expr") used to flag dynamic pricing */
  billing_mode?: string
  /** Raw expression describing dynamic / tiered billing */
  billing_expr?: string
  /** Task-plugin usage facts and their billing units. */
  billing_usage_schema?: BillingUsageSchema
  /** Display-only labeled usage vectors for pricing examples. */
  billing_usage_examples?: BillingUsageExample[]
  /** Pricing version returned by backend, useful for cache busting */
  pricing_version?: string
  /** Rarity tier N / R / SR / SSR / UR (from DeepSWE rating) */
  rating?: string
  /** DeepSWE pass@1 score */
  rating_score?: number
  /** Artificial Analysis Intelligence / Coding / Agentic indices */
  aa_intelligence_score?: number
  aa_coding_score?: number
  aa_agentic_score?: number
  /** Per-dimension tiers, derived server-side from each dimension's thresholds */
  aa_intelligence_rating?: string
  aa_coding_rating?: string
  aa_agentic_rating?: string
  /** Score origin: artificialanalysis / manual */
  aa_source?: string
  /**
   * Optional model metadata fields reserved for backend-provided catalog data.
   * Keep them data-driven; do not synthesize display values on the client.
   */
  context_length?: number
  max_input_tokens?: number
  max_output_tokens?: number
  knowledge_cutoff?: string
  release_date?: string
  parameter_count?: string
  input_modalities?: Modality[]
  output_modalities?: Modality[]
  capabilities?: ModelCapability[]
}

/** Input/output modalities supported by a model. */
export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file'

/** Functional capabilities a model exposes. */
export type ModelCapability =
  | 'function_calling'
  | 'streaming'
  | 'vision'
  | 'json_mode'
  | 'structured_output'
  | 'reasoning'
  | 'tools'
  | 'system_prompt'
  | 'web_search'
  | 'code_interpreter'
  | 'caching'
  | 'embeddings'

export type PricingData = {
  success: boolean
  message?: string
  data: PricingModel[]
  vendors: PricingVendor[]
  group_ratio: Record<string, number>
  /** Groups whose every request costs one flat USD price, ignoring model pricing */
  group_forced_price?: Record<string, number>
  usable_group: Record<string, { desc: string; ratio: number }>
  supported_endpoint: Record<string, string>
  auto_groups: string[]
  /**
   * Operator-configured Auto Group Chain, unfiltered by the viewer's permissions.
   * The model square scopes its default price and model-level success rate to it.
   */
  auto_group_chain?: string[]
  /** Operator-configured initial sort and score dimension for the model square */
  defaults?: {
    sort?: string
    dimension?: ScoreDimension
  }
  /** Operator-configured collapsing of long filter lists in the model square */
  filter_defaults?: {
    collapsible?: boolean
    /** 每个筛选组默认显示的选项个数；0 或缺失表示不折叠。 */
    visible_options?: number
  }
}

export type TokenUnit = 'M' | 'K'
export type PriceType =
  | 'input'
  | 'output'
  | 'cache'
  | 'create_cache'
  | 'image'
  | 'audio_input'
  | 'audio_output'
export type QuotaType = 0 | 1 // 0: token-based, 1: per-request
