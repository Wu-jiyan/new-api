export interface CharacterAdminItem {
  id: number
  model_name: string
  display_name: string
  title?: string
  description?: string
  tags?: string
  system_prompt?: string
  stages_json?: string
  enabled: boolean
  created_at: number
  updated_at: number
}
