import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { CharacterScript } from '../types'

interface ScriptPlayerProps {
  scripts: CharacterScript[]
  onEnded?: () => void
}

// 打字机逐句播放的小剧场播放器（galgame 文本框风格）
export function ScriptPlayer({ scripts, onEnded }: ScriptPlayerProps) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [typed, setTyped] = useState(0)
  const timerRef = useRef<number | null>(null)

  const current = scripts[index]

  useEffect(() => {
    setIndex(0)
    setTyped(0)
  }, [scripts])

  useEffect(() => {
    if (!current) return
    setTyped(0)
    timerRef.current = window.setInterval(() => {
      setTyped((prev) => {
        if (prev >= current.text.length) {
          if (timerRef.current) window.clearInterval(timerRef.current)
          return prev
        }
        return prev + 2 // 每帧 2 字，快节奏
      })
    }, 16)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [current])

  const isDone = !current || typed >= current.text.length

  const next = () => {
    if (!isDone) {
      setTyped(current.text.length) // 点击直接显示完整句
      return
    }
    if (index + 1 >= scripts.length) {
      onEnded?.()
      return
    }
    setIndex((i) => i + 1)
  }

  if (!current) return null

  return (
    <div
      className='relative cursor-pointer rounded-lg border bg-background/80 px-5 py-4 backdrop-blur-sm'
      onClick={next}
      role='button'
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') next()
      }}
    >
      <div className='mb-1 text-sm font-semibold text-primary'>
        {current.speaker || t('character.unknownSpeaker')}
      </div>
      <p className='min-h-[3.5rem] text-base leading-relaxed'>
        {current.text.slice(0, typed)}
      </p>
      <div className='mt-1 flex items-center justify-between text-xs text-muted-foreground'>
        <span>
          {t('character.scriptProgress')} {index + 1}/{scripts.length}
        </span>
        <span className={cn(isDone && 'animate-pulse')}>
          {isDone ? t('character.clickToContinue') : '▍'}
        </span>
      </div>
      <Button
        className='sr-only'
        onClick={(e) => {
          e.stopPropagation()
          onEnded?.()
        }}
      >
        {t('common.close')}
      </Button>
    </div>
  )
}
