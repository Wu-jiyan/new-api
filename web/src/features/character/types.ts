export interface CharacterPose {
  name: string
  image_url: string
}

export interface CharacterChoice {
  text: string
  reply: string
  pose?: string
  effect?: string
  background?: string
}

export interface CharacterScript {
  speaker: string
  text: string
  pose?: string
  effect?: string
  background?: string
  choices?: CharacterChoice[]
}

export interface CharacterStageView {
  index: number
  name: string
  image_url?: string
  background_url?: string
  default_effect?: string
  poses?: CharacterPose[]
  silhouette_url?: string
  unlock_tokens: number
  affinity_required?: number
  unlock_text: string
  claimed: boolean
  eligible: boolean
  script?: CharacterScript[]
}

export interface GlobalBackground {
  id: number
  name: string
  image_url: string
  created_at: number
  updated_at: number
}

export interface CharacterView {
  id: number
  model_name: string
  display_name: string
  title?: string
  description?: string
  tags?: string
  system_prompt?: string
  pet_image_url?: string
  max_stage: number
  affinity: number
  affinity_required: number
  default_model?: string
  total_tokens: number
  total_calls: number
  stages: CharacterStageView[]
  backgrounds?: GlobalBackground[]
}

/** 桌宠当前状态：服务端已确认「能显示」的桌宠，active=false 表示没有可用桌宠。 */
export interface CharacterPetView {
  active: boolean
  model_name?: string
  display_name?: string
  image_url?: string
}

export type PetAlertSeverity = 'info' | 'warning' | 'critical'

/**
 * One thing worth telling the user about their own account. `key` is an English
 * source string translated on the client; `params` carries raw values only, so
 * amounts and counts are formatted in the reader's language rather than baked
 * into the response.
 */
export interface PetStatusItem {
  key: string
  severity: PetAlertSeverity
  params: Record<string, string | number>
}

export interface CharacterPetStatus {
  items: PetStatusItem[]
}
export interface CharacterChatMeta {
  has_history: boolean
  stage_index: number
  stage_name?: string
  message_count: number
  initial_context?: string
  summary?: string
  model?: string
  group?: string
}

export interface CharacterChatChoiceItem {
  text: string
}

export interface CharacterChatMessageItem {
  id: number
  role: 'user' | 'assistant'
  content: string
  pose?: string
  effect?: string
  background?: string
  affinity_delta: number
  choices?: CharacterChatChoiceItem[]
  created_at: number
}

export interface CharacterChatMessagesPage {
  items: CharacterChatMessageItem[]
  has_more: boolean
}
