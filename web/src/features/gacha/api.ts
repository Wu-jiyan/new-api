import { api } from '@/lib/api'

import type { GachaPool, GachaStats, PullResponse, UserGachaCard } from './types'

export async function fetchGachaPools(): Promise<GachaPool[]> {
  const res = await api.get<{ success: boolean; data: GachaPool[] }>('/api/gacha/pools')
  return res.data?.data ?? []
}

export async function pullGachaCards(
  poolId: number,
  count: 1 | 10,
  pullId: string
): Promise<PullResponse> {
  const res = await api.post<{ success: boolean; data: PullResponse }>(
    `/api/gacha/pool/${poolId}/pull`,
    { count, pull_id: pullId }
  )
  return res.data?.data
}

export async function fetchGachaCards(
  status?: number,
  page = 1,
  pageSize = 50
): Promise<{ data: UserGachaCard[]; total: number; ratings: Record<string, string> }> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (status != null) params.set('status', String(status))
  const res = await api.get<{ success: boolean; data: UserGachaCard[]; total: number; ratings: Record<string, string> }>(
    `/api/gacha/cards?${params.toString()}`
  )
  return { data: res.data?.data ?? [], total: res.data?.total ?? 0, ratings: res.data?.ratings ?? {} }
}

export async function fetchGachaStats(): Promise<GachaStats | null> {
  const res = await api.get<{ success: boolean; data: GachaStats }>('/api/gacha/stats')
  return res.data?.data ?? null
}
