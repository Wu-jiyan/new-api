import { api } from '@/lib/api'

import type {
  GachaEntitlement,
  GachaPool,
  GachaStats,
  PullResponse,
} from './types'

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

export async function fetchGachaEntitlements(
  status?: string,
  page = 1,
  pageSize = 50
): Promise<{
  data: GachaEntitlement[]
  total: number
  ratings: Record<string, string>
}> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  if (status) params.set('status', status)
  const res = await api.get<{
    success: boolean
    data: GachaEntitlement[]
    total: number
    ratings: Record<string, string>
  }>(`/api/gacha/entitlements?${params.toString()}`)
  return {
    data: res.data?.data ?? [],
    total: res.data?.total ?? 0,
    ratings: res.data?.ratings ?? {},
  }
}

export async function fetchGachaStats(): Promise<GachaStats | null> {
  const res = await api.get<{ success: boolean; data: GachaStats }>('/api/gacha/stats')
  return res.data?.data ?? null
}