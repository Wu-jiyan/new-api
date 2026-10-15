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
import { useEffect, useId, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

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
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

import {
  SettingsControlGroup,
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import { HistoryLogCleanup } from './history-log-cleanup'
import { ServerLogFiles } from './server-log-files'

const MAX_RETENTION_DAYS = 3650

const logSettingsSchema = z.object({
  LogConsumeEnabled: z.boolean(),
  log_setting: z.object({
    user_export_enabled: z.boolean(),
    max_range_days: z.number().int().min(1),
  }),
  logCleanupEnabled: z.boolean(),
  retentionDays: z
    .number()
    .int('Retention must be a whole number of days.')
    .min(0, 'Retention cannot be negative.')
    .max(MAX_RETENTION_DAYS, 'Retention cannot exceed 3650 days.'),
})

type LogSettingsFormValues = z.infer<typeof logSettingsSchema>

type LogSettingsSectionProps = {
  defaultValues: {
    LogConsumeEnabled: boolean
    'log_setting.user_export_enabled': boolean
    'log_setting.max_range_days': number
    'log_cleanup_setting.enabled': boolean
    'log_cleanup_setting.retention_days': number
  }
}

export function LogSettingsSection(props: LogSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const recordingTitleId = useId()
  const searchTitleId = useId()
  const retentionTitleId = useId()
  const formDefaults = useMemo<LogSettingsFormValues>(
    () => ({
      LogConsumeEnabled: props.defaultValues.LogConsumeEnabled,
      log_setting: {
        user_export_enabled:
          props.defaultValues['log_setting.user_export_enabled'],
        max_range_days: props.defaultValues['log_setting.max_range_days'],
      },
      logCleanupEnabled: props.defaultValues['log_cleanup_setting.enabled'],
      retentionDays: props.defaultValues['log_cleanup_setting.retention_days'],
    }),
    [props.defaultValues]
  )
  const form = useForm<LogSettingsFormValues>({
    resolver: zodResolver(logSettingsSchema),
    defaultValues: formDefaults,
  })
  const autoCleanupEnabled = form.watch('logCleanupEnabled')

  useEffect(() => {
    form.reset(formDefaults)
  }, [formDefaults, form])

  const onSubmit = async (values: LogSettingsFormValues) => {
    const updates: Array<{ key: string; value: string | boolean | number }> = []

    if (values.LogConsumeEnabled !== props.defaultValues.LogConsumeEnabled) {
      updates.push({
        key: 'LogConsumeEnabled',
        value: values.LogConsumeEnabled,
      })
    }
    if (
      values.log_setting.user_export_enabled !==
      props.defaultValues['log_setting.user_export_enabled']
    ) {
      updates.push({
        key: 'log_setting.user_export_enabled',
        value: values.log_setting.user_export_enabled,
      })
    }
    if (
      values.log_setting.max_range_days !==
      props.defaultValues['log_setting.max_range_days']
    ) {
      updates.push({
        key: 'log_setting.max_range_days',
        value: values.log_setting.max_range_days,
      })
    }
    if (
      values.logCleanupEnabled !==
      props.defaultValues['log_cleanup_setting.enabled']
    ) {
      updates.push({
        key: 'log_cleanup_setting.enabled',
        value: values.logCleanupEnabled,
      })
    }
    if (
      values.retentionDays !==
      props.defaultValues['log_cleanup_setting.retention_days']
    ) {
      updates.push({
        key: 'log_cleanup_setting.retention_days',
        value: String(values.retentionDays),
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
    <SettingsSection title={t('Log Maintenance')} className='gap-6'>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save log settings'
          />
          <div
            role='group'
            aria-labelledby={recordingTitleId}
            className='flex min-w-0 flex-col gap-4'
          >
            <h4 id={recordingTitleId} className='font-medium'>
              {t('Log recording')}
            </h4>
            <FormField
              control={form.control}
              name='LogConsumeEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Record quota usage')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Track per-request consumption to power usage analytics. Keeping this on increases database writes.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </SettingsSwitchItem>
              )}
            />
          </div>

          <Separator />

          <div
            role='group'
            aria-labelledby={searchTitleId}
            className='flex min-w-0 flex-col gap-4'
          >
            <h4 id={searchTitleId} className='font-medium'>
              {t('Log search and export')}
            </h4>
            <SettingsFormGrid>
              <FormField
                control={form.control}
                name='log_setting.user_export_enabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Allow users to export logs')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Users can download their own logs from the usage log page. Administrators can always export.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </SettingsSwitchItem>
                )}
              />
              <FormField
                control={form.control}
                name='log_setting.max_range_days'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Longest log time range (days)')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={1}
                        step={1}
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'The longest time range a user can view at once in the logs and on the dashboard, and the longest range any export can cover.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SettingsFormGrid>
          </div>

          <Separator />

          <div
            role='group'
            aria-labelledby={retentionTitleId}
            className='flex min-w-0 flex-col gap-4'
          >
            <h4 id={retentionTitleId} className='font-medium'>
              {t('Automatic log cleanup')}
            </h4>
            <SettingsControlGroup className='space-y-3'>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Delete usage logs older than the retention period once a day. Audit logs are never affected.'
                )}
              </p>
              <FormField
                control={form.control}
                name='logCleanupEnabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Enable automatic cleanup')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Requires a retention period of at least one day; a retention of 0 keeps automatic cleanup off.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </SettingsSwitchItem>
                )}
              />
              <FormField
                control={form.control}
                name='retentionDays'
                render={({ field }) => (
                  <div className='grid gap-1.5'>
                    <FormLabel className='text-xs'>
                      {t('Retention days')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        max={MAX_RETENTION_DAYS}
                        disabled={!autoCleanupEnabled}
                        value={field.value}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                        onBlur={field.onBlur}
                        className='w-[160px]'
                      />
                    </FormControl>
                    <FormMessage />
                  </div>
                )}
              />
            </SettingsControlGroup>
          </div>
        </SettingsForm>
      </Form>

      <Separator />

      <HistoryLogCleanup />

      <Separator />

      <ServerLogFiles />
    </SettingsSection>
  )
}
