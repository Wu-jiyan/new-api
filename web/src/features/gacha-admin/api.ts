import { api } from '@/lib/api'

import type {
  GachaCardEntry,
  GachaPool,
  GenerateGachaEntryReq,
  GenerateGachaPreview,
  ModelRatingItem,
  PoolEconomics,
  RatingThresholds,
} from './types'

export async function listPools(): Promise<GachaPool[]> {
  const res = await api.get<{ success: boolean; data: GachaPool[] }>('/api/gacha/admin/pools')
  return res.data?.data ?? []
}

export async function createPool(pool: Partial<GachaPool>): Promise<GachaPool> {
  const res = await api.post<{ success: boolean; data: GachaPool }>('/api/gacha/admin/pools', pool)
  return res.data?.data
}

export async function updatePool(id: number, pool: Partial<GachaPool>): Promise<void> {
  await api.put(`/api/gacha/admin/pools/${id}`, pool)
}

export async function deletePool(id: number): Promise<void> {
  await api.delete(`/api/gacha/admin/pools/${id}`)
}

export async function upsertEntry(poolId: number, entry: GachaCardEntry): Promise<GachaCardEntry> {
  const url = `/api/gacha/admin/pools/${poolId}/entries`
  const res = entry.id
    ? await api.put<{ success: boolean; data: GachaCardEntry }>(url, entry)
    : await api.post<{ success: boolean; data: GachaCardEntry }>(url, entry)
  return res.data?.data
}

export async function deleteEntry(id: number): Promise<void> {
  await api.delete(`/api/gacha/admin/entries/${id}`)
}

export async function generatePreview(poolId: number, req: GenerateGachaEntryReq): Promise<GenerateGachaPreview> {
  const res = await api.post<{ success: boolean; data: GenerateGachaPreview }>(
    `/api/gacha/admin/pools/${poolId}/generate-preview`,
    req
  )
  return res.data?.data
}

export async function generateEntries(poolId: number, req: GenerateGachaEntryReq): Promise<GenerateGachaPreview> {
  const res = await api.post<{ success: boolean; data: GenerateGachaPreview }>(
    `/api/gacha/admin/pools/${poolId}/generate`,
    req
  )
  return res.data?.data
}

export async function fetchEconomics(poolId: number): Promise<PoolEconomics> {
  const res = await api.get<{ success: boolean; data: PoolEconomics }>(
    `/api/gacha/admin/pools/${poolId}/economics`
  )
  return res.data?.data
}

export interface GachaRatingSyncItem {
  model_name: string
  rating: string
  rating_score: number
}

export interface GachaRatingSyncResult {
  updated: number
  unchanged: number
  skipped_manual: number
  unmatched: number
  updated_models: GachaRatingSyncItem[]
}

export async function listRatings(
  keyword?: string,
  rating?: string,
  page = 1,
  pageSize = 20
): Promise<{
  data: ModelRatingItem[]
  total: number
  thresholds: RatingThresholds
  lastSyncAt: number
  lastSyncNum: number
}> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (keyword) params.set('keyword', keyword)
  if (rating) params.set('rating', rating)
  const res = await api.get<{
    success: boolean
    data: ModelRatingItem[]
    total: number
    thresholds: RatingThresholds
    last_sync_at: number
    last_sync_num: number
  }>(`/api/gacha/admin/ratings?${params.toString()}`)
  return {
    data: res.data?.data ?? [],
    total: res.data?.total ?? 0,
    thresholds: res.data?.thresholds,
    lastSyncAt: res.data?.last_sync_at ?? 0,
    lastSyncNum: res.data?.last_sync_num ?? 0,
  }
}

export async function setRating(id: number, rating: string, ratingScore: number): Promise<void> {
  await api.put(`/api/gacha/admin/ratings/${id}`, { rating, rating_score: ratingScore })
}

export async function batchResetRatings(ids: number[]): Promise<number> {
  const res = await api.post<{ success: boolean; data: number }>('/api/gacha/admin/ratings/reset', { ids })
  return res.data?.data ?? 0
}

export async function syncRatings(): Promise<GachaRatingSyncResult> {
  const res = await api.post<{ success: boolean; data: GachaRatingSyncResult }>('/api/gacha/admin/sync-rating')
  return res.data?.data
}

export async function updateThresholds(t: RatingThresholds): Promise<void> {
  await api.put('/api/gacha/admin/settings', t)
}
