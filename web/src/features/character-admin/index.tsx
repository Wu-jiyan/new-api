import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { getPricing } from '@/features/pricing/api'
import type { PricingModel } from '@/features/pricing/types'

import {
  createCharacter,
  deleteCharacter,
  fetchAdminCharacters,
  generateCharacterImage,
  saveCharacterScript,
  updateCharacter,
  uploadCharacterImage,
} from './api'
import type { CharacterAdminItem } from './types'

const STAGE_NAMES = ['初遇', '同行', '羁绊']

/**
 * 提取模型名前缀，如 deepseek-chat -> deepseek、gpt-4o -> gpt、glm-4 -> glm。
 * 带渠道前缀（如 openai/gpt-4o）时先去掉渠道段。
 */
function extractModelPrefix(modelName: string): string {
  const withoutVendor = modelName.replace(/^[A-Za-z0-9_-]+\//, '')
  const match = withoutVendor.match(/^[A-Za-z0-9]+/)
  return match ? match[0].toLowerCase() : 'other'
}

/** 按模型名前缀分组，前缀字母序排序（含 other 组） */
function groupModelsByPrefix(models: PricingModel[]): [string, PricingModel[]][] {
  const groups = new Map<string, PricingModel[]>()
  for (const m of models) {
    const prefix = extractModelPrefix(m.model_name)
    const arr = groups.get(prefix) ?? []
    arr.push(m)
    groups.set(prefix, arr)
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

interface StageDraft {
  name: string
  unlockTokens: number
  imageUrl: string
  script: { speaker: string; text: string }[]
}

interface FormState {
  model_name: string
  display_name: string
  title: string
  tags: string
  description: string
}

const EMPTY_FORM: FormState = {
  model_name: '',
  display_name: '',
  title: '',
  tags: '',
  description: '',
}

function parseStages(item: CharacterAdminItem | null): StageDraft[] {
  try {
    const parsed = item?.stages_json ? JSON.parse(item.stages_json) : null
    const stages = parsed?.stages ?? []
    return STAGE_NAMES.map((name, i) => ({
      name,
      unlockTokens: stages[i]?.unlock_tokens ?? 0,
      imageUrl: stages[i]?.image_url ?? '',
      script: stages[i]?.script ?? [],
    }))
  } catch {
    return STAGE_NAMES.map((name) => ({ name, unlockTokens: 0, imageUrl: '', script: [] }))
  }
}

function buildStagesJson(drafts: StageDraft[]): string {
  return JSON.stringify({
    stages: drafts.map((d, i) => ({
      index: i,
      name: d.name,
      image_url: d.imageUrl,
      unlock_tokens: d.unlockTokens,
      unlock_text: `累计消耗 ${d.unlockTokens} tokens 解锁`,
      script: d.script,
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
  }
}

export default function CharacterAdminPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState<CharacterAdminItem | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [drafts, setDrafts] = useState<StageDraft[]>(parseStages(null))
  const [generating, setGenerating] = useState<number | null>(null)
  const fileRefs = useRef<(HTMLInputElement | null)[]>([])

  const { data: list = [] } = useQuery({
    queryKey: ['character-admin', keyword],
    queryFn: () => fetchAdminCharacters(keyword),
  })

  const { data: pricing } = useQuery({
    queryKey: ['pricing-models'],
    queryFn: getPricing,
  })
  const modelGroups = groupModelsByPrefix(pricing?.data ?? [])

  const refresh = () => qc.invalidateQueries({ queryKey: ['character-admin'] })

  const createMut = useMutation({
    mutationFn: createCharacter,
    onSuccess: () => {
      toast.success(t('common.success'))
      refresh()
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CharacterAdminItem> }) =>
      updateCharacter(id, data),
    onSuccess: () => {
      toast.success(t('common.success'))
      refresh()
    },
  })

  const delMut = useMutation({
    mutationFn: deleteCharacter,
    onSuccess: () => {
      toast.success(t('common.success'))
      refresh()
    },
  })

  const startCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDrafts(parseStages(null))
  }

  const startEdit = (item: CharacterAdminItem) => {
    setEditing(item)
    setForm(toForm(item))
    setDrafts(parseStages(item))
  }

  const save = () => {
    const base = {
      display_name: form.display_name,
      title: form.title,
      tags: form.tags,
      description: form.description,
      stages_json: buildStagesJson(drafts),
    }
    if (editing) {
      updateMut.mutate({ id: editing.id, data: base })
    } else {
      createMut.mutate({ ...base, model_name: form.model_name, enabled: true })
    }
  }

  const onGenerate = async (stage: number) => {
    if (!editing) return
    setGenerating(stage)
    try {
      const { image_url } = await generateCharacterImage(editing.id, stage, '')
      setDrafts((prev) => prev.map((d, i) => (i === stage ? { ...d, imageUrl: image_url } : d)))
      toast.success(t('character.admin.generateDone'))
    } catch (e) {
      toast.error(t('character.admin.generateFailed'))
    } finally {
      setGenerating(null)
    }
  }

  const onUpload = async (stage: number, file?: File) => {
    if (!editing || !file) return
    try {
      const { image_url } = await uploadCharacterImage(editing.id, stage, file)
      setDrafts((prev) => prev.map((d, i) => (i === stage ? { ...d, imageUrl: image_url } : d)))
    } catch (e) {
      toast.error(t('character.admin.generateFailed'))
    }
  }

  const onSaveScript = async (stage: number) => {
    if (!editing) return
    await saveCharacterScript(editing.id, stage, drafts[stage].script)
    toast.success(t('common.success'))
  }

  return (
    <div className='mx-auto max-w-6xl space-y-4 p-6'>
      <div className='flex items-center justify-between'>
        <h1 className='text-xl font-bold'>{t('character.admin.title')}</h1>
        <div className='flex items-center gap-2'>
          <Input
            placeholder={t('character.admin.search')}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className='w-56'
          />
          <Button onClick={startCreate}>
            <Plus className='h-4 w-4' />
            {t('character.admin.create')}
          </Button>
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {list.map((item) => (
          <Card key={item.id}>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base'>
                {item.display_name || item.model_name}
                <span className='ml-2 text-xs font-normal text-muted-foreground'>
                  {item.model_name}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className='flex items-center justify-between'>
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <span>{item.title || '—'}</span>
              </div>
              <div className='flex gap-1'>
                <Button variant='ghost' size='sm' onClick={() => startEdit(item)}>
                  {t('common.edit')}
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-destructive'
                  onClick={() => delMut.mutate(item.id)}
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {(editing !== null || !list.length) && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? t('character.admin.edit') : t('character.admin.create')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label>{t('character.admin.modelName')}</Label>
                {editing ? (
                  <Input value={form.model_name} disabled />
                ) : (
                  <Combobox
                    items={modelGroups.flatMap(([, ms]) =>
                      ms.map((m) => m.model_name)
                    )}
                    value={form.model_name}
                    onValueChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        model_name: value ?? '',
                      }))
                    }
                  >
                    <ComboboxInput
                      placeholder={t('character.admin.selectModel')}
                    />
                    <ComboboxContent>
                      <ComboboxList>
                        {modelGroups.map(([prefix, ms]) => (
                          <ComboboxGroup key={prefix}>
                            <ComboboxLabel className='uppercase'>
                              {prefix}
                            </ComboboxLabel>
                            {ms.map((m) => (
                              <ComboboxItem
                                key={m.model_name}
                                value={m.model_name}
                              >
                                {m.model_name}
                              </ComboboxItem>
                            ))}
                          </ComboboxGroup>
                        ))}
                        <ComboboxEmpty>
                          {t('character.admin.noModels')}
                        </ComboboxEmpty>
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                )}
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
                      disabled={!editing || generating === i}
                      onClick={() => onGenerate(i)}
                    >
                      <Sparkles className='h-4 w-4' />
                      {generating === i ? t('character.admin.generating') : t('character.admin.generate')}
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={!editing}
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
                    <div className='space-y-1.5'>
                      <Label>{t('character.admin.script')}</Label>
                      {stage.script.map((line, li) => (
                        <div key={li} className='flex gap-2'>
                          <Input
                            className='w-24'
                            value={line.speaker}
                            placeholder={t('character.admin.speaker')}
                            onChange={(e) =>
                              setDrafts((prev) =>
                                prev.map((d, idx) =>
                                  idx === i
                                    ? {
                                        ...d,
                                        script: d.script.map((s, si) =>
                                          si === li ? { ...s, speaker: e.target.value } : s
                                        ),
                                      }
                                    : d
                                )
                              )
                            }
                          />
                          <Input
                            value={line.text}
                            placeholder={t('character.admin.line')}
                            onChange={(e) =>
                              setDrafts((prev) =>
                                prev.map((d, idx) =>
                                  idx === i
                                    ? {
                                        ...d,
                                        script: d.script.map((s, si) =>
                                          si === li ? { ...s, text: e.target.value } : s
                                        ),
                                      }
                                    : d
                                )
                              )
                            }
                          />
                        </div>
                      ))}
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() =>
                          setDrafts((prev) =>
                            prev.map((d, idx) =>
                              idx === i ? { ...d, script: [...d.script, { speaker: '', text: '' }] } : d
                            )
                          )
                        }
                      >
                        <Plus className='h-4 w-4' />
                        {t('character.admin.addLine')}
                      </Button>
                    </div>
                    <Button variant='outline' size='sm' disabled={!editing} onClick={() => onSaveScript(i)}>
                      <RefreshCw className='h-4 w-4' />
                      {t('character.admin.saveScript')}
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => { setEditing(null); setForm(EMPTY_FORM) }}>
                {t('common.cancel')}
              </Button>
              <Button onClick={save}>{t('common.save')}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
