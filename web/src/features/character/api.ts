import { api } from '@/lib/api'

import type {
  CharacterChatMessagesPage,
  CharacterChatMeta,
  CharacterPetStatus,
  CharacterPetView,
  CharacterScript,
  CharacterView,
} from './types'

export async function fetchCharacters(): Promise<CharacterView[]> {
  const res = await api.get<{ success: boolean; data: CharacterView[] }>(
    '/api/character/characters'
  )
  return res.data?.data ?? []
}

export async function fetchCharacter(
  modelName: string
): Promise<CharacterView | null> {
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
  const res = await api.post<{
    success: boolean
    message?: string
    data: UnlockResult
  }>(
    `/api/character/${encodeURIComponent(modelName)}/unlock`,
    { stage },
    { skipErrorHandler: true }
  )
  if (!res.data?.success) {
    throw new Error(res.data?.message ?? 'Failed to unlock')
  }
  return res.data?.data
}

export async function forgetCharacter(modelName: string): Promise<void> {
  const res = await api.post(
    `/api/character/${encodeURIComponent(modelName)}/forget`
  )
  if (!res.data?.success) {
    throw new Error(res.data?.message ?? 'Failed to forget')
  }
}

export async function fetchCharacterChatMeta(
  modelName: string
): Promise<CharacterChatMeta> {
  const res = await api.get<{ success: boolean; data: CharacterChatMeta }>(
    `/api/character/${encodeURIComponent(modelName)}/chat/meta`
  )
  return (
    res.data?.data ?? { has_history: false, stage_index: 0, message_count: 0 }
  )
}

export async function fetchCharacterChatMessages(
  modelName: string,
  cursorId?: number,
  limit = 30
): Promise<CharacterChatMessagesPage> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursorId) query.set('cursor_id', String(cursorId))
  const res = await api.get<{
    success: boolean
    data: CharacterChatMessagesPage
  }>(
    `/api/character/${encodeURIComponent(modelName)}/chat/messages?${query.toString()}`
  )
  return res.data?.data ?? { items: [], has_more: false }
}

export async function fetchCharacterPet(): Promise<CharacterPetView> {
  const res = await api.get<{ success: boolean; data: CharacterPetView }>(
    '/api/character/pet',
    { skipErrorHandler: true }
  )
  return res.data?.data ?? { active: false }
}

/** 设置桌宠；modelName 传空字符串表示收回桌宠。返回服务端确认后的桌宠状态。 */
export async function setCharacterPet(
  modelName: string
): Promise<CharacterPetView> {
  const res = await api.post<{
    success: boolean
    message?: string
    data: CharacterPetView
  }>(
    '/api/character/pet',
    { model_name: modelName },
    { skipErrorHandler: true }
  )
  if (!res.data?.success) {
    throw new Error(res.data?.message ?? 'Failed to update desk pet')
  }
  return res.data?.data ?? { active: false }
}

/** 绔欑偣鎻愰啋锛氬彧杩斿洖褰撳墠鐢ㄦ埛鑷繁鏁版嵁涓婇渶瑕佹敞鎰忕殑浜嬫儏锛岀┖鍒楄〃鏄甯告儏鍐点€?*/
export async function fetchCharacterPetStatus(): Promise<CharacterPetStatus> {
  const res = await api.get<{ success: boolean; data: CharacterPetStatus }>(
    '/api/character/pet/status',
    { skipErrorHandler: true }
  )
  return res.data?.data ?? { items: [] }
}
