import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { ArrowLeft, Heart, RotateCcw, Send, Square } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { SSE } from 'sse.js'

import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getFreshAuthHeaders } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  fetchCharacter,
  fetchCharacterChatMessages,
  fetchCharacterChatMeta,
} from './api'
import { useSceneFlash } from './hooks/use-scene-flash'
import { parseCharacterReply } from './lib/character-reply'
import { resolveBackground, resolvePose } from './lib/scene'
import type {
  CharacterChatMessageItem,
  CharacterStageView,
} from './types'

interface CharacterStreamCallbacks {
  onChunk: (text: string) => void
  onDone: () => void
  onError: (message: string) => void
}

function sendCharacterChatStream(
  url: string,
  payload: { content: string; stage_index?: number; from_story?: boolean },
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

interface ChatItem {
  key: string
  role: 'user' | 'assistant'
  content: string
  pose?: string
  effect?: string
  background?: string
  affinityDelta?: number
  streaming?: boolean
  failed?: boolean
}

function toChatItem(message: CharacterChatMessageItem): ChatItem {
  return {
    key: `hist-${message.id}`,
    role: message.role,
    content: message.content,
    pose: message.pose,
    effect: message.effect,
    background: message.background,
    affinityDelta: message.affinity_delta,
  }
}

/** 打字机：streaming 过程中逐帧递增展示，文本增长时继续追赶 */
function TypewriterText({ text }: { text: string }) {
  const [typed, setTyped] = useState(0)
  const done = typed >= text.length

  useEffect(() => {
    if (done) return
    const timer = window.setInterval(() => {
      setTyped((prev) => {
        if (prev >= text.length) {
          window.clearInterval(timer)
          return prev
        }
        return prev + 2
      })
    }, 16)
    return () => window.clearInterval(timer)
  }, [done, text.length])

  return (
    <span className='whitespace-pre-wrap break-words'>
      {text.slice(0, typed)}
      {!done && <span className='text-white/70'>▍</span>}
    </span>
  )
}

interface ReplyFx {
  key: string
  effect?: string
}

export default function CharacterChatPage() {
  const { t } = useTranslation()
  const { modelName = '' } = useParams({ strict: false })
  const qc = useQueryClient()

  const { data: character, isLoading } = useQuery({
    queryKey: ['character', modelName],
    queryFn: () => fetchCharacter(modelName),
    enabled: !!modelName,
  })

  const { data: meta, isLoading: isMetaLoading } = useQuery({
    queryKey: ['character-chat-meta', modelName],
    queryFn: () => fetchCharacterChatMeta(modelName),
    enabled: !!modelName,
  })

  const { data: historyPage, isLoading: isHistoryLoading } = useQuery({
    queryKey: ['character-chat-history', modelName],
    queryFn: () => fetchCharacterChatMessages(modelName),
    enabled: !!modelName,
  })

  const [items, setItems] = useState<ChatItem[]>([])
  const [initialized, setInitialized] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)

  // 历史首屏：page.items 为升序（旧→新），直接作为初始会话
  useEffect(() => {
    if (!historyPage || initialized) return
    setItems(historyPage.items.map(toChatItem))
    setHasMore(historyPage.has_more)
    setInitialized(true)
  }, [historyPage, initialized])

  const loadEarlier = async () => {
    if (loadingEarlier || !modelName) return
    const oldestDbId = items.find((it) => it.key.startsWith('hist-'))?.key
    if (!oldestDbId) return
    const cursorId = Number(oldestDbId.slice('hist-'.length))
    setLoadingEarlier(true)
    try {
      const page = await fetchCharacterChatMessages(modelName, cursorId)
      setItems((prev) => [...page.items.map(toChatItem), ...prev])
      setHasMore(page.has_more)
    } finally {
      setLoadingEarlier(false)
    }
  }

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyFx, setReplyFx] = useState<ReplyFx | null>(null)
  const accRef = useRef('')
  const stopRef = useRef<(() => void) | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const activeStageIndex = meta?.stage_index ?? character?.max_stage
  const stage: CharacterStageView | undefined = useMemo(() => {
    if (!character) return undefined
    return (
      character.stages.find((s) => s.index === activeStageIndex) ??
      character.stages[0]
    )
  }, [character, activeStageIndex])

  // 视觉状态：取消息里最后一条带姿态/背景的 assistant（无则用阶段默认），flash 不回放
  const sceneItem = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i]
      if (it.role === 'assistant' && (it.pose || it.background)) {
        return it
      }
    }
    return undefined
  }, [items])

  const poseImg = resolvePose(stage, sceneItem?.pose)
  const backgroundUrl = resolveBackground(stage, character ?? { backgrounds: undefined }, sceneItem?.background)
  const sceneEffect = sceneItem?.effect || stage?.default_effect

  // 仅新回复（stream 完成）的 effect 触发闪屏，历史加载不闪
  const flash = useSceneFlash(replyFx?.effect, replyFx?.key)

  const startStream = (content: string, assistantKey: string) => {
    if (!modelName) return
    accRef.current = ''
    setSending(true)
    const ctrl = sendCharacterChatStream(
      `/api/character/${encodeURIComponent(modelName)}/chat`,
      { content, stage_index: activeStageIndex ?? 0, from_story: false },
      {
        onChunk: (delta) => {
          accRef.current += delta
          const full = accRef.current
          setItems((prev) =>
            prev.map((it) =>
              it.key === assistantKey ? { ...it, content: full } : it
            )
          )
        },
        onDone: () => {
          if (stopRef.current === null) return // 已被手动停止接管
          stopRef.current = null
          const full = accRef.current
          accRef.current = ''
          const parsed = parseCharacterReply(full)
          setItems((prev) =>
            prev.map((it) =>
              it.key === assistantKey
                ? {
                    ...it,
                    streaming: false,
                    content: parsed ? parsed.reply : full,
                    pose: parsed?.pose,
                    effect: parsed?.effect,
                    background: parsed?.background,
                    affinityDelta: parsed?.affinityDelta,
                  }
                : it
            )
          )
          if (parsed) setReplyFx({ key: assistantKey, effect: parsed.effect })
          setSending(false)
          qc.invalidateQueries({ queryKey: ['character', modelName] })
          qc.invalidateQueries({
            queryKey: ['character-chat-history', modelName],
          })
          qc.invalidateQueries({
            queryKey: ['character-chat-meta', modelName],
          })
        },
        onError: () => {
          if (stopRef.current === null) return
          stopRef.current = null
          accRef.current = ''
          setItems((prev) =>
            prev.map((it) =>
              it.key === assistantKey
                ? { ...it, streaming: false, failed: true }
                : it
            )
          )
          setSending(false)
        },
      }
    )
    stopRef.current = ctrl.stop
  }

  const sendMessage = (raw: string) => {
    const content = raw.trim()
    if (!content || stopRef.current || !modelName) return
    setDraft('')
    const ts = Date.now().toString(36)
    const userKey = `user-${ts}`
    const assistantKey = `assistant-${ts}`
    setItems((prev) => [
      ...prev,
      { key: userKey, role: 'user', content },
      {
        key: assistantKey,
        role: 'assistant',
        content: '',
        streaming: true,
      },
    ])
    startStream(content, assistantKey)
  }

  const stopGenerating = () => {
    if (!sending) return
    stopRef.current?.()
    stopRef.current = null
    accRef.current = ''
    setSending(false)
    // 流式输出的是 JSON 原文，半截内容不可读，直接移除占位项（user 消息保留）
    setItems((prev) => prev.filter((it) => !it.streaming))
  }

  const retryMessage = (failedKey: string) => {
    if (stopRef.current) return
    // 删除失败项，向上找同属一条的 user 内容并重发（user 消息保留）
    let userContent = ''
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].key === failedKey) break
      if (items[i].role === 'user') userContent = items[i].content
    }
    if (!userContent) return
    const ts = Date.now().toString(36)
    const assistantKey = `assistant-${ts}`
    setItems((prev) => {
      const next = prev.filter((it) => it.key !== failedKey)
      return [
        ...next,
        { key: assistantKey, role: 'assistant', content: '', streaming: true },
      ]
    })
    startStream(userContent, assistantKey)
  }

  // 输入区自适应高度
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    sendMessage(draft)
  }

  const hasLocalMessages = items.length > 0

  let historyEmptyView: ReactNode = null
  if (!hasLocalMessages) {
    if (isMetaLoading || isHistoryLoading) {
      historyEmptyView = (
        <div className='py-10 text-center text-sm text-muted-foreground'>
          {t('Loading conversation...')}
        </div>
      )
    } else if (!meta?.has_history) {
      historyEmptyView = (
        <div className='flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground'>
          {t('character.chat.emptyHint')}
        </div>
      )
    }
  }

  if (isLoading && !character) {
    return (
      <div className='flex min-h-0 flex-1 flex-col p-6'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='mt-4 h-56 w-full' />
        <Skeleton className='mt-4 flex-1 w-full' />
      </div>
    )
  }

  if (!character) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center text-muted-foreground'>
        {t('character.notFound')}
      </div>
    )
  }

  return (
    <div
      data-character-chat
      className='bg-background relative flex size-full min-h-0 flex-col overflow-hidden'
    >
      {/* 顶栏 */}
      <header className='z-10 flex shrink-0 flex-col gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur sm:px-6'>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('common.back')}
            onClick={() => window.history.back()}
          >
            <ArrowLeft className='size-4' />
          </Button>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <span className='truncate font-semibold'>
                {character?.display_name ?? modelName}
              </span>
              {meta?.stage_name && (
                <span className='rounded-full border px-2 py-0.5 text-xs text-muted-foreground'>
                  {meta.stage_name}
                </span>
              )}
            </div>
          </div>
          {character && (
            <div className='flex w-28 items-center gap-1.5 sm:w-36'>
              <Heart className='size-3.5 shrink-0 fill-current text-rose-500' />
              <div className='bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full'>
                <div
                  className='bg-rose-500 h-full rounded-full transition-all duration-300'
                  style={{
                    width: `${Math.max(0, Math.min(100, character.affinity))}%`,
                  }}
                />
              </div>
              <span className='text-xs tabular-nums text-muted-foreground'>
                {character.affinity}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* 场景区（44vh） */}
      <div className='relative h-[44vh] shrink-0 overflow-hidden bg-black'>
        {backgroundUrl ? (
          <img
            key={backgroundUrl}
            src={backgroundUrl}
            alt=''
            className='absolute inset-0 h-full w-full animate-[storyFadeIn_0.6s_ease] object-cover'
            style={{ animationName: 'storyFadeIn' }}
          />
        ) : (
          <div className='absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-900 to-black' />
        )}

        {poseImg && (
          <img
            key={poseImg}
            src={poseImg}
            alt=''
            className={cn(
              'pointer-events-none absolute bottom-0 left-1/2 h-full w-auto -translate-x-1/2 object-contain object-bottom',
              sceneEffect === 'fade' && 'animate-[storyFadeIn_0.5s_ease]'
            )}
            style={{
              animationName: 'storyFadeIn',
              animationDuration: '0.5s',
              animationTimingFunction: 'ease',
            }}
          />
        )}

        <div className='pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent' />

        {flash && (
          <div
            key={flash.ts}
            className={cn(
              'pointer-events-none absolute inset-0 z-10',
              flash.color === 'white' ? 'bg-white' : 'bg-black'
            )}
            style={{
              animationName: 'storyFlash',
              animationDuration: '420ms',
              animationTimingFunction: 'ease',
              animationFillMode: 'forwards',
            }}
          />
        )}
      </div>

      {/* 消息区 */}
      <Conversation className='bg-background'>
        <ConversationContent className='p-0'>
          <div className='mx-auto w-full max-w-3xl px-4 py-4'>
            {historyEmptyView}

            {hasMore && hasLocalMessages && (
              <div className='flex justify-center py-2'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={loadingEarlier}
                  onClick={() => void loadEarlier()}
                >
                  {loadingEarlier ? '…' : t('character.chat.loadEarlier')}
                </Button>
              </div>
            )}

            <div className='space-y-4'>
              {items.map((item) => {
                const isAssistant = item.role === 'assistant'
                let body: ReactNode
                if (item.failed) {
                  body = (
                    <>
                      <p className='text-destructive'>
                        {t('character.chat.failed')}
                      </p>
                      <button
                        type='button'
                        className='mt-1 inline-flex items-center gap-1 rounded-full border border-current px-2.5 py-0.5 text-xs hover:opacity-80'
                        onClick={() => retryMessage(item.key)}
                      >
                        <RotateCcw className='size-3' />
                        {t('Retry')}
                      </button>
                    </>
                  )
                } else if (item.streaming) {
                  body = <TypewriterText text={item.content} />
                } else {
                  body = (
                    <span className='whitespace-pre-wrap break-words'>
                      {item.content}
                    </span>
                  )
                }
                return (
                  <div
                    key={item.key}
                    className={cn(
                      'flex w-full',
                      isAssistant ? 'justify-start' : 'justify-end'
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                        isAssistant
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-primary text-primary-foreground'
                      )}
                    >
                      {body}
                      {isAssistant &&
                        !item.streaming &&
                        item.affinityDelta !== undefined &&
                        item.affinityDelta !== 0 && (
                          <div className='mt-1 flex items-center gap-1 text-xs text-rose-500'>
                            <Heart className='size-3 fill-current' />
                            {item.affinityDelta > 0 ? '+' : ''}
                            {item.affinityDelta}
                          </div>
                        )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </ConversationContent>
      </Conversation>

      {/* 输入区 */}
      <div className='shrink-0 border-t bg-background px-4 py-3 sm:px-6'>
        <div className='mx-auto w-full max-w-3xl'>
          <div className='flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:border-primary/50'>
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('character.chat.placeholder')}
              className='max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground'
            />
            <Button
              type='button'
              size='icon'
              disabled={!sending && !draft.trim()}
              variant={sending ? 'destructive' : 'default'}
              onClick={() => (sending ? stopGenerating() : sendMessage(draft))}
              aria-label={sending ? t('Stop') : t('character.chat.send')}
            >
              {sending ? (
                <Square className='size-4 fill-current' />
              ) : (
                <Send className='size-4' />
              )}
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes storyFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes storyFlash {
          0% { opacity: 0; }
          30% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
