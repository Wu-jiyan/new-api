/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { SSE } from 'sse.js'

import { getFreshAuthHeaders } from '@/lib/api'

export interface CharacterStreamCallbacks {
  onChunk: (text: string) => void
  onDone: () => void
  onError: (message: string) => void
}

export interface CharacterChatStreamPayload {
  content: string
  stage_index?: number
  from_story?: boolean
}

/** 发起角色对话 SSE 流（/api/character/:model/chat），返回 stop 控制器 */
export function sendCharacterChatStream(
  url: string,
  payload: CharacterChatStreamPayload,
  callbacks: CharacterStreamCallbacks
): { stop: () => void } {
  let source: SSE | null = null
  let completed = false
  void getFreshAuthHeaders()
    .then((headers) => {
      if (completed) return
      source = new SSE(url, {
        headers,
        method: 'POST',
        payload: JSON.stringify(payload),
      }) as unknown as SSE
      source.addEventListener(
        'message',
        (event: Event & { data?: string }) => {
          if (completed) return
          // sse.js 的 event.data 已剥离 "data:" 前缀，直接是原始帧字符串：
          // 要么是 OpenAI chunk JSON（{"choices":[{delta:{content}}]}），要么是 [DONE]。
          // 与 playground parseStreamMessageUpdates 相同的解析路径（JSON.parse(data)），
          // 因此这里不用 extractStreamText（那是聚合多行 data: 文本用的）。
          const data = (event as unknown as { data?: string }).data ?? ''
          if (data === '[DONE]') {
            completed = true
            source?.close()
            callbacks.onDone()
            return
          }
          let delta = ''
          try {
            const chunk = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[]
            }
            delta = chunk.choices?.[0]?.delta?.content ?? ''
          } catch {
            return // 忽略无法解析的帧（如空行/心跳）
          }
          if (delta) callbacks.onChunk(delta)
        }
      )
      source.addEventListener(
        'readystatechange',
        (event: Event & { readyState?: number }) => {
          if (completed) return
          const ready = (event as unknown as { readyState?: number })
            .readyState
          if (ready === 2) {
            // 服务端正常关闭（ReadyState CLOSED）
            completed = true
            callbacks.onDone()
          }
        }
      )
      source.addEventListener('error', () => {
        if (completed) return
        completed = true
        callbacks.onError('stream error')
      })
      source.stream()
    })
    .catch(() => {
      if (completed) return
      completed = true
      callbacks.onError('auth error')
    })
  return {
    stop: () => {
      completed = true
      source?.close()
    },
  }
}
