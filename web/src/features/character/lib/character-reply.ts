export interface CharacterReply {
  reply: string
  pose?: string
  effect?: string
  background?: string
  affinityDelta?: number
}

/** 聚合 OpenAI 流式 data: {...delta.content...} 原始文本 */
export function extractStreamText(raw: string): string {
  let out = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
      for (const choice of chunk.choices ?? []) {
        out += choice.delta?.content ?? ''
      }
    } catch {
      // 忽略无法解析的行
    }
  }
  return out
}

/** 容错解析 AI 回复 JSON：剥围栏/前后说明文字，取首 { 至末 }；reply 为空视为失败 */
export function parseCharacterReply(text: string): CharacterReply | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const reply = String((obj as Record<string, unknown>).reply ?? '').trim()
  if (!reply) return null
  const pick = (k: string) => {
    const v = (obj as Record<string, unknown>)[k]
    return v == null ? undefined : String(v)
  }
  const delta = (obj as Record<string, unknown>).affinity_delta
  return {
    reply,
    pose: pick('pose'),
    effect: pick('effect'),
    background: pick('background'),
    affinityDelta: typeof delta === 'number' && Number.isFinite(delta) ? delta : undefined,
  }
}
