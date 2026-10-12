import { api } from '@/lib/api'

import type {
  GachaCardEntry,
  GachaPool,
  GenerateGachaEntryReq,
  GenerateGachaPreview,
  PoolEconomics,
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

