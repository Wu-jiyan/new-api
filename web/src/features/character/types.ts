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
  max_stage: number
  affinity: number
  affinity_required: number
  total_tokens: number
  total_calls: number
  stages: CharacterStageView[]
  backgrounds?: GlobalBackground[]
}

export interface CharacterChatMeta {
  has_history: boolean
  stage_index: number
  stage_name?: string
  message_count: number
  initial_context?: string
  summary?: string
}

export interface CharacterChatMessageItem {
  id: number
  role: 'user' | 'assistant'
  content: string
  pose?: string
  effect?: string
  background?: string
  affinity_delta: number
  created_at: number
}

export interface CharacterChatMessagesPage {
  items: CharacterChatMessageItem[]
  has_more: boolean
}
