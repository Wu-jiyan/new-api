export interface CharacterAdminItem {
  id: number
  model_name: string
  display_name: string
  title?: string
  description?: string
  tags?: string
  system_prompt?: string
  affinity_required?: number
  default_model?: string
  stages_json?: string
  enabled: boolean
  created_at: number
  updated_at: number
}

// —— 编辑草稿类型（管理端表单） ——

export interface PoseDraft {
  name: string
  imageUrl: string
}

export interface ChoiceDraft {
  text: string
  reply: string
  pose: string
  effect: string
  background: string
}

export interface ScriptLineDraft {
  speaker: string
  text: string
  pose: string
  effect: string
  background: string
  choices: ChoiceDraft[]
}

export interface StageDraft {
  name: string
  unlockTokens: number
  affinityRequired: number
  imageUrl: string
  backgroundUrl: string
  defaultEffect: string
  poses: PoseDraft[]
  script: ScriptLineDraft[]
}
