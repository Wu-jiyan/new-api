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

export type CharacterAssetType = 'portrait' | 'background' | 'pose'

export interface GenerateCharacterImageOptions {
  type?: CharacterAssetType
  pose_name?: string
  pose_prompt?: string
  style?: string
}

export type CharacterImageResult = {
  image_url?: string
  background_url?: string
  pose_name?: string
}

export async function generateCharacterImage(
  id: number,
  stageIndex: number,
  prompt: string,
  options?: GenerateCharacterImageOptions
): Promise<CharacterImageResult> {
  const res = await api.post<{ success: boolean; data: CharacterImageResult }>(
    `/api/character/admin/characters/${id}/stages/${stageIndex}/generate`,
    {
      prompt,
      style: options?.style,
      type: options?.type,
      pose_name: options?.pose_name,
      pose_prompt: options?.pose_prompt,
    }
  )
  return res.data?.data
}

export async function uploadCharacterImage(
  id: number,
  stageIndex: number,
  file: File,
  options?: { type?: CharacterAssetType; pose_name?: string }
): Promise<CharacterImageResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('type', options?.type ?? 'portrait')
  if (options?.pose_name) form.append('pose_name', options.pose_name)
  const res = await api.post<{ success: boolean; data: CharacterImageResult }>(
    `/api/character/admin/characters/${id}/stages/${stageIndex}/image`,
    form
  )
  return res.data?.data
}

// —— 系统级全局背景库（所有角色共用） ——

export interface GlobalBackgroundItem {
  id: number
  name: string
  image_url: string
  created_at: number
  updated_at: number
}

export async function fetchBackgroundLibrary(): Promise<GlobalBackgroundItem[]> {
  const res = await api.get<{ success: boolean; message?: string; data: GlobalBackgroundItem[] }>(
    '/api/character/admin/backgrounds',
    { skipErrorHandler: true }
  )
  if (!res.data?.success) throw new Error(res.data?.message ?? 'Failed to load backgrounds')
  return res.data?.data ?? []
}

export async function uploadBackground(name: string, file: File): Promise<GlobalBackgroundItem> {
  const form = new FormData()
  form.append('name', name)
  form.append('file', file)
  const res = await api.post<{ success: boolean; message?: string; data: GlobalBackgroundItem }>(
    '/api/character/admin/backgrounds/upload',
    form,
    { skipErrorHandler: true }
  )
  if (!res.data?.success) throw new Error(res.data?.message ?? 'Failed to upload background')
  return res.data?.data
}

export async function generateBackground(
  name: string,
  prompt: string
): Promise<GlobalBackgroundItem> {
  const res = await api.post<{ success: boolean; message?: string; data: GlobalBackgroundItem }>(
    '/api/character/admin/backgrounds/generate',
    { name, prompt },
    { skipErrorHandler: true }
  )
  if (!res.data?.success) throw new Error(res.data?.message ?? 'Failed to generate background')
  return res.data?.data
}

export async function deleteBackground(id: number): Promise<void> {
  await api.delete(`/api/character/admin/backgrounds/${id}`)
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
