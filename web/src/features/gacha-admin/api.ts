import { api } from '@/lib/api'

import type { GachaCardEntry, GachaPool, ModelRatingItem, PoolEconomics, RatingThresholds } from './types'

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

export async function fetchEconomics(poolId: number): Promise<PoolEconomics> {
  const res = await api.get<{ success: boolean; data: PoolEconomics }>(
    `/api/gacha/admin/pools/${poolId}/economics`
  )
  return res.data?.data
}

export async function listRatings(
  keyword?: string,
  rating?: string
): Promise<{ data: ModelRatingItem[]; total: number; thresholds: RatingThresholds }> {
  const params = new URLSearchParams()
  if (keyword) params.set('keyword', keyword)
  if (rating) params.set('rating', rating)
  const res = await api.get<{
    success: boolean
    data: ModelRatingItem[]
    total: number
    thresholds: RatingThresholds
  }>(`/api/gacha/admin/ratings?${params.toString()}`)
  return { data: res.data?.data ?? [], total: res.data?.total ?? 0, thresholds: res.data?.thresholds }
}

export async function setRating(id: number, rating: string, ratingScore: number): Promise<void> {
  await api.put(`/api/gacha/admin/ratings/${id}`, { rating, rating_score: ratingScore })
}

export async function syncRatings(): Promise<void> {
  await api.post('/api/gacha/admin/sync-rating')
}

export async function updateThresholds(t: RatingThresholds): Promise<void> {
  await api.put('/api/gacha/admin/settings', t)
}
