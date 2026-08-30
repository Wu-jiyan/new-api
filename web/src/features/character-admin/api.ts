import { api } from '@/lib/api'

import type { CharacterAdminItem } from './types'

export async function fetchAdminCharacters(keyword?: string): Promise<CharacterAdminItem[]> {
  const params = keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''
  const res = await api.get<{ success: boolean; message?: string; data: CharacterAdminItem[] }>(
    `/api/character/admin/characters${params}`,
    { skipErrorHandler: true }
  )
  if (!res.data?.success) throw new Error(res.data?.message ?? 'Failed to load characters')
  return res.data?.data ?? []
}

export async function createCharacter(
  data: Partial<CharacterAdminItem>
): Promise<CharacterAdminItem> {
  const res = await api.post<{ success: boolean; message?: string; data: CharacterAdminItem }>(
    '/api/character/admin/characters',
    data,
    { skipErrorHandler: true }
  )
  if (!res.data?.success) throw new Error(res.data?.message ?? 'Failed to create character')
  return res.data?.data
}

export async function updateCharacter(id: number, data: Partial<CharacterAdminItem>): Promise<void> {
  const res = await api.put<{ success: boolean; message?: string }>(
    `/api/character/admin/characters/${id}`,
    data,
    { skipErrorHandler: true }
  )
  if (!res.data?.success) throw new Error(res.data?.message ?? 'Failed to update character')
}

export async function deleteCharacter(id: number): Promise<void> {
  await api.delete(`/api/character/admin/characters/${id}`)
}

export async function generateCharacterImage(
  id: number,
  stageIndex: number,
  prompt: string,
  style?: string
): Promise<{ image_url: string }> {
  const res = await api.post<{ success: boolean; data: { image_url: string } }>(
    `/api/character/admin/characters/${id}/stages/${stageIndex}/generate`,
    { prompt, style }
  )
  return res.data?.data
}

export async function uploadCharacterImage(
  id: number,
  stageIndex: number,
  file: File
): Promise<{ image_url: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ success: boolean; data: { image_url: string } }>(
    `/api/character/admin/characters/${id}/stages/${stageIndex}/image`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return res.data?.data
}

export async function saveCharacterScript(
  id: number,
  stageIndex: number,
  script: { speaker: string; text: string }[]
): Promise<void> {
  await api.post(`/api/character/admin/characters/${id}/stages/${stageIndex}/script`, { script })
}

export async function updateCharacterThresholds(stage2: number, stage3: number): Promise<void> {
  await api.put('/api/character/admin/thresholds', {
    stage2_tokens: stage2,
    stage3_tokens: stage3,
  })
}
