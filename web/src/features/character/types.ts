export interface CharacterScript {
  speaker: string
  text: string
  pose?: string
}

export interface CharacterStageView {
  index: number
  name: string
  image_url?: string
  unlock_tokens: number
  unlock_text: string
  script?: CharacterScript[]
}

export interface CharacterView {
  id: number
  model_name: string
  display_name: string
  title?: string
  description?: string
  tags?: string
  max_stage: number
  total_tokens: number
  total_calls: number
  stages: CharacterStageView[]
}
