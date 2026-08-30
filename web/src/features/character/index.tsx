import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { ArrowLeft, Lock, MessagesSquare, Share2, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { fetchCharacter, fetchCharacterScript } from './api'
import { ChatPanel } from './components/chat-panel'
import { ScriptPlayer } from './components/script-player'
import { ShareCard } from './components/share-card'
import type { CharacterStageView } from './types'

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${tokens}`
}

export default function CharacterDetailPage() {
  const { t } = useTranslation()
  const { modelName = '' } = useParams({ strict: false })
  const [activeStage, setActiveStage] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  const { data: character, isLoading } = useQuery({
    queryKey: ['character', modelName],
    queryFn: () => fetchCharacter(modelName),
    enabled: !!modelName,
  })

  const { data: script } = useQuery({
    queryKey: ['character-script', modelName, activeStage],
    queryFn: () => fetchCharacterScript(modelName, activeStage),
    enabled: !!character && activeStage <= (character?.max_stage ?? 0),
  })

  const currentStage = useMemo<CharacterStageView | undefined>(() => {
    return character?.stages.find((s) => s.index === activeStage)
  }, [character, activeStage])

  if (isLoading) {
    return (
      <div className='mx-auto max-w-5xl space-y-4 p-6'>
        <Skeleton className='h-96 w-full rounded-xl' />
        <Skeleton className='h-24 w-full' />
      </div>
    )
  }

  if (!character) {
    return (
      <div className='mx-auto max-w-5xl p-6 text-center text-muted-foreground'>
        {t('character.notFound')}
      </div>
    )
  }

  const showStage = character.max_stage >= activeStage

  const shareImageUrl = character.stages[character.max_stage]?.image_url
  const shareStageName =
    character.stages[character.max_stage]?.name ?? currentStage?.name ?? ''
  const shareDisabled = character.total_calls < 1 || !shareImageUrl

  return (
    <div className='mx-auto max-w-5xl p-6'>
      <Button
        variant='ghost'
        size='sm'
        className='mb-4 gap-1'
        onClick={() => window.history.back()}
      >
        <ArrowLeft className='h-4 w-4' />
        {t('common.back')}
      </Button>

      <div className='grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]'>
        {/* 立绘区 */}
        <div className='relative aspect-[3/4] overflow-hidden rounded-2xl border bg-gradient-to-b from-muted to-background'>
          {showStage && currentStage?.image_url ? (
            <img
              src={currentStage.image_url}
              alt={character.display_name}
              className='h-full w-full object-cover object-top'
            />
          ) : (
            <div className='flex h-full flex-col items-center justify-center gap-3 text-muted-foreground'>
              <Lock className='h-10 w-10' />
              <p className='max-w-[200px] text-center text-sm'>
                {currentStage?.unlock_text ?? t('character.locked')}
              </p>
            </div>
          )}
        </div>

        {/* 信息区 */}
        <div className='space-y-5'>
          <div>
            <div className='flex items-center gap-2 text-xs font-medium text-primary'>
              <Sparkles className='h-4 w-4' />
              {character.model_name}
            </div>
            <h1 className='mt-1 text-3xl font-bold'>{character.display_name}</h1>
            {character.title && <p className='text-lg text-muted-foreground'>{character.title}</p>}
            {character.tags && (
              <div className='mt-2 flex flex-wrap gap-1.5'>
                {character.tags
                  .split(',')
                  .filter(Boolean)
                  .map((tag) => (
                    <span
                      key={tag}
                      className='rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground'
                    >
                      {tag.trim()}
                    </span>
                  ))}
              </div>
            )}
          </div>

          <p className='text-muted-foreground'>{character.description}</p>

          {/* 对话入口 */}
          <div className='flex flex-wrap items-center gap-3'>
            <Button
              variant='outline'
              onClick={() => setChatOpen(true)}
              disabled={character.total_calls < 1}
              title={character.total_calls < 1 ? t('character.locked') : undefined}
            >
              <MessagesSquare className='mr-2 h-4 w-4' />
              {t('character.chat.open')}
            </Button>
            <Button
              variant='outline'
              onClick={() => setShareOpen(true)}
              disabled={shareDisabled}
              title={shareDisabled ? t('character.locked') : undefined}
            >
              <Share2 className='mr-2 h-4 w-4' />
              {t('character.share.title')}
            </Button>
            {character.total_calls < 1 && (
              <span className='text-xs text-muted-foreground'>
                {t('character.unlockHint')}
              </span>
            )}
          </div>

          {/* 阶段进度 */}
          <div>
            <div className='mb-2 flex items-center justify-between text-sm'>
              <span className='font-medium'>{t('character.stageProgress')}</span>
              <span className='text-muted-foreground'>
                {t('character.usedTokens')} {formatTokens(character.total_tokens)}
              </span>
            </div>
            <div className='space-y-2'>
              {character.stages.map((stage) => {
                const unlocked = stage.index <= character.max_stage
                return (
                  <button
                    key={stage.index}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg border px-4 py-2.5 text-left transition-colors',
                      unlocked ? 'hover:bg-accent' : 'opacity-60',
                      activeStage === stage.index && 'border-primary bg-accent'
                    )}
                    onClick={() => setActiveStage(stage.index)}
                  >
                    <div className='flex items-center gap-2'>
                      {unlocked ? (
                        <Sparkles className='h-4 w-4 text-primary' />
                      ) : (
                        <Lock className='h-4 w-4 text-muted-foreground' />
                      )}
                      <span className='font-medium'>{stage.name}</span>
                    </div>
                    {unlocked ? (
                      <span className='text-xs text-primary'>{t('character.unlocked')}</span>
                    ) : (
                      <span className='text-xs text-muted-foreground'>
                        {formatTokens(stage.unlock_tokens)} tokens
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 小剧场 */}
          {showStage ? (
            script && script.length > 0 ? (
              <ScriptPlayer
                scripts={script}
                onEnded={() => {
                  if (activeStage < character.max_stage) setActiveStage(activeStage + 1)
                }}
              />
            ) : (
              <p className='text-sm text-muted-foreground'>{t('character.noScript')}</p>
            )
          ) : (
            <p className='text-sm text-muted-foreground'>
              {currentStage?.unlock_text ?? t('character.locked')}
            </p>
          )}
        </div>
      </div>

      <ChatPanel
        modelName={character.model_name}
        characterName={character.display_name}
        open={chatOpen}
        onOpenChange={setChatOpen}
      />

      <ShareCard
        modelName={character.model_name}
        displayName={character.display_name}
        title={character.title ?? ''}
        stageName={shareStageName}
        imageUrl={shareImageUrl ?? ''}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  )
}
