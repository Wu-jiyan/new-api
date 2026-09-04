import { describe, expect, it } from 'vitest'

import { extractStreamText, parseCharacterReply } from './character-reply'

describe('extractStreamText', () => {
  it('聚合 delta content', () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
      'data: [DONE]\n\n'
    expect(extractStreamText(raw)).toBe('你好')
  })
  it('不可解析时返回空串', () => {
    expect(extractStreamText('boom')).toBe('')
  })
})

describe('parseCharacterReply', () => {
  it('解析裸 JSON', () => {
    const r = parseCharacterReply('{"reply":"嗨","pose":"happy","effect":"fade","background":"机房","affinity_delta":2}')
    expect(r).toEqual({ reply: '嗨', pose: 'happy', effect: 'fade', background: '机房', affinityDelta: 2 })
  })
  it('剥 markdown 围栏', () => {
    expect(parseCharacterReply('```json\n{"reply":"嗯"}\n```')?.reply).toBe('嗯')
  })
  it('剥前后说明文字', () => {
    expect(parseCharacterReply('她低头说道：{"reply":"好吧"}（她笑了）')?.reply).toBe('好吧')
  })
  it('坏 JSON 返回 null', () => {
    expect(parseCharacterReply('完全不是 json')).toBeNull()
  })
  it('reply 为空返回 null', () => {
    expect(parseCharacterReply('{"pose":"happy"}')).toBeNull()
  })
})
