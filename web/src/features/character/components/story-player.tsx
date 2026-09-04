import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { fetchCharacterScript } from '../api'
import { useSceneFlash } from '../hooks/use-scene-flash'
import { resolveBackground, resolvePose } from '../lib/scene'
import type { CharacterChoice, CharacterScript, CharacterStageView, CharacterView } from '../types'

interface PlayLine extends CharacterScript {
  isReply?: boolean
}

interface StoryPlayerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  character: CharacterView
  stageIndex?: number
  /** 结束屏「继续对话」回调；不传则不显示该按钮 */
  onContinue?: () => void
}

export function StoryPlayer({
  open,
  onOpenChange,
  character,
  stageIndex,
  onContinue,
}: StoryPlayerProps) {
  const { t } = useTranslation()

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
  const timerRef = useRef<number | null>(null)

  const current = lines[cursor]

  // 打开时初始化剧本
  useEffect(() => {
    if (!open || !script) return
    setLines(script.map((l) => ({ ...l })))
    setCursor(0)
    setTyped(0)
    setChosen(false)
  }, [open, script, stage])

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

  if (!open || !stage) return null

  const isDone = !current || typed >= current.text.length
  const hasChoices = Boolean(current?.choices?.length)
  const showChoices = hasChoices && isDone && !chosen
  const ended = !current && lines.length > 0 ? cursor >= lines.length : false
  const currentEffect = current?.effect || stage.default_effect

  const poseImg = resolvePose(stage, current?.pose)
  // 背景：台词指定背景（查全局背景库）→ 无则回退阶段背景
  const backgroundUrl = resolveBackground(stage, character, current?.background)

  const next = () => {
    if (!current) return
    if (!isDone) {
      setTyped(current.text.length)
      return
    }
    if (hasChoices && !chosen) return // 等待选择
    if (cursor + 1 >= lines.length) {
      setCursor(cursor + 1)
      return
    }
    setCursor(cursor + 1)
    setChosen(false)
  }

  const choose = (choice: CharacterChoice) => {
    if (chosen || !current) return
    const reply: PlayLine = {
      speaker: current.speaker,
      text: choice.reply,
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
        {current ? (
          <div className='mx-auto max-w-3xl'>
            {/* 选项（台词结束后显示） */}
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
              <div className='mt-2 flex items-center justify-between text-xs text-white/50'>
                <span>
                  {cursor + 1}/{lines.length}
                </span>
                {isDone &&
                  (showChoices
                    ? t('character.story.chooseHint')
                    : current.isReply || cursor + 1 < lines.length
                      ? t('character.clickToContinue')
                      : '')}
              </div>
            </div>
          </div>
        ) : ended ? (
          <div className='mx-auto max-w-3xl text-center'>
            <div className='rounded-2xl border border-white/10 bg-black/60 px-6 py-5 backdrop-blur-md'>
              <p className='text-lg text-white'>{t('character.story.ended')}</p>
              <div className='mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row'>
                {onContinue && (
                  <button
                    type='button'
                    className='rounded-full bg-white px-5 py-1.5 text-sm font-semibold text-black hover:bg-white/90'
                    onClick={(e) => {
                      e.stopPropagation()
                      onContinue()
                    }}
                  >
                    {t('character.story.continue')}
                  </button>
                )}
                <button
                  type='button'
                  className='rounded-full border border-white/30 px-4 py-1.5 text-sm text-white hover:bg-white/10'
                  onClick={() => onOpenChange(false)}
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className='mx-auto max-w-3xl text-center text-white/60'>
            {t('character.noScript')}
          </div>
        )}
      </div>

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
        [data-story-player][role='button']:active {
          transform: none !important;
        }
      `}</style>
    </div>,
    document.body
  )
}
