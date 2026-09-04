import { api } from '@/lib/api'

import type {
  CharacterChatMessagesPage,
  CharacterChatMeta,
  CharacterScript,
  CharacterView,
} from './types'

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

export async function fetchCharacterChatMeta(modelName: string): Promise<CharacterChatMeta> {
  const res = await api.get<{ success: boolean; data: CharacterChatMeta }>(
    `/api/character/${encodeURIComponent(modelName)}/chat/meta`
  )
  return res.data?.data ?? { has_history: false, stage_index: 0, message_count: 0 }
}

export async function fetchCharacterChatMessages(
  modelName: string,
  cursorId?: number,
  limit = 30
): Promise<CharacterChatMessagesPage> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursorId) query.set('cursor_id', String(cursorId))
  const res = await api.get<{ success: boolean; data: CharacterChatMessagesPage }>(
    `/api/character/${encodeURIComponent(modelName)}/chat/messages?${query.toString()}`
  )
  return res.data?.data ?? { items: [], has_more: false }
}
