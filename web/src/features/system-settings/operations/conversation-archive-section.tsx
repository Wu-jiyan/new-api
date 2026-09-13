/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { RefreshCw } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const schema = z.object({
  enabled: z.boolean(),
  pushUrl: z.string().trim(),
  pushSecret: z.string(),
  pullToken: z.string().trim(),
  retentionHours: z.coerce.number().int().min(0).max(87600),
})

type Values = z.infer<typeof schema>

/** 生成 64 位十六进制随机令牌，等价于 32 字节熵。 */
function generatePullToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function ConversationArchiveSection({
  defaultValues,
}: {
  defaultValues: {
    enabled: boolean
    pushUrl: string
    pushSecret: string
    pullToken: string
    retentionHours: number
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: {
      enabled: defaultValues.enabled,
      pushUrl: defaultValues.pushUrl,
      pushSecret: defaultValues.pushSecret,
      pullToken: defaultValues.pullToken,
      retentionHours: defaultValues.retentionHours,
    },
  })

  const { isDirty, isSubmitting } = form.formState
  const enabled = form.watch('enabled')
  const pullToken = form.watch('pullToken')

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []

    if (values.enabled !== defaultValues.enabled) {
      updates.push({
        key: 'conversation_archive_setting.enabled',
        value: String(values.enabled),
      })
    }

    if (values.pushUrl !== defaultValues.pushUrl) {
      updates.push({
        key: 'conversation_archive_setting.push_url',
        value: values.pushUrl.trim(),
      })
    }

    if (values.pushSecret !== defaultValues.pushSecret) {
      updates.push({
        key: 'conversation_archive_setting.push_secret',
        value: values.pushSecret,
      })
    }

    if (values.pullToken !== defaultValues.pullToken) {
      updates.push({
        key: 'conversation_archive_setting.pull_token',
        value: values.pullToken.trim(),
      })
    }

    if (values.retentionHours !== defaultValues.retentionHours) {
      updates.push({
        key: 'conversation_archive_setting.retention_hours',
        value: String(values.retentionHours),
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }

    form.reset(values)
  }

  return (
    <SettingsSection title={t('Conversation Archive')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save conversation archive settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable conversation archiving')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Automatically save conversations (user messages and model replies) to the local database after each request, deduplicating follow-up turns of the same conversation. Archived data can be exported as JSONL from /api/conversation_archive/export for model training.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={updateOption.isPending || isSubmitting}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          {enabled && (
            <div className='space-y-6'>
              <FormField
                control={form.control}
                name='retentionHours'
                render={({ field }) => (
                  <FormItem className='max-w-sm'>
                    <FormLabel>{t('Retention (hours)')}</FormLabel>
                    <FormControl>
                      <Input type='number' min={0} placeholder='24' {...field} />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Delete archived conversations older than this after the last update. 0 keeps them forever. A daily cleanup task runs on the gateway, so 24 retains about one day of data.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='grid gap-6 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='pullToken'
                  render={({ field }) => (
                    <FormItem className='sm:col-span-2'>
                      <FormLabel>{t('Pull token')}</FormLabel>
                      <div className='flex items-center gap-2'>
                        <FormControl>
                          <Input
                            type='text'
                            className='font-mono text-xs'
                            placeholder={t('Leave empty to disable pull access')}
                            {...field}
                          />
                        </FormControl>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => field.onChange(generatePullToken())}
                        >
                          <RefreshCw className='size-3.5' />
                          {t('Generate')}
                        </Button>
                        {pullToken ? <CopyButton value={pullToken} /> : null}
                      </div>
                      <FormDescription>
                        {t(
                          'Dedicated token that only grants access to the archive pull endpoints (/api/conversation_archive/export and the list). Use Authorization: <token> or x-api-key. Leave empty to require an admin account instead.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='pushUrl'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Push URL')}</FormLabel>
                      <FormControl>
                        <Input
                          type='url'
                          placeholder='https://collector.example.com/api/conversations'
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Optional. Each archived conversation is pushed to this URL via outbound HTTP POST; the target must be reachable from the gateway. To sync to a machine without a public IP, leave this empty and let it pull /api/conversation_archive/export?after_id=<last_id> with the pull token instead.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='pushSecret'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Push secret')}</FormLabel>
                      <FormControl>
                        <Input
                          type='password'
                          placeholder={t('Bearer token for the push endpoint')}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Optional. Sent as the Authorization: Bearer header when pushing records.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
