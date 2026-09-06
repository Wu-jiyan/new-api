import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  Heart,
  Loader2,
  Lock,
  LockKeyhole,
  MessagesSquare,
  Play,
  Share2,
  Sparkles,
  Unlock,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { fetchCharacter, fetchCharacterChatMeta, forgetCharacter, unlockCharacter } from './api'
import { Lightbox } from './components/lightbox'
import { ShareCard } from './components/share-card'
import { StoryPlayer } from './components/story-player'
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
  const [shareOpen, setShareOpen] = useState(false)
  const [storyOpen, setStoryOpen] = useState(false)
  // 「与角色对话」与「进入剧情」共用全屏播放器，仅在起始阶段上不同
  const [chatStart, setChatStart] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const { data: character, isLoading } = useQuery({
    queryKey: ['character', modelName],
    queryFn: () => fetchCharacter(modelName),
    enabled: !!modelName,
  })

  // 对话进度：有进度时入口变为「继续剧情」（直接续聊，不重播剧本）
  const { data: chatMeta } = useQuery({
    queryKey: ['character-chat-meta', modelName],
    queryFn: () => fetchCharacterChatMeta(modelName),
    enabled: !!modelName,
  })
  const hasProgress = (chatMeta?.has_history ?? false) && (character?.total_calls ?? 0) >= 1
  const [forgetOpen, setForgetOpen] = useState(false)
  const [forgetting, setForgetting] = useState(false)

  const onForget = async () => {
    if (!modelName || forgetting) return
    setForgetting(true)
    try {
      await forgetCharacter(modelName)
      setForgetOpen(false)
      setChatStart(false)
      qc.invalidateQueries({ queryKey: ['character', modelName] })
      qc.invalidateQueries({ queryKey: ['character-chat-meta', modelName] })
      qc.invalidateQueries({ queryKey: ['character-chat-history', modelName] })
      toast.success(t('common.success'))
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('character.unlockFailed'))
    } finally {
      setForgetting(false)
    }
  }

  const currentStage = useMemo<CharacterStageView | undefined>(() => {
    return character?.stages.find((s) => s.index === activeStage)
  }, [character, activeStage])

  const qc = useQueryClient()
  const [unlocking, setUnlocking] = useState(false)
  const [unlockFx, setUnlockFx] = useState(false)

  const unlockStage = async (index: number) => {
    if (unlocking || !character) return
    setUnlocking(true)
    try {
      await unlockCharacter(character.model_name, index)
      setUnlockFx(true)
      setActiveStage(index)
      setTimeout(() => qc.invalidateQueries({ queryKey: ['character', modelName] }), 600)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('character.unlockFailed'))
    } finally {
      setUnlocking(false)
    }
  }

  if (isLoading) {
    return (
      <main className='min-h-0 flex-1 overflow-y-auto'>
        <div className='container mx-auto max-w-6xl space-y-6 py-8'>
          <Skeleton className='h-96 w-full rounded-xl' />
          <Skeleton className='h-24 w-full' />
        </div>
      </main>
    )
  }

  if (!character) {
    return (
      <main className='min-h-0 flex-1 overflow-y-auto'>
        <div className='container mx-auto max-w-6xl py-8 text-center text-muted-foreground'>
          {t('character.notFound')}
        </div>
      </main>
    )
  }

  const currentClaimed = currentStage?.claimed ?? false
  const currentEligible = currentStage?.eligible ?? false
  const activeImage = currentClaimed
    ? currentStage?.image_url
    : currentStage?.silhouette_url

  const shareImageUrl = character.stages[character.max_stage]?.image_url
  const shareStageName =
    character.stages[character.max_stage]?.name ?? currentStage?.name ?? ''
  const shareDisabled = character.max_stage < 0 || !shareImageUrl

  return (
    <main className='min-h-0 flex-1 overflow-y-auto'>
      <div className='container mx-auto max-w-6xl space-y-6 py-8'>
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
          {activeImage ? (
            <img
              src={activeImage}
              alt={character.display_name}
              className={cn(
                'h-full w-full cursor-zoom-in object-cover object-top',
                !currentClaimed && 'opacity-60'
              )}
              onClick={() => setLightboxOpen(true)}
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
              onClick={() => {
                setChatStart(true)
                setStoryOpen(true)
              }}
              disabled={character.total_calls < 1}
              title={character.total_calls < 1 ? t('character.locked') : undefined}
            >
              <MessagesSquare className='mr-2 h-4 w-4' />
              {t('character.chat.open')}
            </Button>
            {hasProgress && (
              <Button
                variant='ghost'
                className='text-muted-foreground hover:text-destructive'
                onClick={() => setForgetOpen(true)}
              >
                {t('character.forget.button')}
              </Button>
            )}
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

          {/* 好感 */}
          <div>
            <div className='flex items-center justify-between text-sm'>
              <span className='flex items-center gap-1 font-medium'>
                <Heart className='h-4 w-4 fill-current text-rose-500' />
                {t('character.affinity')}
              </span>
              <span className='text-muted-foreground'>
                {character.affinity}/100
                {character.affinity_required > 0 &&
                  ` · ${t('character.admin.affinityRequired')} ${character.affinity_required}`}
              </span>
            </div>
            <div className='bg-muted mt-2 h-1.5 w-full overflow-hidden rounded-full'>
              <div
                className='bg-rose-500 h-full rounded-full transition-all duration-300'
                style={{ width: `${Math.max(0, Math.min(100, character.affinity))}%` }}
              />
            </div>
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
                const tokenPct =
                  stage.unlock_tokens > 0
                    ? Math.min(
                        100,
                        Math.round((character.total_tokens / stage.unlock_tokens) * 100)
                      )
                    : 100
                const affinityReady =
                  stage.affinity_required === undefined ||
                  character.affinity >= stage.affinity_required
                const right = stage.claimed ? (
                  <span className='text-xs text-primary'>{t('character.unlocked')}</span>
                ) : stage.eligible ? (
                  <Button
                    size='sm'
                    variant='default'
                    disabled={unlocking}
                    onClick={(e) => {
                      e.stopPropagation()
                      unlockStage(stage.index)
                    }}
                  >
                    <Unlock className='mr-1 h-3.5 w-3.5' />
                    {t('character.unlock')}
                  </Button>
                ) : (
                  <span className='text-xs text-muted-foreground'>
                    {stage.affinity_required && !affinityReady
                      ? `♥ ${character.affinity}/${stage.affinity_required}`
                      : `${formatTokens(stage.unlock_tokens)} tokens`}
                  </span>
                )
                const icon = stage.claimed ? (
                  <Sparkles className='h-4 w-4 text-primary' />
                ) : stage.eligible ? (
                  <LockKeyhole className='h-4 w-4 text-amber-500' />
                ) : (
                  <Lock className='h-4 w-4 text-muted-foreground' />
                )
                return (
                  <button
                    key={stage.index}
                    className={cn(
                      'relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-lg border px-4 py-2.5 text-left transition-colors',
                      stage.claimed ? 'hover:bg-accent' : 'opacity-80',
                      activeStage === stage.index && 'border-primary bg-accent'
                    )}
                    onClick={() => setActiveStage(stage.index)}
                  >
                    {!stage.claimed && !stage.eligible && tokenPct < 100 && (
                      <span className='bg-muted absolute inset-x-0 bottom-0 h-1'>
                        <span
                          className='bg-primary/70 block h-full transition-all duration-300'
                          style={{ width: `${tokenPct}%` }}
                        />
                      </span>
                    )}
                    <div className='flex items-center gap-2'>
                      {icon}
                      <span className='font-medium'>{stage.name}</span>
                    </div>
                    {right}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 进入剧情 / 解锁 */}
          <div className='relative'>
            {unlockFx && (
              <span className='pointer-events-none absolute inset-0 z-10 flex items-center justify-center'>
                <span className='unlock-ring' />
              </span>
            )}
            {currentClaimed ? (
              <Button
                variant='outline'
                size='lg'
                className='w-full gap-2'
                onClick={() => {
                  setChatStart(hasProgress)
                  setStoryOpen(true)
                }}
              >
                <Play className='h-5 w-5' />
                {hasProgress ? t('character.story.goOn') : t('character.story.enter')}
              </Button>
            ) : currentEligible ? (
              <Button
                variant='default'
                size='lg'
                className='unlock-glow w-full gap-2'
                disabled={unlocking}
                onClick={() => unlockStage(activeStage)}
              >
                {unlocking ? (
                  <Loader2 className='h-5 w-5 animate-spin' />
                ) : (
                  <LockKeyhole className='h-5 w-5' />
                )}
                {t('character.unlock')}
                {currentStage?.name}
              </Button>
            ) : (
              <Button
                variant='outline'
                size='lg'
                className='w-full gap-2'
                disabled
                title={t('character.locked')}
              >
                <Play className='h-5 w-5' />
                {t('character.story.enter')}
              </Button>
            )}
            {!currentClaimed && (
              <p className='mt-2 text-sm text-muted-foreground'>
                {currentStage?.unlock_text ?? t('character.locked')}
              </p>
            )}
          </div>
        </div>
      </div>

      <ShareCard
        modelName={character.model_name}
        displayName={character.display_name}
        title={character.title ?? ''}
        stageName={shareStageName}
        imageUrl={shareImageUrl ?? ''}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      <StoryPlayer
        open={storyOpen}
        onOpenChange={setStoryOpen}
        character={character}
        stageIndex={activeStage}
        startInChat={chatStart}
      />

      <Lightbox
        open={lightboxOpen}
        src={activeImage}
        alt={character.display_name}
        onOpenChange={setLightboxOpen}
      />

      <Dialog open={forgetOpen} onOpenChange={setForgetOpen}>
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>{t('character.forget.title')}</DialogTitle>
            <DialogDescription>{t('character.forget.confirmText')}</DialogDescription>
          </DialogHeader>
          <p className='text-muted-foreground text-sm'>{t('character.forget.detail')}</p>
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => setForgetOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant='destructive' disabled={forgetting} onClick={() => void onForget()}>
              {forgetting ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
              {t('character.forget.button')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </main>
  )
}
