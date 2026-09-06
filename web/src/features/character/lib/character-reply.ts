export interface CharacterReplyChoice {
  text: string
}

export interface CharacterReplyLine {
  speaker?: string
  text: string
  pose?: string
  effect?: string
  background?: string
  choices?: CharacterReplyChoice[]
}

export interface CharacterReply {
  reply: string
  /** 新协议：多句剧本段（逐句播放，末句带 choices）；兼容旧单句形态 */
  lines?: CharacterReplyLine[]
  pose?: string
  effect?: string
  background?: string
  affinityDelta?: number
  choices?: CharacterReplyChoice[]
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

function cleanChoices(raw: unknown): CharacterReplyChoice[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const cleaned = raw
    .map((c) =>
      c && typeof c === 'object' ? String((c as Record<string, unknown>).text ?? '').trim() : ''
    )
    .filter(Boolean)
    .slice(0, 4)
    .map((text) => ({ text }))
  return cleaned.length > 0 ? cleaned : undefined
}

/** 拆句：括号动作独立成句，其余按句末标点切分；省略号（……）与波浪号不拆，保住语气拖延 */
export function splitLongLine(text: string): string[] {
  const units: string[] = []
  let buf = ''
  let inParen = false
  for (const ch of text) {
    buf += ch
    if (ch === '（' || ch === '(') {
      inParen = true
      continue
    }
    let end = false
    if (inParen && (ch === '）' || ch === ')')) {
      inParen = false
      end = true
    } else if (
      !inParen &&
      '。！？!?；;\n'.includes(ch)
    ) {
      end = true
    }
    if (end) {
      const t = buf.trim()
      if (t) units.push(t)
      buf = ''
    }
  }
  const t = buf.trim()
  if (t) units.push(t)
  return units
}

/** 归一化一个台词对象并拆成长句 → 多个短句；选项挂在末句 */
function normalizeLineObjs(l: unknown): CharacterReplyLine[] {
  if (!l || typeof l !== 'object') return []
  const rec = l as Record<string, unknown>
  const text = String(rec.text ?? '').trim().slice(0, 300)
  if (!text) return []
  const speaker = String(rec.speaker ?? '').trim() || undefined
  const pose = String(rec.pose ?? '').trim() || undefined
  const effect = String(rec.effect ?? '').trim() || undefined
  const background = String(rec.background ?? '').trim() || undefined
  const choices = cleanChoices(rec.choices)
  const units = splitLongLine(text)
  return units.map((unit, i) => ({
    speaker,
    text: unit,
    pose: i === 0 ? pose : undefined,
    effect: i === 0 ? effect : undefined,
    background: i === 0 ? background : undefined,
    choices: i === units.length - 1 ? choices : undefined,
  }))
}

/**
 * 流式增量解析：从累积的原始文本中提取 lines[] 里「已完整闭合」的台词对象，
 * 返回第 skipCount 句之后的新增部分。解析出的句子可立即上屏，无需等整段 JSON 结束。
 */
export function extractStreamedLines(raw: string, skipCount: number): CharacterReplyLine[] {
  const arrIdx = raw.indexOf('"lines"')
  if (arrIdx < 0) return []
  const bracketIdx = raw.indexOf('[', arrIdx)
  if (bracketIdx < 0) return []

  const complete: CharacterReplyLine[] = []
  let depth = 0
  let objStart = -1
  let inStr = false
  let esc = false
  for (let i = bracketIdx + 1; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) objStart = i
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0 && objStart >= 0) {
        complete.push(...normalizeLineObjs(safeParse(raw.slice(objStart, i + 1))))
        objStart = -1
      }
      continue
    }
  }
  return complete.slice(skipCount)
}

function safeParse(slice: string): unknown {
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}

/** 容错解析 AI 回复 JSON：剥围栏/前后说明文字，取首 { 至末 }；无可播台词视为失败 */
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
  const topReply = String((obj as Record<string, unknown>).reply ?? '').trim()
  const pick = (k: string) => {
    const v = (obj as Record<string, unknown>)[k]
    return v == null ? undefined : String(v)
  }
  const delta = (obj as Record<string, unknown>).affinity_delta
  // lines：多句剧本段（去空句、截断 300 字、拆句后最多 12 句，超限保留段尾）
  const rawLines = (obj as Record<string, unknown>).lines
  let lines: CharacterReplyLine[] | undefined
  if (Array.isArray(rawLines)) {
    const cleaned = rawLines
      .flatMap(normalizeLineObjs)
      .slice(-12)
    if (cleaned.length > 0) lines = cleaned
  }
  if (!lines && !topReply) return null
  const reply = lines ? lines[0].text : topReply
    return {
    reply,
    lines,
    pose: pick('pose'),
    effect: pick('effect'),
    background: pick('background'),
    affinityDelta: typeof delta === 'number' && Number.isFinite(delta) ? delta : undefined,
    choices: cleanChoices((obj as Record<string, unknown>).choices),
  }
}
