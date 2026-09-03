import { api } from '@/lib/api'

import type { CharacterScript, CharacterView } from './types'

export async function fetchCharacters(): Promise<CharacterView[]> {
  const res = await api.get<{ success: boolean; data: CharacterView[] }>('/api/character/characters')
  return res.data?.data ?? []
}

export async function fetchCharacter(modelName: string): Promise<CharacterView | null> {
  const res = await api.get<{ success: boolean; data: CharacterView }>(
    `/api/character/${encodeURIComponent(modelName)}`
  )
  return res.data?.data ?? null
}

export async function fetchCharacterScript(
  modelName: string,
  stageIndex: number
): Promise<CharacterScript[]> {
  const res = await api.get<{ success: boolean; data: CharacterScript[] }>(
    `/api/character/${encodeURIComponent(modelName)}/script/${stageIndex}`
  )
  return res.data?.data ?? []
}

export interface UnlockResult {
  max_stage: number
  affinity: number
  total_tokens: number
  total_calls: number
}

export async function unlockCharacter(
  modelName: string,
  stage: number
): Promise<UnlockResult> {
  const res = await api.post<{ success: boolean; message?: string; data: UnlockResult }>(
    `/api/character/${encodeURIComponent(modelName)}/unlock`,
    { stage },
    { skipErrorHandler: true }
  )
  if (!res.data?.success) throw new Error(res.data?.message ?? 'Failed to unlock')
  return res.data?.data
}
