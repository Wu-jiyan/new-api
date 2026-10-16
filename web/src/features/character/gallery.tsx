import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  BookOpen,
  ChevronRight,
  Loader2,
  Lock,
  LockKeyhole,
  PawPrint,
  Play,
  ZoomIn,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { fetchCharacterPet, fetchCharacters, setCharacterPet, unlockCharacter } from './api'
import { Lightbox } from './components/lightbox'
import { StoryPlayer } from './components/story-player'
import type { CharacterStageView, CharacterView } from './types'

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${tokens}`
}

function isClaimed(character: CharacterView): boolean {
  return character.max_stage >= 0
}

function getCurrentStage(
  character: CharacterView
): CharacterStageView | undefined {
  return character.stages.find((stage) => stage.index === character.max_stage)
}

function getEligibleStage(
  character: CharacterView
): CharacterStageView | undefined {
  return character.stages.find((stage) => stage.eligible)
}

function getNextStage(
  character: CharacterView
): CharacterStageView | undefined {
  return character.stages
    .filter((stage) => stage.index > character.max_stage)
    .sort((a, b) => a.index - b.index)[0]
}

function getProgress(character: CharacterView): number {
  const next = getNextStage(character)
  if (!next || next.unlock_tokens <= 0) return 100
  return Math.min(
    100,
    Math.round((character.total_tokens / next.unlock_tokens) * 100)
  )
}

interface CharacterCardProps {
  character: CharacterView
  onClick: () => void
  /** 该角色是否已是当前桌宠 */
  isPet: boolean
  onTogglePet: (modelName: string, activate: boolean) => void
  petPending: boolean
}

function CharacterCard(props: CharacterCardProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [storyOpen, setStoryOpen] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [unlockFx, setUnlockFx] = useState(false)
  const character = props.character
  const claimed = isClaimed(character)
  const currentStage = claimed ? getCurrentStage(character) : undefined
  const eligibleStage = getEligibleStage(character)
  const imageUrl = claimed
    ? currentStage?.image_url
    : (character.stages[0]?.silhouette_url ?? undefined)
  const nextStage = getNextStage(character)
  const progress = getProgress(character)
  // 只有已解锁且站点配置了桌宠图的角色才可放置，服务端同样会校验这两条。
  const canBePet = claimed && !!character.pet_image_url

  const handleUnlock = async () => {
    if (!eligibleStage || unlocking) return
    setUnlocking(true)
    try {
      await unlockCharacter(character.model_name, eligibleStage.index)
      setUnlockFx(true)
      setUnlocking(false)
      setTimeout(() => qc.invalidateQueries({ queryKey: ['characters'] }), 600)
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('character.unlockFailed')
      )
      setUnlocking(false)
    }
  }

  return (
    <>
      <div
        role='button'
        tabIndex={0}
        onClick={props.onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            props.onClick()
          }
        }}
        className='group bg-background hover:bg-muted/20 relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-colors'
      >
        <div className='bg-muted/40 group/image relative aspect-[3/4] w-full overflow-hidden'>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={character.display_name}
              className={cn(
                'h-full w-full cursor-zoom-in object-cover object-top transition-transform duration-300 group-hover:scale-105',
                !claimed && 'opacity-60',
                unlockFx && 'fade-in-up'
              )}
              onClick={(e) => {
                e.stopPropagation()
                setLightboxOpen(true)
              }}
            />
          ) : (
            <div className='from-muted/60 to-background text-muted-foreground flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-b'>
              <div
                className='bg-muted-foreground/15 h-2/3 w-2/5 rounded-t-full'
                style={{
                  maskImage:
                    'radial-gradient(ellipse at center, black, transparent)',
                  WebkitMaskImage:
                    'radial-gradient(ellipse at center, black, transparent)',
                }}
              />
              <Lock className='size-5' />
              <span className='text-xs'>{t('character.gallery.locked')}</span>
            </div>
          )}
          <span
            className={cn(
              'absolute top-2 right-2 rounded-full px-2 py-0.5 text-xs font-medium',
              claimed
                ? 'bg-background/85 text-primary'
                : 'bg-background/85 text-muted-foreground'
            )}
          >
            {claimed
              ? (currentStage?.name ?? t('character.unlocked'))
              : eligibleStage
                ? t('character.unlockReady')
                : t('character.gallery.locked')}
          </span>
          {imageUrl && (
            <span className='pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/image:opacity-100'>
              <ZoomIn className='size-3' />
              {t('character.gallery.viewImage')}
            </span>
          )}
          {unlockFx && (
            <span className='pointer-events-none absolute inset-0 flex items-center justify-center'>
              <span className='unlock-ring' />
            </span>
          )}
          {!claimed && eligibleStage && (
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                handleUnlock()
              }}
              className='unlock-glow absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black'
            >
              {unlocking ? (
                <Loader2 className='size-3.5 animate-spin' />
              ) : (
                <LockKeyhole className='size-3.5' />
              )}
              {t('character.unlock')}
            </button>
          )}
        </div>

        <div className='flex-1 space-y-2 p-3 sm:p-4'>
          <div className='group/title flex items-center justify-between gap-2'>
            <div className='min-w-0'>
              <h3 className='text-foreground group-hover/title:text-primary truncate text-sm leading-tight font-bold transition-colors'>
                {character.display_name}
              </h3>
              {character.title && (
                <p className='text-muted-foreground mt-0.5 truncate text-xs'>
                  {character.title}
                </p>
              )}
            </div>
            <ChevronRight className='text-muted-foreground/60 size-4 shrink-0 transition-transform group-hover/title:translate-x-0.5' />
          </div>

          <div className='space-y-1'>
            <div className='text-muted-foreground flex items-center justify-between text-xs'>
              <span>{formatTokens(character.total_tokens)}</span>
              <span>
                {nextStage
                  ? formatTokens(nextStage.unlock_tokens)
                  : t('character.unlocked')}
              </span>
            </div>
            <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
              <div
                className='bg-primary h-full rounded-full transition-all'
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {claimed && (
          <div className='flex items-center gap-1 border-t p-2'>
            <Button
              variant='ghost'
              size='sm'
              className='flex-1'
              onClick={(e) => {
                e.stopPropagation()
                setStoryOpen(true)
              }}
            >
              <Play className='mr-1.5 h-4 w-4' />
              {t('character.story.enter')}
            </Button>
            {canBePet && (
              <Button
                variant={props.isPet ? 'default' : 'ghost'}
                size='sm'
                disabled={props.petPending}
                aria-pressed={props.isPet}
                title={
                  props.isPet
                    ? t('character.pet.deactivate')
                    : t('character.pet.activate')
                }
                onClick={(e) => {
                  e.stopPropagation()
                  props.onTogglePet(character.model_name, !props.isPet)
                }}
              >
                {props.petPending ? (
                  <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
                ) : (
                  <PawPrint className='mr-1.5 h-4 w-4' />
                )}
                {props.isPet ? t('character.pet.deactivate') : t('character.pet.activate')}
              </Button>
            )}
          </div>
        )}
      </div>
      <StoryPlayer
        open={storyOpen}
        onOpenChange={setStoryOpen}
        character={character}
      />
      <Lightbox
        open={lightboxOpen}
        src={imageUrl}
        alt={character.display_name}
        onOpenChange={setLightboxOpen}
      />
    </>
  )
}

export default function CharacterGalleryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: characters, isLoading } = useQuery({
    queryKey: ['characters'],
    queryFn: fetchCharacters,
    staleTime: 60 * 1000,
  })

  const { data: pet } = useQuery({
    queryKey: ['character-pet'],
    queryFn: fetchCharacterPet,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const [petPending, setPetPending] = useState(false)
  const petMutation = useMutation({
    mutationFn: ({ modelName }: { modelName: string }) => setCharacterPet(modelName),
    onMutate: () => setPetPending(true),
    onSettled: () => setPetPending(false),
    onSuccess: (next) => {
      qc.setQueryData(['character-pet'], next)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('Request failed'))
    },
  })

  const togglePet = (modelName: string, activate: boolean) => {
    petMutation.mutate({ modelName: activate ? modelName : '' })
  }

  const stats = useMemo(() => {
    const list = characters ?? []
    return {
      total: list.length,
      collected: list.filter(isClaimed).length,
      totalCalls: list.reduce(
        (sum, character) => sum + character.total_calls,
        0
      ),
    }
  }, [characters])

  if (isLoading) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>
          <span className='inline-flex min-w-0 items-center gap-2'>
            <BookOpen aria-hidden='true' className='size-4 shrink-0' />
            <span className='truncate'>{t('character.gallery.title')}</span>
          </span>
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='space-y-6'>
            <Skeleton className='h-5 w-44' />
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <Skeleton className='h-24 rounded-xl' />
              <Skeleton className='h-24 rounded-xl' />
            </div>
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
              {Array.from({ length: 10 }).map((_, index) => (
                <Skeleton key={index} className='aspect-[3/4] rounded-xl' />
              ))}
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  const list = characters ?? []

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <BookOpen aria-hidden='true' className='size-4 shrink-0' />
          <span className='truncate'>{t('character.gallery.title')}</span>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-6'>
          <p className='text-muted-foreground text-sm'>
            {t('character.gallery.subtitle')}
          </p>

          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div className='rounded-xl border p-4'>
              <p className='text-muted-foreground text-sm'>
                {t('character.gallery.collected')}
              </p>
              <p className='mt-1 text-2xl font-bold'>
                {stats.collected}
                <span className='text-muted-foreground font-normal'>
                  {' '}
                  / {stats.total}
                </span>
              </p>
            </div>
            <div className='rounded-xl border p-4'>
              <p className='text-muted-foreground text-sm'>
                {t('character.gallery.calls')}
              </p>
              <p className='mt-1 text-2xl font-bold'>{stats.totalCalls}</p>
            </div>
          </div>

          {list.length === 0 ? (
            <div className='text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center'>
              <BookOpen className='size-10' />
              <p>{t('character.gallery.empty')}</p>
            </div>
          ) : (
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
              {list.map((character) => (
                <CharacterCard
                  key={character.id}
                  character={character}
                  isPet={pet?.active === true && pet.model_name === character.model_name}
                  petPending={petPending}
                  onTogglePet={togglePet}
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
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}