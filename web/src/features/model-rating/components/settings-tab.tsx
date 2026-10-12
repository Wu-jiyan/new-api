import { useState } from 'react'
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toIntlLocale } from '@/i18n/languages'

import { updateAASettings } from '../api'
import type { AASyncStatus } from '../types'

const AA_ATTRIBUTION_URL = 'https://artificialanalysis.ai/'

export function SettingsTab(props: {
  aa: AASyncStatus
  onReload: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const configured = await updateAASettings(apiKey)
      setApiKey('')
      toast.success(
        configured
          ? t('Artificial Analysis API key saved')
          : t('Artificial Analysis API key cleared')
      )
      props.onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Update failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='space-y-4'>
      <Card className='p-4'>
        <div className='flex items-center gap-2 text-sm font-semibold'>
          <KeyRound className='size-4' />
          {t('Artificial Analysis API key')}
        </div>
        <p className='mt-1 text-xs text-muted-foreground'>
          {t(
            'Required to sync the AA Intelligence, Coding and Agentic dimensions. Stored on the server only and never returned to the browser. The free tier allows 100 requests per 24-hour window, and one daily sync uses about two.'
          )}
        </p>
        <div className='mt-3 flex flex-wrap items-end gap-2'>
          <div className='flex min-w-64 flex-1 flex-col gap-1'>
            <Label htmlFor='aa-api-key'>{t('API key')}</Label>
            <Input
              id='aa-api-key'
              type='password'
              autoComplete='off'
              placeholder={props.aa.api_key_set ? t('Configured, enter a new key to replace') : t('Not configured')}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <Button size='sm' disabled={saving || apiKey.trim() === ''} onClick={() => void save()}>
            {t('Save')}
          </Button>
          {props.aa.api_key_set && (
            <Button
              size='sm'
              variant='outline'
              disabled={saving}
              onClick={() => {
                setApiKey('')
                void updateAASettings('')
                  .then(() => toast.success(t('Artificial Analysis API key cleared')))
                  .then(() => props.onReload())
                  .catch((error: unknown) =>
                    toast.error(error instanceof Error ? error.message : t('Update failed'))
                  )
              }}
            >
              <Trash2 className='mr-1.5 size-4' /> {t('Clear key')}
            </Button>
          )}
        </div>
        <div className='mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
          <span>
            {props.aa.api_key_set ? t('Status: configured') : t('Status: not configured')}
          </span>
          <span>
            {props.aa.last_sync_at > 0
              ? t('Last sync: {{time}} · updated {{count}}', {
                  time: new Date(props.aa.last_sync_at * 1000).toLocaleString(locale),
                  count: props.aa.last_sync_num,
                })
              : t('Never synced')}
          </span>
        </div>
        {props.aa.last_error && (
          <p className='mt-2 text-xs text-destructive'>{props.aa.last_error}</p>
        )}
      </Card>

      <Card className='p-4'>
        <div className='text-sm font-semibold'>{t('Attribution')}</div>
        <p className='mt-1 text-xs text-muted-foreground'>
          {t(
            'The Artificial Analysis free tier requires crediting the source when the data is displayed. Model scores in the model square link back to the provider.'
          )}
        </p>
        <a
          href={AA_ATTRIBUTION_URL}
          target='_blank'
          rel='noreferrer'
          className='text-primary mt-2 inline-flex items-center text-xs underline-offset-2 hover:underline'
        >
          {AA_ATTRIBUTION_URL.replace(/^https?:\/\//, '')}
          <ExternalLink className='ml-1.5 size-3.5' />
        </a>
      </Card>
    </div>
  )
}