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
import { useEffect, useMemo, useRef } from 'react'
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
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

type Translate = (key: string, options?: Record<string, unknown>) => string

const createRankingDisplaySchema = (t: Translate) =>
  z.object({
    ranking_display_setting: z.object({
      multiplier_enabled: z.boolean(),
      multiplier: z.coerce
        .number()
        .gt(0, t('Multiplier must be greater than 0'))
        .max(1000, t('Multiplier must be at most 1000')),
    }),
  })

type RankingDisplayFormInput = z.input<
  ReturnType<typeof createRankingDisplaySchema>
>
type RankingDisplayFormValues = z.output<
  ReturnType<typeof createRankingDisplaySchema>
>

type FlatRankingDisplayDefaults = {
  'ranking_display_setting.multiplier_enabled': boolean
  'ranking_display_setting.multiplier': number
}

type RankingDisplaySectionProps = {
  defaultValues: FlatRankingDisplayDefaults
}

const buildFormDefaults = (
  defaults: RankingDisplaySectionProps['defaultValues']
): RankingDisplayFormInput => ({
  ranking_display_setting: {
    multiplier_enabled: defaults['ranking_display_setting.multiplier_enabled'],
    multiplier: defaults['ranking_display_setting.multiplier'],
  },
})

const normalizeDefaults = (
  defaults: RankingDisplaySectionProps['defaultValues']
): FlatRankingDisplayDefaults => ({
  'ranking_display_setting.multiplier_enabled':
    defaults['ranking_display_setting.multiplier_enabled'],
  'ranking_display_setting.multiplier':
    defaults['ranking_display_setting.multiplier'],
})

const normalizeFormValues = (
  values: RankingDisplayFormValues
): FlatRankingDisplayDefaults => ({
  'ranking_display_setting.multiplier_enabled':
    values.ranking_display_setting.multiplier_enabled,
  'ranking_display_setting.multiplier':
    values.ranking_display_setting.multiplier,
})

export function RankingDisplaySection({
  defaultValues,
}: RankingDisplaySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<FlatRankingDisplayDefaults>(
    normalizeDefaults(defaultValues)
  )
  const baselineSerializedRef = useRef<string>(
    JSON.stringify(normalizeDefaults(defaultValues))
  )

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )
  const schema = useMemo(() => createRankingDisplaySchema(t), [t])

  const form = useForm<
    RankingDisplayFormInput,
    unknown,
    RankingDisplayFormValues
  >({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  useEffect(() => {
    const normalized = normalizeDefaults(defaultValues)
    const serialized = JSON.stringify(normalized)
    if (serialized === baselineSerializedRef.current) return
    baselineRef.current = normalized
    baselineSerializedRef.current = serialized
  }, [defaultValues])

  const multiplierEnabled = form.watch(
    'ranking_display_setting.multiplier_enabled'
  )

  const onSubmit = async (values: RankingDisplayFormValues) => {
    const normalized = normalizeFormValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof FlatRankingDisplayDefaults>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({
        key,
        value: normalized[key],
      })
    }

    baselineRef.current = normalized
    baselineSerializedRef.current = JSON.stringify(normalized)
  }

  return (
    <SettingsSection title={t('Rankings display')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Scales the token volumes shown on the public rankings page. Billing, logs and every other figure keep the real values.'
            )}
          </p>

          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='ranking_display_setting.multiplier_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable rankings multiplier')}</FormLabel>
                    <FormDescription>
                      {t('Off shows the real token volumes')}
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
              name='ranking_display_setting.multiplier'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Multiplier')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0.1}
                      max={1000}
                      step={0.1}
                      placeholder='9.8'
                      {...safeNumberFieldProps(field)}
                      disabled={!multiplierEnabled}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('For example 9.8 shows 9.8 times the real volume')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
