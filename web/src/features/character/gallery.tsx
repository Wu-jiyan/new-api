import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { BookOpen, Lock } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { fetchCharacters } from './api'
import type { CharacterStageView, CharacterView } from './types'

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${tokens}`
}

function isUnlocked(character: CharacterView): boolean {
  return character.max_stage >= 0 && character.total_calls >= 1
}

function getCurrentStage(character: CharacterView): CharacterStageView | undefined {
  return character.stages.find((stage) => stage.index === character.max_stage)
}

function getNextStage(character: CharacterView): CharacterStageView | undefined {
  return character.stages
    .filter((stage) => stage.index > character.max_stage)
    .sort((a, b) => a.index - b.index)[0]
}

function getProgress(character: CharacterView): number {
  const next = getNextStage(character)
  if (!next || next.unlock_tokens <= 0) return 100
  return Math.min(100, Math.round((character.total_tokens / next.unlock_tokens) * 100))
}

interface CharacterCardProps {
  character: CharacterView
  onClick: () => void
}

function CharacterCard({ character, onClick }: CharacterCardProps) {
  const { t } = useTranslation()
  const unlocked = isUnlocked(character)
  const currentStage = unlocked ? getCurrentStage(character) : undefined
  const imageUrl = unlocked ? currentStage?.image_url : undefined
  const nextStage = getNextStage(character)
  const progress = getProgress(character)

  return (
    <button
      type='button'
      onClick={onClick}
      className='group relative flex flex-col overflow-hidden rounded-xl border bg-background text-left transition-colors hover:bg-muted/20'
    >
      <div className='bg-muted/40 relative aspect-[3/4] w-full overflow-hidden'>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={character.display_name}
            className='h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105'
          />
        ) : (
          <div className='flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-muted/60 to-background text-muted-foreground'>
            <div
              className='bg-muted-foreground/15 h-2/3 w-2/5 rounded-t-full'
              style={{
                maskImage: 'radial-gradient(ellipse at center, black, transparent)',
                WebkitMaskImage: 'radial-gradient(ellipse at center, black, transparent)',
              }}
            />
            <Lock className='size-5' />
            <span className='text-xs'>{t('character.gallery.locked')}</span>
          </div>
        )}
        <span
          className={cn(
            'absolute top-2 right-2 rounded-full px-2 py-0.5 text-xs font-medium',
            unlocked
              ? 'bg-background/85 text-primary'
              : 'bg-background/85 text-muted-foreground'
          )}
        >
          {unlocked ? currentStage?.name ?? t('character.unlocked') : t('character.gallery.locked')}
        </span>
      </div>

      <div className='flex-1 space-y-2 p-3 sm:p-4'>
        <div>
          <h3 className='text-foreground truncate text-sm leading-tight font-bold'>
            {character.display_name}
          </h3>
          {character.title && (
            <p className='text-muted-foreground mt-0.5 truncate text-xs'>{character.title}</p>
          )}
        </div>

        <div className='space-y-1'>
          <div className='text-muted-foreground flex items-center justify-between text-xs'>
            <span>{formatTokens(character.total_tokens)}</span>
            <span>{nextStage ? formatTokens(nextStage.unlock_tokens) : t('character.unlocked')}</span>
          </div>
          <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
            <div
              className='bg-primary h-full rounded-full transition-all'
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </button>
  )
}

export default function CharacterGalleryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: characters, isLoading } = useQuery({
    queryKey: ['characters'],
    queryFn: fetchCharacters,
    staleTime: 60 * 1000,
  })

  const stats = useMemo(() => {
    const list = characters ?? []
    return {
      total: list.length,
      collected: list.filter(isUnlocked).length,
      totalCalls: list.reduce((sum, character) => sum + character.total_calls, 0),
    }
  }, [characters])

  if (isLoading) {
    return (
      <div className='mx-auto max-w-6xl space-y-6 p-6'>
        <div className='space-y-2'>
          <Skeleton className='h-5 w-28' />
          <Skeleton className='h-8 w-44' />
        </div>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <Skeleton className='h-24 rounded-xl' />
          <Skeleton className='h-24 rounded-xl' />
        </div>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className='aspect-[3/4] rounded-xl' />
          ))}
        </div>
      </div>
    )
  }

  const list = characters ?? []

  return (
    <div className='mx-auto max-w-6xl space-y-6 p-6'>
      <div className='flex items-center gap-2 text-sm font-semibold tracking-[0.2em] text-primary uppercase'>
        <BookOpen className='size-4' />
        {t('character.gallery.title')}
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <div className='rounded-xl border p-4'>
          <p className='text-muted-foreground text-sm'>{t('character.gallery.collected')}</p>
          <p className='mt-1 text-2xl font-bold'>
            {stats.collected}
            <span className='text-muted-foreground font-normal'> / {stats.total}</span>
          </p>
        </div>
        <div className='rounded-xl border p-4'>
          <p className='text-muted-foreground text-sm'>{t('character.gallery.calls')}</p>
          <p className='mt-1 text-2xl font-bold'>{stats.totalCalls}</p>
        </div>
      </div>

      {list.length === 0 ? (
        <div className='text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center'>
          <BookOpen className='size-10' />
          <p>{t('character.gallery.empty')}</p>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
          {list.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              onClick={() =>
                navigate({
                  to: '/character/$modelName',
                  params: { modelName: character.model_name },
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
