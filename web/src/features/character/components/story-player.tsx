import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { getUserGroups, getUserModels } from '@/features/playground/api'
import { GlassSelect } from './glass-select'

import {
  fetchCharacterChatMessages,
  fetchCharacterChatMeta,
  fetchCharacterScript,
} from '../api'
import { useSceneFlash } from '../hooks/use-scene-flash'
import { extractStreamedLines, parseCharacterReply, splitLongLine } from '../lib/character-reply'
import type { CharacterReplyLine } from '../lib/character-reply'
import { sendCharacterChatStream } from '../lib/character-stream'
import { resolveBackground, resolvePose } from '../lib/scene'
import { ModelPicker } from './model-picker'
import type {
  CharacterChatMessageItem,
  CharacterScript,
  CharacterStageView,
  CharacterView,
} from '../types'

interface PlayLineChoice {
  text: string
  reply?: string
  pose?: string
  effect?: string
  background?: string
}

interface PlayLine extends Omit<CharacterScript, 'choices'> {
  isReply?: boolean
  affinityDelta?: number
  choices?: PlayLineChoice[]
}

interface StoryPlayerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  character: CharacterView
  stageIndex?: number
  /** 跳过剧本直接进入 AI 对话阶段（详情页「与角色对话」入口） */
  startInChat?: boolean
}

export function StoryPlayer({
  open,
  onOpenChange,
  character,
  stageIndex,
  startInChat = false,
}: StoryPlayerProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const stage: CharacterStageView | undefined = useMemo(
    () =>
      character.stages.find((s) => s.index === (stageIndex ?? character.max_stage)) ??
      character.stages[0],
    [character, stageIndex]
  )

  const { data: script } = useQuery({
    queryKey: ['character-script', character.model_name, stage?.index],
    queryFn: () => fetchCharacterScript(character.model_name, stage?.index ?? 0),
    enabled: open && !!stage,
  })

  const [lines, setLines] = useState<PlayLine[]>([])
  const [cursor, setCursor] = useState(0)
  const [typed, setTyped] = useState(0)
  const [chosen, setChosen] = useState(false)
  // script = 静态剧本播放；chat = 剧本播完后同一对话框由 AI 接管（同一界面流程）
  const [phase, setPhase] = useState<'script' | 'chat'>('script')
  const [thinking, setThinking] = useState(false)
  const [genError, setGenError] = useState(false)
  const timerRef = useRef<number | null>(null)
  const accRef = useRef('')
  const chatStartedRef = useRef(false)
  // 流式生成状态：已上屏句数 / 本轮首句索引（好感角标）/ 失败重试参数 / 流活跃标记
  const emittedRef = useRef(0)
  const roundFirstIdxRef = useRef<number | null>(null)
  const lastGenRef = useRef<{ content: string; fromStory: boolean } | null>(null)
  const streamingRef = useRef(false)
  // AI 阶段选定的具体模型/分组（角色 model_name 为前缀，玩家在可用范围内选择）
  const [chatModel, setChatModel] = useState('')
  const [chatGroup, setChatGroup] = useState('')
  const chatModelRef = useRef('')
  const chatGroupRef = useRef('')
  const [showPicker, setShowPicker] = useState(false)
  const [groupOptions, setGroupOptions] = useState<string[]>([])
  const [modelOptions, setModelOptions] = useState<string[]>([])

  const setModelPair = (model: string, group: string) => {
    chatModelRef.current = model
    chatGroupRef.current = group
    setChatModel(model)
    setChatGroup(group)
  }

  const current = lines[cursor]

  // AI 对话阶段才需要会话信息（开场/续谈判定）
  const { data: meta } = useQuery({
    queryKey: ['character-chat-meta', character.model_name],
    queryFn: () => fetchCharacterChatMeta(character.model_name),
    enabled: open && phase === 'chat',
  })
  const { data: historyPage } = useQuery({
    queryKey: ['character-chat-history', character.model_name],
    queryFn: () => fetchCharacterChatMessages(character.model_name),
    enabled: open && phase === 'chat',
  })

  // 打开时初始化剧本
  useEffect(() => {
    if (!open || !script) return
    setLines(script.map((l) => ({ ...l })))
    setCursor(0)
    setTyped(0)
    setChosen(false)
    setThinking(false)
    setGenError(false)
    chatStartedRef.current = false
    setModelPair('', '')
    setShowPicker(false)
    setPhase(startInChat ? 'chat' : 'script')
  }, [open, script, stage, startInChat])

  // ESC 退出
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  // 锁定背景滚动
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // 打字机
  useEffect(() => {
    if (!open || !current) return
    setTyped(0)
    timerRef.current = window.setInterval(() => {
      setTyped((prev) => {
        if (prev >= current.text.length) {
          if (timerRef.current) window.clearInterval(timerRef.current)
          return prev
        }
        return prev + 2
      })
    }, 16)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [open, current])

  // 台词/阶段切换过渡（black/white 闪屏）
  const flash = useSceneFlash(current?.effect || stage?.default_effect, cursor)

  // AI 台词追加到同一台词流（echo 为用户发言回显，开场白无 echo）
  const generate = (content: string, echo: string | null, fromStory = false) => {
    if (thinking || streamingRef.current || !stage) return
    setThinking(true)
    setGenError(false)
    accRef.current = ''
    emittedRef.current = 0
    roundFirstIdxRef.current = null
    lastGenRef.current = { content, fromStory }
    streamingRef.current = true
    const base = lines.length
    const appendReplyLines = (linesIn: CharacterReplyLine[]) => {
      const isFirst = emittedRef.current === 0
      if (isFirst) {
        // 第一句上屏：撤下思考中；开场直接从段首句播放
        setThinking(false)
        roundFirstIdxRef.current = base + (echo !== null ? 1 : 0)
        if (echo === null) {
          setCursor(base)
          setTyped(0)
        }
      }
      const newLines: PlayLine[] = linesIn.map((l) => ({
        speaker: l.speaker || character.display_name,
        text: l.text,
        pose: l.pose,
        effect: l.effect,
        background: l.background,
        choices: l.choices?.map((c) => ({ text: c.text })),
        isReply: true,
      }))
      setLines((prev) => [...prev, ...newLines])
      emittedRef.current += linesIn.length
    }
    const fallbackLine = (text: string): CharacterReplyLine[] =>
      splitLongLine(text.trim())
        .slice(0, 12)
        .map((t) => ({ text: t }))
    sendCharacterChatStream(
      `/api/character/${encodeURIComponent(character.model_name)}/chat`,
      {
        content,
        stage_index: stage.index,
        ...(fromStory ? { from_story: true } : {}),
        ...(chatModelRef.current ? { model: chatModelRef.current } : {}),
        ...(chatGroupRef.current ? { group: chatGroupRef.current } : {}),
      },
      {
        onChunk: (delta) => {
          accRef.current += delta
          // 流式增量解析：每闭合一句立即上屏，缩短等待
          const fresh = extractStreamedLines(accRef.current, emittedRef.current)
          if (fresh.length > 0) appendReplyLines(fresh)
        },
        onDone: () => {
          streamingRef.current = false
          // 补齐增量解析未捕捉的尾句（含 choices 的末句常在流结束才闭合）
          const full = accRef.current
          const parsed = parseCharacterReply(full)
          const remaining = (parsed?.lines ?? []).slice(emittedRef.current)
          if (remaining.length > 0) {
            appendReplyLines(remaining)
          } else if (emittedRef.current === 0 && parsed) {
            appendReplyLines(
              parsed.lines ?? [
                {
                  text: parsed.reply,
                  pose: parsed.pose,
                  effect: parsed.effect,
                  background: parsed.background,
                  choices: parsed.choices,
                },
              ]
            )
          } else if (emittedRef.current === 0) {
            appendReplyLines(fallbackLine(full))
          }
          setThinking(false)
          if (emittedRef.current === 0) {
            setGenError(true)
            toast.error(t('character.chat.failed'))
            return
          }
          // 好感角标挂到本轮第一句
          if (parsed?.affinityDelta && roundFirstIdxRef.current !== null) {
            const idx = roundFirstIdxRef.current
            const d = parsed.affinityDelta
            setLines((prev) =>
              prev.map((l, i) => (i === idx ? { ...l, affinityDelta: d } : l))
            )
          }
          setChosen(false)
          qc.invalidateQueries({ queryKey: ['character', character.model_name] })
          // 同步会话缓存：重开播放器时续谈判定依据最新的 meta/history
          qc.invalidateQueries({ queryKey: ['character-chat-meta', character.model_name] })
          qc.invalidateQueries({ queryKey: ['character-chat-history', character.model_name] })
        },
        onError: () => {
          streamingRef.current = false
          setThinking(false)
          if (emittedRef.current === 0) setGenError(true)
          toast.error(t('character.chat.failed'))
        },
      }
    )
  }

  const toLine = (m: CharacterChatMessageItem): PlayLine => ({
    speaker: m.role === 'user' ? t('character.story.you') : character.display_name,
    text: m.content,
    pose: m.pose || undefined,
    effect: m.effect || undefined,
    background: m.background || undefined,
    choices: m.choices?.map((c) => ({ text: c.text })),
    affinityDelta: m.affinity_delta || undefined,
  })

  // 新会话开场：模型/分组选定后由选择弹窗触发
  const startOpening = () => {
    if (thinking || !stage) return
    generate('', null, true)
  }

  // 进入 AI 阶段后一次性衔接：新会话先弹模型选择；旧会话有模型直接续谈，
  // 无模型（旧数据/未配默认）同样弹窗补选。必须位于 early-return 之前，保证 hooks 数量一致。
  const pickerModeRef = useRef<'fresh' | 'resume'>('fresh')
  const resumeItemsRef = useRef<CharacterChatMessageItem[]>([])

  const seedResume = (items: CharacterChatMessageItem[]) => {
    let aiIdx = -1
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].role === 'assistant') {
        aiIdx = i
        break
      }
    }
    if (aiIdx < 0) return // 历史异常：等玩家用点击继续推进
    const seed: PlayLine[] = []
    if (aiIdx > 0 && items[aiIdx - 1].role === 'user') seed.push(toLine(items[aiIdx - 1]))
    seed.push(toLine(items[aiIdx]))
    const base = lines.length
    setLines((prev) => [...prev, ...seed])
    setCursor(base)
    setTyped(0)
  }

  useEffect(() => {
    if (!open || !stage || phase !== 'chat' || chatStartedRef.current) return
    if (!meta || !historyPage) return
    chatStartedRef.current = true
    const items = historyPage.items
    if (!meta.has_history || items.length === 0) {
      pickerModeRef.current = 'fresh'
      setShowPicker(true)
      return
    }
    if (meta.model) {
      setModelPair(meta.model, meta.group ?? '')
      seedResume(items)
      return
    }
    // 会话未绑定具体模型（旧会话/角色未配默认模型）：补选后再续谈
    pickerModeRef.current = 'resume'
    resumeItemsRef.current = items
    setShowPicker(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase, meta, historyPage])

  // 分组/模型下拉数据（AI 阶段）
  useEffect(() => {
    if (!open || phase !== 'chat') return
    let cancelled = false
    getUserGroups().then((gs) => {
      if (cancelled) return
      setGroupOptions(gs.map((g) => g.value))
    })
    return () => {
      cancelled = true
    }
  }, [open, phase])

  useEffect(() => {
    if (!open || phase !== 'chat' || !chatGroup) return
    let cancelled = false
    getUserModels(chatGroup).then((ms) => {
      if (cancelled) return
      const filtered = ms.map((m) => m.value).filter((v) => v.startsWith(character.model_name))
      setModelOptions(filtered)
      setChatModel((prev) => {
        if (prev && filtered.includes(prev)) return prev
        const next =
          character.default_model && filtered.includes(character.default_model)
            ? character.default_model
            : (filtered[0] ?? '')
        chatModelRef.current = next
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [open, phase, chatGroup, character.model_name, character.default_model])

  if (!open || !stage) return null

  const isDone = !current || typed >= current.text.length
  const hasChoices = Boolean(current?.choices?.length)
  // 选项只在末句生效（段中句带选项时忽略，避免卡住推进）
  const showChoices =
    hasChoices && isDone && !chosen && !thinking && cursor >= lines.length - 1
  const currentEffect = current?.effect || stage.default_effect

  const poseImg = resolvePose(stage, current?.pose)
  // 背景：台词指定背景（查全局背景库）→ 无则回退阶段背景
  const backgroundUrl = resolveBackground(stage, character, current?.background)

  const next = () => {
    if (thinking) return
    if (!current) return
    if (!isDone) {
      setTyped(current.text.length)
      return
    }
    if (hasChoices && !chosen && cursor >= lines.length - 1) return // 等待选择（仅末句拦停）
    if (cursor + 1 >= lines.length) {
      if (phase === 'script') {
        // 剧本播完：同一界面无缝交给 AI 接管（开场白/历史衔接见下方 effect）
        setPhase('chat')
      } else if (!streamingRef.current) {
        // 玩家点击推进 = 请求继续生成下一段（复用点击继续，无兜底按钮）
        generate('（继续剧情）', null)
      }
      return
    }
    setCursor(cursor + 1)
    setChosen(false)
  }

  const choose = (choice: PlayLineChoice) => {
    if (chosen || thinking || !current) return
    if (phase === 'chat') {
      // AI 选项：点击即作为用户发言继续对话
      setChosen(true)
      generate(choice.text, choice.text)
      return
    }
    const reply: PlayLine = {
      speaker: current.speaker,
      text: choice.reply || choice.text,
      pose: choice.pose || current.pose,
      effect: choice.effect,
      background: choice.background || current.background,
      isReply: true,
    }
    setLines((prev) => [
      ...prev.slice(0, cursor + 1),
      reply,
      ...prev.slice(cursor + 1),
    ])
    setChosen(true)
    setCursor(cursor + 1)
    setTyped(0)
  }

  return createPortal(
    <div
      data-story-player
      className='fixed inset-0 z-[100] flex flex-col bg-black'
      onClick={next}
      role='button'
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') next()
      }}
    >
      {/* 背景 */}
      {backgroundUrl ? (
        <img
          key={backgroundUrl}
          src={backgroundUrl}
          alt=''
          className='absolute inset-0 h-full w-full animate-[fadein_0.6s_ease] object-cover'
          style={{ animationName: 'storyFadeIn' }}
        />
      ) : (
        <div className='absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-900 to-black' />
      )}

      {/* 人物立绘（按姿态切换，图片未变时不重播动画） */}
      {poseImg && (
        <img
          key={poseImg}
          src={poseImg}
          alt=''
          className={cn(
            'pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2',
            'max-h-[76vh] w-auto object-contain',
            currentEffect === 'fade' && 'animate-[storyFadeIn_0.5s_ease]'
          )}
          style={{
            animationName: 'storyFadeIn',
            animationDuration: '0.5s',
            animationTimingFunction: 'ease',
          }}
        />
      )}

      {/* 底部渐变 */}
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent' />

      {/* 过渡闪屏 */}
      {flash && (
        <div
          key={flash.ts}
          className={cn(
            'pointer-events-none absolute inset-0 z-10 animate-[storyFlash_0.42s_ease]',
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

      {/* 对话区 */}
      <div className='relative z-20 mt-auto px-4 pb-6 pt-24 sm:px-10'>
        {thinking ? (
          /* 生成中：思考中动画（替代当前台词展示，明确反馈） */
          <div className='mx-auto max-w-3xl'>
            <div className='rounded-2xl border border-white/10 bg-black/60 px-6 py-5 backdrop-blur-md'>
              <div className='mb-1 text-sm font-semibold text-primary'>
                {character.display_name}
              </div>
              <div className='flex min-h-[4rem] items-center gap-2'>
                <span className='text-base text-white/70'>{t('character.story.thinking')}</span>
                <span className='flex items-end gap-1 pb-1'>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className='bg-primary inline-block size-1.5 rounded-full'
                      style={{
                        animationName: 'storyDot',
                        animationDuration: '1.2s',
                        animationIterationCount: 'infinite',
                        animationDelay: `${i * 0.18}s`,
                      }}
                    />
                  ))}
                </span>
              </div>
            </div>
          </div>
        ) : current ? (
          <div className='mx-auto max-w-3xl'>
            {/* 选项（台词结束后显示；AI 阶段点击即作为发言继续） */}
            {showChoices && current.choices && (
              <div className='mb-4 flex flex-col gap-2'>
                {current.choices.map((c, i) => (
                  <button
                    key={i}
                    type='button'
                    className='w-fit rounded-full border border-white/40 bg-black/50 px-5 py-2 text-left text-sm text-white backdrop-blur-sm transition-colors hover:bg-white/20'
                    onClick={(e) => {
                      e.stopPropagation()
                      choose(c)
                    }}
                  >
                    {c.text}
                  </button>
                ))}
              </div>
            )}
            <div className='rounded-2xl border border-white/10 bg-black/60 px-6 py-5 backdrop-blur-md'>
              <div className='mb-1 text-sm font-semibold text-primary'>
                {current.speaker || t('character.unknownSpeaker')}
              </div>
              <p className='min-h-[4rem] text-lg leading-relaxed text-white'>
                {current.text.slice(0, typed)}
                {!isDone && <span className='text-white/70'>▍</span>}
              </p>
              {current.affinityDelta ? (
                <div className='mt-1 text-xs text-rose-400'>
                  {current.affinityDelta > 0 ? '+' : ''}
                  {current.affinityDelta} ♥
                </div>
              ) : null}
              <div className='mt-2 flex items-center justify-between text-xs text-white/50'>
                <span>
                  {cursor + 1}/{lines.length}
                </span>
                {isDone &&
                  (showChoices
                    ? t('character.story.chooseHint')
                    : current.isReply || cursor + 1 < lines.length || phase === 'chat'
                      ? t('character.clickToContinue')
                      : '')}
              </div>
            </div>
          </div>
        ) : genError ? (
          <div className='mx-auto max-w-3xl'>
            <div className='rounded-2xl border border-white/10 bg-black/60 px-6 py-5 backdrop-blur-md'>
              <div className='mb-1 text-sm font-semibold text-primary'>
                {character.display_name}
              </div>
              <p className='min-h-[4rem] text-lg text-white'>{t('character.chat.failed')}</p>
              <button
                type='button'
                className='mt-2 inline-flex items-center gap-1 rounded-full border border-white/40 px-3 py-1 text-xs text-white hover:bg-white/10'
                onClick={(e) => {
                  e.stopPropagation()
                  generate('', null, true)
                }}
              >
                {t('Retry')}
              </button>
            </div>
          </div>
        ) : (
          <div className='mx-auto max-w-3xl text-center text-white/60'>
            {t('character.noScript')}
          </div>
        )}

        {/* 中途生成失败且本轮还没有内容上屏：就地重试 */}
        {genError && !thinking && current && (
          <div
            className='mx-auto mt-2 flex w-full max-w-3xl justify-center'
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type='button'
              className='rounded-full border border-white/40 px-3 py-1 text-xs text-white hover:bg-white/10'
              onClick={() => {
                const g = lastGenRef.current
                if (g) generate(g.content, null, g.fromStory)
              }}
            >
              {t('Retry')}
            </button>
          </div>
        )}

        {/* AI 阶段：底部模型/分组下拉，可随时切换（下次生成生效） */}
        {phase === 'chat' && !showPicker && groupOptions.length > 0 && (
          <div
            className='mx-auto mt-2 flex w-full max-w-3xl items-center gap-2'
            onClick={(e) => e.stopPropagation()}
          >
            <span className='text-[10px] tracking-wide text-white/40'>
              {t('character.story.groupLabel')}
            </span>
            <GlassSelect
              value={chatGroup}
              options={groupOptions}
              onChange={(g) => setModelPair(chatModelRef.current, g)}
            />
            <span className='ml-2 text-[10px] tracking-wide text-white/40'>
              {t('character.story.modelLabel')}
            </span>
            <GlassSelect
              value={chatModel}
              options={modelOptions.length > 0 ? modelOptions : chatModel ? [chatModel] : []}
              onChange={(m) => setModelPair(m, chatGroupRef.current)}
              menuClassName='min-w-64'
            />
          </div>
        )}

      </div>

      {/* 模型/分组选择（新会话首次进入 AI 阶段时） */}
      {showPicker && (
        <ModelPicker
          open
          modelPrefix={character.model_name}
          defaultModel={character.default_model}
          onConfirm={(m, g) => {
            setModelPair(m, g)
            setShowPicker(false)
            if (pickerModeRef.current === 'resume') {
              seedResume(resumeItemsRef.current)
            } else {
              startOpening()
            }
          }}
        />
      )}

      {/* 关闭按钮 */}
      <button
        type='button'
        className='absolute top-4 right-4 z-30 flex size-9 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm hover:bg-black/60'
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(false)
        }}
        aria-label={t('common.close')}
      >
        ✕
      </button>

      {/* 全局 fade-in 动画 */}
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
        @keyframes storyDot {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
        [data-story-player][role='button']:active {
          transform: none !important;
        }
      `}</style>
    </div>,
    document.body
  )
}
