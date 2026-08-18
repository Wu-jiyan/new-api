export interface GachaPool {
  id: number
  name: string
  description?: string
  price: number
  ten_price: number
  enabled: boolean
  sort_order: number
  pity_enabled: boolean
  pity_max: number
  pity_rarity?: string
  pity_uprate: number
  ten_guarantee?: string
  created_time?: number
  updated_time?: number
  entries?: GachaCardEntry[]
}

export interface GachaCardEntry {
  id?: number
  pool_id: number
  model_name: string
  group: string
  weight: number
  quota: number
  expire_days: number
}

export interface PoolEconomics {
  expected_value: number
  price: number
  rtp: number
  expected_cost: number
  profit_est: number
  warn: boolean
  warn_reason: string
  unknown_cost_weight: number
}

export interface RatingThresholds {
  ur: number
  ssr: number
  sr: number
  r: number
}

export interface ModelRatingItem {
  id: number
  model_name: string
  rating?: string
  rating_score?: number
  rating_source?: string
}
