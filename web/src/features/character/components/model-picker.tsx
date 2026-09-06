import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getUserGroups, getUserModels } from '@/features/playground/api'
import { cn } from '@/lib/utils'

import { GlassSelect } from './glass-select'

interface ModelPickerProps {
  open: boolean
  /** 角色 model_name 前缀：仅列出该前缀下可用模型 */
  modelPrefix: string
  /** 角色配置的默认模型（存在且可选时默认勾选） */
  defaultModel?: string
  onConfirm: (model: string, group: string) => void
}

/**
 * 进入 AI 剧情阶段时的模型/分组选择弹窗。
 * 默认分组 auto（无则第一个），默认模型取角色配置，未配置则取列表第一个。
 */
export function ModelPicker({ open, modelPrefix, defaultModel, onConfirm }: ModelPickerProps) {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<string[]>([])
  const [group, setGroup] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(false)

  // 分组列表：默认 auto（后端确认可用时）否则第一个
  useEffect(() => {
    if (!open) return
    let cancelled = false
    getUserGroups().then((gs) => {
      if (cancelled) return
      const values = gs.map((g) => g.value)
      setGroups(values)
      setGroup((prev) => prev || (values.includes('auto') ? 'auto' : (values[0] ?? '')))
    })
    return () => {
      cancelled = true
    }
  }, [open])

  // 分组变化 → 拉取该分组下前缀可用模型
  useEffect(() => {
    if (!open || !group) return
    let cancelled = false
    setLoading(true)
    getUserModels(group)
      .then((ms) => {
        if (cancelled) return
        const filtered = ms.map((m) => m.value).filter((v) => v.startsWith(modelPrefix))
        setModels(filtered)
        setModel((prev) => {
          if (prev && filtered.includes(prev)) return prev
          if (defaultModel && filtered.includes(defaultModel)) return defaultModel
          return filtered[0] ?? ''
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, group, modelPrefix, defaultModel])

  return (
    <Dialog open={open}>
      <DialogContent className='z-[120] sm:max-w-sm' onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('character.story.modelTitle')}</DialogTitle>
          <DialogDescription>{t('character.story.modelTitleHint')}</DialogDescription>
        </DialogHeader>

        <div className='space-y-1.5'>
          <div className='text-muted-foreground text-xs'>{t('character.story.groupLabel')}</div>
          <GlassSelect
            value={group}
            options={groups}
            onChange={setGroup}
            dropUp={false}
            className='w-full [&>button]:w-full [&>button]:justify-between [&>button]:bg-background [&>button]:text-foreground'
          />
        </div>

        <div className='space-y-1.5'>
          <div className='text-muted-foreground text-xs'>{t('character.story.modelLabel')}</div>
          {loading ? (
            <div className='text-muted-foreground py-4 text-center text-xs'>…</div>
          ) : models.length === 0 ? (
            <div className='text-muted-foreground py-4 text-center text-xs'>
              {t('character.story.noModels')}
            </div>
          ) : (
            <div className='max-h-56 space-y-1 overflow-y-auto pr-1'>
              {models.map((m) => (
                <button
                  key={m}
                  type='button'
                  className={cn(
                    'bg-background flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    model === m
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'hover:bg-accent text-foreground/80'
                  )}
                  onClick={() => setModel(m)}
                >
                  <span className='truncate'>{m}</span>
                  {model === m && <span className='text-primary'>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type='button'
          disabled={!model}
          className='bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs w-full rounded-full py-2 text-sm font-semibold transition-colors disabled:opacity-50'
          onClick={() => model && onConfirm(model, group)}
        >
          {t('character.story.confirmStart')}
        </button>
      </DialogContent>
    </Dialog>
  )
}
