import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Loader2, Plus, Sparkles, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import {
  createCharacter,
  fetchAdminCharacters,
  fetchBackgroundLibrary,
  generateCharacterImage,
  updateCharacter,
  uploadCharacterImage,
} from './api'
import { ScriptLineEditor } from './components/script-line'
import { StoryAssetsEditor } from './components/story-assets'
import type { CharacterAdminItem, StageDraft } from './types'

const STAGE_NAMES = ['初遇', '同行', '羁绊']

interface FormState {
  model_name: string
  display_name: string
  title: string
  tags: string
  description: string
  system_prompt: string
  affinity_required: number
}

const EMPTY_FORM: FormState = {
  model_name: '',
  display_name: '',
  title: '',
  tags: '',
  description: '',
  system_prompt: '',
  affinity_required: 0,
}

function emptyScriptLine() {
  return { speaker: '', text: '', pose: '', effect: '', background: '', choices: [] }
}

function emptyStage(name: string, index: number): StageDraft {
  return {
    name,
    unlockTokens: index === 0 ? 0 : 0,
    affinityRequired: 0,
    imageUrl: '',
    backgroundUrl: '',
    defaultEffect: 'fade',
    poses: [],
    script: [],
  }
}

function parseStages(item: CharacterAdminItem | null): StageDraft[] {
  try {
    const parsed = item?.stages_json ? JSON.parse(item.stages_json) : null
    const stages = parsed?.stages ?? []
    return STAGE_NAMES.map((name, i) => {
      const s = stages[i] ?? {}
      return {
        name,
        unlockTokens: s.unlock_tokens ?? 0,
        affinityRequired: s.affinity_required ?? 0,
        imageUrl: s.image_url ?? '',
        backgroundUrl: s.background_url ?? '',
        defaultEffect: s.default_effect || 'fade',
        poses: (s.poses ?? []).map((p: { name?: string; image_url?: string }) => ({
          name: p.name ?? '',
          imageUrl: p.image_url ?? '',
        })),
        script: (s.script ?? []).map((l: Record<string, unknown>) => ({
          speaker: l.speaker ?? '',
          text: l.text ?? '',
          pose: l.pose ?? '',
          effect: l.effect ?? '',
          background: l.background ?? '',
          choices: ((l.choices ?? []) as Record<string, unknown>[]).map((c) => ({
            text: c.text ?? '',
            reply: c.reply ?? '',
            pose: c.pose ?? '',
            effect: c.effect ?? '',
            background: c.background ?? '',
          })),
        })),
      }
    })
  } catch {
    return STAGE_NAMES.map(emptyStage)
  }
}

function buildStagesJson(drafts: StageDraft[]): string {
  return JSON.stringify({
    stages: drafts.map((d, i) => ({
      index: i,
      name: d.name,
      image_url: d.imageUrl,
      background_url: d.backgroundUrl || undefined,
      default_effect: d.defaultEffect || undefined,
      poses: (d.poses ?? [])
        .filter((p) => p.name.trim() && p.imageUrl)
        .map((p) => ({ name: p.name.trim(), image_url: p.imageUrl })),
      unlock_tokens: d.unlockTokens,
      affinity_required: d.affinityRequired || undefined,
      unlock_text: `累计消耗 ${d.unlockTokens} tokens 解锁`,
      script: d.script.map((l) => ({
        speaker: l.speaker,
        text: l.text,
        pose: l.pose || undefined,
        effect: l.effect || undefined,
        background: l.background || undefined,
        choices: (l.choices ?? [])
          .filter((c) => c.text.trim())
          .map((c) => ({
            text: c.text,
            reply: c.reply,
            pose: c.pose || undefined,
            effect: c.effect || undefined,
            background: c.background || undefined,
          })),
      })),
    })),
  })
}

function toForm(item: CharacterAdminItem): FormState {
  return {
    model_name: item.model_name,
    display_name: item.display_name,
    title: item.title ?? '',
    tags: item.tags ?? '',
    description: item.description ?? '',
    system_prompt: item.system_prompt ?? '',
    affinity_required: item.affinity_required ?? 0,
  }
}

export default function CharacterEditorPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { modelName = 'new' } = useParams({ strict: false })
  const isNew = modelName === 'new'

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [drafts, setDrafts] = useState<StageDraft[]>(parseStages(null))
  const [generating, setGenerating] = useState<number | null>(null)
  const [assetsGenerating, setAssetsGenerating] = useState<string | null>(null)
  const fileRefs = useRef<(HTMLInputElement | null)[]>([])

  const { data: list = [] } = useQuery({
    queryKey: ['character-admin', ''],
    queryFn: () => fetchAdminCharacters(''),
  })

  const item = useMemo(
    () => (isNew ? null : (list.find((i) => i.model_name === modelName) ?? null)),
    [list, isNew, modelName]
  )

  // 全局背景库（台词背景选择器数据源，所有角色共用）
  const { data: backgroundLibrary = [] } = useQuery({
    queryKey: ['character-backgrounds'],
    queryFn: fetchBackgroundLibrary,
  })

  useEffect(() => {
    if (isNew) {
      setForm(EMPTY_FORM)
      setDrafts(parseStages(null))
    } else if (item) {
      setForm(toForm(item))
      setDrafts(parseStages(item))
    }
  }, [isNew, item])

  const createMut = useMutation({
    mutationFn: createCharacter,
    onSuccess: () => {
      toast.success(t('common.success'))
      qc.invalidateQueries({ queryKey: ['character-admin'] })
      navigate({ to: '/character/admin' })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('Request failed'))
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CharacterAdminItem> }) =>
      updateCharacter(id, data),
    onSuccess: () => {
      toast.success(t('common.success'))
      qc.invalidateQueries({ queryKey: ['character-admin'] })
      navigate({ to: '/character/admin' })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('Request failed'))
    },
  })

  const save = () => {
    if (!item && !form.model_name) {
      toast.error(t('character.admin.needModel'))
      return
    }
    const base = {
      display_name: form.display_name,
      title: form.title,
      tags: form.tags,
      description: form.description,
      system_prompt: form.system_prompt,
      affinity_required: form.affinity_required,
      stages_json: buildStagesJson(drafts),
    }
    if (item) {
      updateMut.mutate({ id: item.id, data: base })
    } else {
      createMut.mutate({ ...base, model_name: form.model_name, enabled: true })
    }
  }

  const onGenerate = async (stage: number) => {
    if (!item) return
    setGenerating(stage)
    try {
      const { image_url } = await generateCharacterImage(item.id, stage, '', {
        type: 'portrait',
      })
      setDrafts((prev) => prev.map((d, i) => (i === stage ? { ...d, imageUrl: image_url ?? '' } : d)))
      toast.success(t('character.admin.generateDone'))
    } catch {
      toast.error(t('character.admin.generateFailed'))
    } finally {
      setGenerating(null)
    }
  }

  const onUpload = async (stage: number, file?: File) => {
    if (!item || !file) return
    try {
      const { image_url } = await uploadCharacterImage(item.id, stage, file, {
        type: 'portrait',
      })
      setDrafts((prev) => prev.map((d, i) => (i === stage ? { ...d, imageUrl: image_url ?? '' } : d)))
    } catch (e) {
      toast.error(t('character.admin.generateFailed'))
    }
  }

  return (
    <main className='min-h-0 flex-1 overflow-y-auto'>
      <div className='container mx-auto max-w-6xl space-y-6 py-8'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold'>
              {item ? t('character.admin.edit') : t('character.admin.create')}
            </h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              {item ? item.model_name : t('character.admin.create')}
            </p>
          </div>
          <Button variant='outline' onClick={() => navigate({ to: '/character/admin' })}>
            <ArrowLeft className='h-4 w-4' />
            {t('character.admin.backToCharacters')}
          </Button>
        </div>

        <Card>
          <CardContent className='space-y-4 pt-4'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label>{t('character.admin.modelName')}</Label>
                <Input
                  value={form.model_name}
                  disabled={!!item}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      model_name: e.target.value.trim(),
                    }))
                  }
                  placeholder={t('character.admin.modelNamePlaceholder')}
                />
                <p className='text-xs text-muted-foreground'>
                  {t('character.admin.modelNameHint')}
                </p>
              </div>
              <div className='space-y-1.5'>
                <Label>{t('character.admin.displayName')}</Label>
                <Input
                  value={form.display_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
                />
              </div>
              <div className='space-y-1.5'>
                <Label>{t('character.admin.roleTitle')}</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                />
              </div>
              <div className='space-y-1.5'>
                <Label>{t('character.admin.tags')}</Label>
                <Input
                  value={form.tags}
                  placeholder='推理系,中文原生'
                  onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                />
              </div>
            </div>
            <div className='space-y-1.5'>
              <Label>{t('character.admin.description')}</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>{t('character.admin.systemPrompt')}</Label>
              <Textarea
                value={form.system_prompt}
                rows={4}
                placeholder={t('character.admin.systemPromptHint')}
                onChange={(e) => setForm((prev) => ({ ...prev, system_prompt: e.target.value }))}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>{t('character.admin.affinityRequired')}</Label>
              <Input
                type='number'
                min={0}
                max={100}
                value={form.affinity_required}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, affinity_required: Number(e.target.value) }))
                }
              />
            </div>

            {drafts.map((stage, i) => (
              <div key={i} className='rounded-lg border p-4'>
                <div className='mb-3 flex items-center justify-between'>
                  <span className='font-medium'>
                    {t('character.admin.stage')} {i + 1} · {stage.name}
                  </span>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={!item || generating === i}
                      onClick={() => onGenerate(i)}
                    >
                      {generating === i ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : (
                        <Sparkles className='h-4 w-4' />
                      )}
                      {generating === i ? t('character.admin.generating') : t('character.admin.generate')}
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={!item}
                      onClick={() => fileRefs.current[i]?.click()}
                    >
                      <Upload className='h-4 w-4' />
                      {t('character.admin.upload')}
                    </Button>
                    <input
                      ref={(el) => {
                        fileRefs.current[i] = el
                      }}
                      type='file'
                      accept='image/*'
                      className='hidden'
                      onChange={(e) => onUpload(i, e.target.files?.[0])}
                    />
                  </div>
                </div>
                <div className='grid gap-4 sm:grid-cols-[160px_1fr]'>
                  <div className='aspect-[3/4] overflow-hidden rounded-md border bg-muted'>
                    {stage.imageUrl ? (
                      <img src={stage.imageUrl} alt={stage.name} className='h-full w-full object-cover' />
                    ) : (
                      <div className='flex h-full items-center justify-center text-xs text-muted-foreground'>
                        {t('character.admin.noImage')}
                      </div>
                    )}
                  </div>
                  <div className='space-y-3'>
                    <div className='flex items-center gap-2'>
                      <Label className='whitespace-nowrap'>{t('character.admin.unlockTokens')}</Label>
                      <Input
                        type='number'
                        value={stage.unlockTokens}
                        onChange={(e) =>
                          setDrafts((prev) =>
                            prev.map((d, idx) =>
                              idx === i ? { ...d, unlockTokens: Number(e.target.value) } : d
                            )
                          )
                        }
                      />
                    </div>
                    <div className='flex items-center gap-2'>
                      <Label className='whitespace-nowrap'>{t('character.admin.affinityRequired')}</Label>
                      <Input
                        type='number'
                        min={0}
                        max={100}
                        value={stage.affinityRequired}
                        onChange={(e) =>
                          setDrafts((prev) =>
                            prev.map((d, idx) =>
                              idx === i ? { ...d, affinityRequired: Number(e.target.value) } : d
                            )
                          )
                        }
                      />
                    </div>
                    <div className='space-y-3'>
                      <StoryAssetsEditor
                        characterId={item?.id ?? 0}
                        stageIndex={i}
                        backgroundUrl={stage.backgroundUrl}
                        defaultEffect={stage.defaultEffect}
                        poses={stage.poses}
                        generating={assetsGenerating}
                        onGeneratingChange={setAssetsGenerating}
                        onChange={(patch) =>
                          setDrafts((prev) =>
                            prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d))
                          )
                        }
                      />
                      <div className='space-y-1.5'>
                        <Label>{t('character.admin.script')}</Label>
                        {stage.script.map((line, li) => (
                          <ScriptLineEditor
                            key={li}
                            index={li}
                            line={line}
                            poseNames={stage.poses.map((p) => p.name.trim()).filter(Boolean)}
                            backgroundNames={backgroundLibrary.map((b) => b.name.trim()).filter(Boolean)}
                            onChange={(patch) =>
                              setDrafts((prev) =>
                                prev.map((d, idx) =>
                                  idx === i
                                    ? {
                                        ...d,
                                        script: d.script.map((s, si) =>
                                          si === li ? { ...s, ...patch } : s
                                        ),
                                      }
                                    : d
                                )
                              )
                            }
                            onRemove={() =>
                              setDrafts((prev) =>
                                prev.map((d, idx) =>
                                  idx === i
                                    ? { ...d, script: d.script.filter((_, si) => si !== li) }
                                    : d
                                )
                              )
                            }
                          />
                        ))}
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() =>
                            setDrafts((prev) =>
                              prev.map((d, idx) =>
                                idx === i
                                  ? { ...d, script: [...d.script, emptyScriptLine()] }
                                  : d
                              )
                            )
                          }
                        >
                          <Plus className='h-4 w-4' />
                          {t('character.admin.addLine')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => navigate({ to: '/character/admin' })}>
                {t('common.cancel')}
              </Button>
              <Button onClick={save}>{t('common.save')}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
