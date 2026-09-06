import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { ChoiceDraft, ScriptLineDraft } from '../types'

export interface ScriptLineEditorProps {
  line: ScriptLineDraft
  poseNames: string[]
  backgroundNames: string[]
  index: number
  onChange: (patch: Partial<ScriptLineDraft>) => void
  onRemove: () => void
}

const EFFECTS = ['fade', 'black', 'white']

const EFFECT_KEYS: Record<string, string> = {
  fade: 'character.admin.effectFade',
  black: 'character.admin.effectBlack',
  white: 'character.admin.effectWhite',
}

const EMPTY_CHOICE: ChoiceDraft = { text: '', reply: '', pose: '', effect: '', background: '' }

export function ScriptLineEditor({
  line,
  poseNames,
  backgroundNames,
  index,
  onChange,
  onRemove,
}: ScriptLineEditorProps) {
  const { t } = useTranslation()

  const poseLabel = (v: string) => v || t('character.admin.noPose')
  const backgroundLabel = (v: string) => v || t('character.admin.noBackground')
  const effectLabel = (v: string) =>
    v ? t(EFFECT_KEYS[v] ?? '') || v : t('character.admin.effectDefault')

  const updateChoice = (ci: number, patch: Partial<ChoiceDraft>) => {
    onChange({
      choices: (line.choices ?? []).map((c, i) => (i === ci ? { ...c, ...patch } : c)),
    })
  }

  const removeChoice = (ci: number) => {
    onChange({ choices: (line.choices ?? []).filter((_, i) => i !== ci) })
  }

  const addChoice = () => {
    onChange({ choices: [...(line.choices ?? []), { ...EMPTY_CHOICE }] })
  }

  const poseSelect = (
    <Select value={line.pose || 'none'} onValueChange={(v) => onChange({ pose: v === 'none' ? '' : (v ?? '') })}>
      <SelectTrigger className='w-28'>
        <SelectValue>{poseLabel(line.pose)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='none'>{t('character.admin.noPose')}</SelectItem>
        {poseNames.map((p) => (
          <SelectItem key={p} value={p}>
            {p}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const backgroundSelect = (
    <Select
      value={line.background || 'none'}
      onValueChange={(v) => onChange({ background: v === 'none' ? '' : (v ?? '') })}
    >
      <SelectTrigger className='w-28'>
        <SelectValue>{backgroundLabel(line.background)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='none'>{t('character.admin.noBackground')}</SelectItem>
        {backgroundNames.map((b) => (
          <SelectItem key={b} value={b}>
            {b}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const effectSelect = (value: string, onChangeValue: (v: string) => void) => (
    <Select value={value || 'default'} onValueChange={(v) => onChangeValue(v === 'default' ? '' : (v ?? ''))}>
      <SelectTrigger className='w-28'>
        <SelectValue>{effectLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='default'>{t('character.admin.effectDefault')}</SelectItem>
        {EFFECTS.map((e) => (
          <SelectItem key={e} value={e}>
            {t(EFFECT_KEYS[e])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className='space-y-2 rounded-md border p-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='w-24'
          value={line.speaker}
          placeholder={t('character.admin.speaker')}
          onChange={(e) => onChange({ speaker: e.target.value })}
        />
        <Input
          className='min-w-48 flex-1'
          value={line.text}
          placeholder={t('character.admin.line')}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        {poseSelect}
        {backgroundSelect}
        {effectSelect(line.effect ?? '', (v) => onChange({ effect: v }))}
        <Button variant='ghost' size='icon-xs' aria-label={t('character.admin.removeLine')} onClick={onRemove}>
          <Trash2 className='h-4 w-4' />
        </Button>
      </div>
      {index === -1 && null}
      {(line.choices ?? []).map((choice, ci) => (
        <div key={ci} className='flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2'>
          <Input
            className='w-40'
            value={choice.text}
            placeholder={t('character.admin.choiceText')}
            onChange={(e) => updateChoice(ci, { text: e.target.value })}
          />
          <Input
            className='min-w-40 flex-1'
            value={choice.reply}
            placeholder={t('character.admin.choiceReply')}
            onChange={(e) => updateChoice(ci, { reply: e.target.value })}
          />
          <Select value={choice.pose || 'none'} onValueChange={(v) => updateChoice(ci, { pose: v === 'none' ? '' : (v ?? '') })}>
            <SelectTrigger className='w-28'>
              <SelectValue>{poseLabel(choice.pose)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='none'>{t('character.admin.noPose')}</SelectItem>
              {poseNames.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={choice.background || 'none'}
            onValueChange={(v) => updateChoice(ci, { background: v === 'none' ? '' : (v ?? '') })}
          >
            <SelectTrigger className='w-28'>
              <SelectValue>{backgroundLabel(choice.background)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='none'>{t('character.admin.noBackground')}</SelectItem>
              {backgroundNames.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {effectSelect(choice.effect ?? '', (v) => updateChoice(ci, { effect: v }))}
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label={t('character.admin.removeChoice')}
            onClick={() => removeChoice(ci)}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      ))}
      <Button variant='ghost' size='sm' onClick={addChoice}>
        <Plus className='h-4 w-4' />
        {t('character.admin.addChoice')}
      </Button>
    </div>
  )
}
