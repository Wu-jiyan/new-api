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
  entries?: GachaCardEntry[]
  ev_value?: number
}

export interface GachaCardEntry {
  id: number
  pool_id: number
  /** Comma-separated model range granted by this entry. */
  models: string
  group: string
  weight: number
  quota: number
  quota_min?: number
  quota_max?: number
  expire_days: number
}

/** Merge badge shown on an entitlement and on a pull result. */
export type MergeBadge = 'star' | 'moon' | 'sun'

export interface PullResult {
  subscription_id: number
  models: string[]
  group: string
  rarity: string
  quota: number
  expire_days: number
  expired_at: number
  merge_count: number
  /** True when this pull was stacked onto an existing entitlement. */
  merged: boolean
}

export interface PullResponse {
  pull_record_id: number
  cards: PullResult[]
  pity_before: number
  pity_after: number
}

/** A gacha grant is a subscription limited to a model range. */
export interface GachaEntitlement {
  id: number
  user_id: number
  source: string
  usable_models: string[] | null
  usable_groups: string[] | null
  amount_total: number
  amount_used: number
  start_time: number
  end_time: number
  status: string
  merge_count?: number
}

/** 1-2 grants ⭐, 3-5 🌙, 6+ ☀️. */
export function mergeBadgeOf(mergeCount?: number): MergeBadge | null {
  const count = mergeCount ?? 0
  if (count <= 0) return null
  if (count <= 2) return 'star'
  if (count <= 5) return 'moon'
  return 'sun'
}

export interface GachaStats {
  total_pulls: number
  total_cost: number
  by_rarity: Record<string, number>
  recent_rtp?: number
  recent_pulls?: number
  recent_cost?: number
  recent_value?: number
}