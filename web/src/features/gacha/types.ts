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
  model_name: string
  group: string
  weight: number
  quota: number
  quota_min?: number
  quota_max?: number
  expire_days: number
}

export interface PullCardResult {
  card_id: number
  model_name: string
  group: string
  rarity: string
  quota: number
  expire_days: number
  expired_at: number
  merge_count?: number
  card_token?: string
  card_token_created?: boolean
}

export interface PullResponse {
  pull_record_id: number
  cards: PullCardResult[]
  pity_before: number
  pity_after: number
}

export interface UserGachaCard {
  id: number
  user_id: number
  model_name: string
  group: string
  total_quota: number
  remain_quota: number
  status: number
  merge_count?: number
  expired_time: number
  created_time: number
  token_masked?: string
  token_status?: number
  token_exists?: boolean
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
