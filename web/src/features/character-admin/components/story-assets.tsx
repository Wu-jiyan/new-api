import { Loader2, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { generateCharacterImage, uploadCharacterImage } from '../api'
import type { PoseDraft } from '../types'

export interface StoryAssetsEditorProps {
  characterId: number
  stageIndex: number
  backgroundUrl: string
  defaultEffect: string
  poses: PoseDraft[]
  generating: string | null
  onGeneratingChange: (key: string | null) => void
  onChange: (
    patch: Partial<{
      backgroundUrl: string
      defaultEffect: string
      poses: PoseDraft[]
    }>
  ) => void
}

const EFFECTS = ['fade', 'black', 'white']

const EFFECT_KEYS: Record<string, string> = {
  fade: 'character.admin.effectFade',
  black: 'character.admin.effectBlack',
  white: 'character.admin.effectWhite',
}

export function StoryAssetsEditor({
  characterId,
  stageIndex,
  backgroundUrl,
  defaultEffect,
  poses,
  generating,
  onGeneratingChange,
  onChange,
}: StoryAssetsEditorProps) {
  const { t } = useTranslation()
  const bgFileRef = useRef<HTMLInputElement | null>(null)
  const poseFileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const genKey = (kind: string, poseName?: string) =>
    poseName ? `${kind}:${poseName}` : kind

  const effectLabel = (v: string) =>
    v === 'none' ? t('character.admin.noEffect') : t(EFFECT_KEYS[v] ?? '') || v

  const onUploadBackground = async (file?: File) => {
    if (!file) return
    onGeneratingChange('background')
    try {
      const { background_url } = await uploadCharacterImage(characterId, stageIndex, file, {
        type: 'background',
      })
      if (background_url) onChange({ backgroundUrl: background_url })
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('character.admin.generateFailed'))
    } finally {
      onGeneratingChange(null)
    }
  }

  const onGeneratePose = async (pose: PoseDraft) => {
    if (!pose.name.trim()) {
      toast.error(t('character.admin.needPoseName'))
      return
    }
    onGeneratingChange(genKey('pose', pose.name))
    try {
      const { image_url } = await generateCharacterImage(characterId, stageIndex, '', {
        type: 'pose',
        pose_name: pose.name.trim(),
      })
      if (image_url) {
        onChange({
          poses: poses.map((p) =>
            p.name === pose.name ? { ...p, imageUrl: image_url } : p
          ),
        })
      }
      toast.success(t('character.admin.generateDone'))
    } catch {
      toast.error(t('character.admin.generateFailed'))
    } finally {
      onGeneratingChange(null)
    }
  }

  const onUploadPose = async (pose: PoseDraft, file?: File) => {
    if (!file) return
    if (!pose.name.trim()) {
      toast.error(t('character.admin.needPoseName'))
      return
    }
    onGeneratingChange(genKey('pose', pose.name))
    try {
      const { image_url } = await uploadCharacterImage(characterId, stageIndex, file, {
        type: 'pose',
        pose_name: pose.name.trim(),
      })
      if (image_url) {
        onChange({
          poses: poses.map((p) =>
            p.name === pose.name ? { ...p, imageUrl: image_url } : p
          ),
        })
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('character.admin.generateFailed'))
    } finally {
      onGeneratingChange(null)
    }
  }

  const updatePose = (index: number, patch: Partial<PoseDraft>) => {
    onChange({ poses: poses.map((p, i) => (i === index ? { ...p, ...patch } : p)) })
  }

  const removePose = (index: number) => {
    onChange({ poses: poses.filter((_, i) => i !== index) })
  }

  const addPose = () => {
    onChange({ poses: [...poses, { name: '', imageUrl: '' }] })
  }

  return (
    <div className='space-y-4 border-t pt-4'>
      <div className='flex items-center justify-between'>
        <span className='font-medium'>{t('character.admin.storyAssets')}</span>
        <div className='flex items-center gap-2'>
          <Label className='whitespace-nowrap text-xs text-muted-foreground'>
            {t('character.admin.defaultEffect')}
          </Label>
          <Select
            value={defaultEffect || 'fade'}
            onValueChange={(v) => onChange({ defaultEffect: v ?? '' })}
          >
            <SelectTrigger className='w-32'>
              <SelectValue>{effectLabel(defaultEffect || 'fade')}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='none'>{t('character.admin.noEffect')}</SelectItem>
              {EFFECTS.map((e) => (
                <SelectItem key={e} value={e}>
                  {t(EFFECT_KEYS[e])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 背景图 */}
      <div className='grid gap-3 sm:grid-cols-[120px_1fr]'>
        <div className='aspect-[16/10] overflow-hidden rounded-md border bg-muted'>
          {backgroundUrl ? (
            <img src={backgroundUrl} alt='bg' className='h-full w-full object-cover' />
          ) : (
            <div className='flex h-full items-center justify-center text-xs text-muted-foreground'>
              {t('character.admin.noImage')}
            </div>
          )}
        </div>
        <div className='flex items-end gap-2'>
          <div className='space-y-1'>
            <Label className='text-xs text-muted-foreground'>{t('character.admin.background')}</Label>
            <p className='text-xs text-muted-foreground'>{t('character.admin.backgroundHint')}</p>
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={!characterId || generating !== null}
              onClick={() => bgFileRef.current?.click()}
            >
              <Upload className='h-4 w-4' />
              {t('character.admin.upload')}
            </Button>
            <input
              ref={(el) => {
                bgFileRef.current = el
              }}
              type='file'
              accept='image/*'
              className='hidden'
              onChange={(e) => onUploadBackground(e.target.files?.[0])}
            />
          </div>
        </div>
      </div>

      {/* 姿态列表 */}
      <div className='space-y-2'>
        <Label className='text-xs text-muted-foreground'>{t('character.admin.poses')}</Label>
        {poses.map((pose, i) => (
          <div key={i} className='flex flex-wrap items-center gap-2 rounded-md border p-2'>
            <Input
              className='w-28'
              value={pose.name}
              placeholder={t('character.admin.poseName')}
              onChange={(e) => updatePose(i, { name: e.target.value })}
            />
            <div className='flex items-center gap-1.5'>
              {pose.imageUrl && (
                <img
                  src={pose.imageUrl}
                  alt={pose.name}
                  className='h-10 w-8 rounded border object-cover'
                />
              )}
              <Button
                variant='outline'
                size='sm'
                disabled={!characterId || generating !== null}
                onClick={() => onGeneratePose(pose)}
              >
                {generating === genKey('pose', pose.name) ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Sparkles className='h-4 w-4' />
                )}
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={!characterId || generating !== null}
                onClick={() => poseFileRefs.current[pose.name]?.click()}
              >
                <Upload className='h-4 w-4' />
              </Button>
              <input
                ref={(el) => {
                  poseFileRefs.current[pose.name] = el
                }}
                type='file'
                accept='image/*'
                className='hidden'
                onChange={(e) => onUploadPose(pose, e.target.files?.[0])}
              />
              <Button variant='ghost' size='icon-xs' onClick={() => removePose(i)}>
                <Trash2 className='h-4 w-4' />
              </Button>
            </div>
          </div>
        ))}
        <Button variant='ghost' size='sm' onClick={addPose}>
          <Plus className='h-4 w-4' />
          {t('character.admin.addPose')}
        </Button>
      </div>
    </div>
  )
}
