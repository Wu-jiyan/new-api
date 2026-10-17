import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  AASyncResult,
  DeepSweSyncResult,
  ModelRatingListResult,
  ModelSquareDefaults,
  ModelSquareFilter,
  RatingDimension,
  RatingThresholds,
} from './types'

export async function listModelRatings(params: {
  keyword?: string
  rating?: string
  page?: number
  pageSize?: number
}): Promise<ModelRatingListResult> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 20),
  })
  if (params.keyword) query.set('keyword', params.keyword)
  if (params.rating) query.set('rating', params.rating)
  const res = await api.get<{
    success: boolean
    message?: string
    data: ModelRatingListResult['data']
    total: number
    thresholds: ModelRatingListResult['thresholds']
    deepswe: ModelRatingListResult['deepswe']
    aa: ModelRatingListResult['aa']
  }>(`/api/admin/model-rating?${query.toString()}`)
  requireServerSuccess(res.data)
  return {
    data: res.data?.data ?? [],
    total: res.data?.total ?? 0,
    thresholds: res.data?.thresholds,
    deepswe: res.data?.deepswe,
    aa: res.data?.aa,
  }
}

export async function setDeepSweScore(
  id: number,
  ratingScore: number
): Promise<void> {
  const res = await api.put<{ success: boolean; message?: string }>(
    `/api/admin/model-rating/${id}`,
    { rating_score: ratingScore }
  )
  requireServerSuccess(res.data)
}

export async function setAAScores(
  id: number,
  scores: {
    aa_intelligence_score: number
    aa_coding_score: number
    aa_agentic_score: number
  }
): Promise<void> {
  const res = await api.put<{ success: boolean; message?: string }>(
    `/api/admin/model-rating/${id}/aa`,
    scores
  )
  requireServerSuccess(res.data)
}

export async function batchResetModelRatings(ids: number[]): Promise<{
  deepswe: number
  aa: number
}> {
  const res = await api.post<{
    success: boolean
    message?: string
    data: { deepswe: number; aa: number }
  }>('/api/admin/model-rating/reset', { ids })
  requireServerSuccess(res.data)
  return res.data?.data ?? { deepswe: 0, aa: 0 }
}

export async function syncDeepSweRatings(): Promise<DeepSweSyncResult> {
  const res = await api.post<{
    success: boolean
    message?: string
    data: DeepSweSyncResult
  }>('/api/admin/model-rating/sync/deepswe')
  requireServerSuccess(res.data)
  return res.data?.data
}

export async function syncAARatings(): Promise<AASyncResult> {
  const res = await api.post<{
    success: boolean
    message?: string
    data: AASyncResult
  }>('/api/admin/model-rating/sync/aa')
  requireServerSuccess(res.data)
  return res.data?.data
}

export async function updateRatingThresholds(
  dimension: RatingDimension,
  thresholds: RatingThresholds
): Promise<number> {
  const res = await api.put<{
    success: boolean
    message?: string
    data?: { retiered: number }
  }>('/api/admin/model-rating/thresholds', { dimension, ...thresholds })
  requireServerSuccess(res.data)
  return res.data?.data?.retiered ?? 0
}

export async function updateAASettings(apiKey: string): Promise<boolean> {
  const res = await api.put<{
    success: boolean
    message?: string
    data?: { api_key_set: boolean }
  }>('/api/admin/model-rating/aa-settings', { api_key: apiKey })
  requireServerSuccess(res.data)
  return res.data?.data?.api_key_set ?? false
}

export async function getSquareDefaults(): Promise<{
  defaults: ModelSquareDefaults
  sorts: string[]
  filter?: ModelSquareFilter
}> {
  const res = await api.get<{
    success: boolean
    message?: string
    data: ModelSquareDefaults
    sorts: string[]
    filter?: ModelSquareFilter
  }>('/api/admin/model-rating/square-defaults')
  requireServerSuccess(res.data)
  if (!res.data?.data) {
    throw new Error('Missing model square defaults in response')
  }
  return {
    defaults: res.data.data,
    sorts: res.data.sorts ?? [],
    filter: res.data.filter,
  }
}

export async function updateSquareDefaults(
  next: ModelSquareDefaults,
  filter: ModelSquareFilter
): Promise<ModelSquareDefaults> {
  const res = await api.put<{
    success: boolean
    message?: string
    data?: ModelSquareDefaults
  }>('/api/admin/model-rating/square-defaults', { ...next, filter })
  requireServerSuccess(res.data)
  if (!res.data?.data) {
    throw new Error('Missing model square defaults in response')
  }
  return res.data.data
}
