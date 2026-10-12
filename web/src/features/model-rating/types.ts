export type RatingDimension =
  | 'deepswe'
  | 'aa_intelligence'
  | 'aa_coding'
  | 'aa_agentic'

export interface RatingThresholds {
  ur: number
  ssr: number
  sr: number
  r: number
}

export interface ModelRatingItem {
  id: number
  model_name: string
  /** DeepSWE 维度：档位与分数（档位入库，由分数按阈值推导） */
  rating?: string
  rating_score?: number
  rating_source?: string
  /** Artificial Analysis 三维度分数 */
  aa_intelligence_score?: number
  aa_coding_score?: number
  aa_agentic_score?: number
  aa_source?: string
}

export interface DeepSweSyncResult {
  updated: number
  unchanged: number
  skipped_manual: number
  unmatched: number
  updated_models: { model_name: string; rating: string; rating_score: number }[]
}

export interface AASyncResult {
  updated: number
  unchanged: number
  skipped_manual: number
  unmatched: number
  matched_count: Record<string, number>
  fetched_count: Record<string, number>
  updated_models: {
    model_name: string
    aa_intelligence_score: number
    aa_coding_score: number
    aa_agentic_score: number
  }[]
}

export interface AASyncStatus {
  last_sync_at: number
  last_sync_num: number
  api_key_set: boolean
  last_error: string
}

export interface ModelRatingListResult {
  data: ModelRatingItem[]
  total: number
  thresholds: Record<RatingDimension, RatingThresholds>
  deepswe: { last_sync_at: number; last_sync_num: number }
  aa: AASyncStatus
}

/** 同步结果在 DeepSWE 与 AA 两种响应之间归一化后的展示形状。 */
export interface SyncSummary {
  updated: number
  unchanged: number
  unmatched: number
  skippedManual: number
  models: { modelName: string; score: number }[]
}