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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCcw } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

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
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { syncOriginalPriceRate } from '../api'
import {
  SettingsControlGroup,
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import type { ModelSettings } from '../types'
import { safeNumberFieldProps } from '../utils/numeric-field'

/** Option keys this card may write. The synced rate below is read-only. */
type EditableOriginalPriceSettings = Pick<
  ModelSettings,
  | 'original_price_setting.enabled'
  | 'original_price_setting.show_by_default'
  | 'original_price_setting.sync_enabled'
  | 'original_price_setting.sync_base_url'
  | 'original_price_setting.sync_interval_hours'
>

/** Written by the sync service; the UI never sends these back. */
type SyncedRateSettings = Pick<
  ModelSettings,
  | 'original_price_rate.usd_cny_rate'
  | 'original_price_rate.updated_at'
  | 'original_price_rate.source'
  | 'original_price_rate.last_error'
>

type OriginalPriceSettingsCardProps = {
  defaultValues: EditableOriginalPriceSettings & SyncedRateSettings
}

/**
 * The schema keeps the dotted option keys inside a nested object so the
 * `FormField` names line up with react-hook-form paths; flat keys would make
 * react-hook-form maintain two parallel value trees and lose the input.
 */
const originalPriceSchema = z.object({
  original_price_setting: z.object({
    enabled: z.boolean(),
    show_by_default: z.boolean(),
    sync_enabled: z.boolean(),
    sync_base_url: z.string(),
    sync_interval_hours: z.number().int().min(1),
  }),
})

type OriginalPriceFormValues = z.infer<typeof originalPriceSchema>

const buildFormDefaults = (
  defaults: EditableOriginalPriceSettings
): OriginalPriceFormValues => ({
  original_price_setting: {
    enabled: defaults['original_price_setting.enabled'],
    show_by_default: defaults['original_price_setting.show_by_default'],
    sync_enabled: defaults['original_price_setting.sync_enabled'],
    sync_base_url: defaults['original_price_setting.sync_base_url'],
    sync_interval_hours: defaults['original_price_setting.sync_interval_hours'],
  },
})

const normalizeFormValues = (
  values: OriginalPriceFormValues
): EditableOriginalPriceSettings => ({
  'original_price_setting.enabled': values.original_price_setting.enabled,
  'original_price_setting.show_by_default':
    values.original_price_setting.show_by_default,
  'original_price_setting.sync_enabled':
    values.original_price_setting.sync_enabled,
  'original_price_setting.sync_base_url':
    values.original_price_setting.sync_base_url.trim(),
  'original_price_setting.sync_interval_hours':
    values.original_price_setting.sync_interval_hours,
})

export function OriginalPriceSettingsCard(
  props: OriginalPriceSettingsCardProps
) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const updateOption = useUpdateOption()
  const formDefaults = useMemo(
    () => buildFormDefaults(props.defaultValues),
    [props.defaultValues]
  )
  const form = useForm<OriginalPriceFormValues>({
    resolver: zodResolver(originalPriceSchema),
    defaultValues: formDefaults,
  })
  const baselineRef = useRef<EditableOriginalPriceSettings>(
    normalizeFormValues(formDefaults)
  )
  const baselineSerializedRef = useRef<string>(
    JSON.stringify(normalizeFormValues(formDefaults))
  )

  useEffect(() => {
    const normalized = normalizeFormValues(
      buildFormDefaults(props.defaultValues)
    )
    const serialized = JSON.stringify(normalized)
    if (serialized === baselineSerializedRef.current) return
    baselineRef.current = normalized
    baselineSerializedRef.current = serialized
    form.reset(buildFormDefaults(props.defaultValues))
  }, [props.defaultValues, form])

  const onSubmit = async (values: OriginalPriceFormValues) => {
    const normalized = normalizeFormValues(values)
    const changedKeys = (
      Object.keys(normalized) as Array<keyof EditableOriginalPriceSettings>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (changedKeys.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of changedKeys) {
      await updateOption.mutateAsync({ key, value: normalized[key] })
    }

    baselineRef.current = normalized
    baselineSerializedRef.current = JSON.stringify(normalized)
    form.reset(buildFormDefaults(normalized))
  }

  const syncRate = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => requireServerSuccess(await syncOriginalPriceRate()),
    onSuccess: async () => {
      // The synced rate lives in the option list; refetch it so the read-only
      // block shows the value the service just stored.
      await queryClient.invalidateQueries({ queryKey: ['system-options'] })
      toast.success(t('Exchange rate updated'))
    },
    onError: (error: Error) =>
      handleServerError(error, t('Failed to update the exchange rate')),
  })

  const syncEnabled = form.watch('original_price_setting.sync_enabled')
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const rate = props.defaultValues['original_price_rate.usd_cny_rate']
  const updatedAt = props.defaultValues['original_price_rate.updated_at']
  const source = props.defaultValues['original_price_rate.source']
  const lastError = props.defaultValues['original_price_rate.last_error']
  const hasRate = Number.isFinite(rate) && rate > 0
  const rateLabel = hasRate
    ? t('1 USD = {{rate}} CNY', {
        rate: new Intl.NumberFormat(locale, {
          maximumFractionDigits: 6,
        }).format(rate),
      })
    : t('No exchange rate synced yet')
  const updatedAtTime = updatedAt > 0 ? dayjs(updatedAt * 1000) : null
  const updatedAtLabel = updatedAtTime?.isValid()
    ? t('Last updated: {{time}}', {
        time: updatedAtTime.toDate().toLocaleString(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      })
    : t('Never synced')

  return (
    <SettingsSection title={t('Original price & exchange rate')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save original price settings'
          />
          <FormField
            control={form.control}
            name='original_price_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Show original price')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Master switch for the model square. When off, neither the original price nor the discount is shown.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <FormField
            control={form.control}
            name='original_price_setting.show_by_default'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Show by default')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Default state of the visitor-facing toggle in the model square.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <FormField
            control={form.control}
            name='original_price_setting.sync_enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Sync exchange rate')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Refresh the USD to CNY rate from the endpoint below at the configured interval.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <FormField
            control={form.control}
            name='original_price_setting.sync_base_url'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Rate source URL')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder='https://open.er-api.com/v6/latest'
                    disabled={!syncEnabled}
                    autoComplete='off'
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Endpoint that returns USD rates. The service calls it with /USD appended and expects a JSON object with rates.CNY. A CN mirror is available at https://er-api.25y.cn/v6/latest'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='original_price_setting.sync_interval_hours'
            render={({ field }) => (
              <FormItem className='max-w-xs'>
                <FormLabel>{t('Sync interval (hours)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={1}
                    step={1}
                    {...safeNumberFieldProps(field)}
                    disabled={!syncEnabled}
                  />
                </FormControl>
                <FormDescription>
                  {t('Whole hours, at least 1.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <SettingsControlGroup className='space-y-3'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='min-w-0 space-y-1'>
                <p className='text-sm font-medium'>{t('Synced rate')}</p>
                <p className='text-sm'>{rateLabel}</p>
                <p className='text-muted-foreground text-xs'>
                  {updatedAtLabel}
                </p>
                {source ? (
                  <p className='text-muted-foreground text-xs break-words'>
                    {t('Source')}: {source}
                  </p>
                ) : null}
                {lastError ? (
                  <p className='text-destructive text-xs break-words'>
                    {t('Last error')}: {lastError}
                  </p>
                ) : null}
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => syncRate.mutate()}
                disabled={syncRate.isPending}
              >
                {syncRate.isPending ? (
                  <Spinner data-icon='inline-start' aria-hidden='true' />
                ) : (
                  <RefreshCcw data-icon='inline-start' aria-hidden='true' />
                )}
                {t('Sync now')}
              </Button>
            </div>
          </SettingsControlGroup>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
