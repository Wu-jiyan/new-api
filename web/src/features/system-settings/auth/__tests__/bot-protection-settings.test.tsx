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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance, type i18n } from 'i18next'
import { useState, type ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import type { UpdateOptionRequest } from '../../types'
import { BotProtectionSection } from '../bot-protection-section'

const defaults: ComponentProps<typeof BotProtectionSection>['defaultValues'] = {
  TurnstileCheckEnabled: false,
  TurnstileSiteKey: '',
  TurnstileSecretKey: '',
  GeeTestCheckEnabled: false,
  GeeTestCaptchaId: '',
  GeeTestCaptchaKey: '',
  CorptchaCheckEnabled: false,
  CorptchaSiteId: '',
  CorptchaSecret: '',
  CaptchaLoginEnabled: false,
  CaptchaRegisterEnabled: false,
  CaptchaResetEnabled: false,
}

// A channel already protected by Turnstile. Switching to another provider must
// not disable it from the client: the backend closes the previous provider only
// after the new one is enabled, so a failed switch leaves login protected.
const turnstileEnabled: Partial<typeof defaults> = {
  TurnstileCheckEnabled: true,
  TurnstileSiteKey: 'site-key',
  TurnstileSecretKey: 'secret-key',
}

let testI18n: i18n

// JSDOM does not implement the pointer-capture API the select trigger uses.
const pointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'setPointerCapture'
)

function Fixture(props: { values?: Partial<typeof defaults> }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  )

  return (
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={client}>
        <div ref={setContainer} />
        <SettingsPageProvider actionsContainer={container}>
          <BotProtectionSection
            defaultValues={{ ...defaults, ...props.values }}
          />
        </SettingsPageProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

async function renderSettings(values?: Partial<typeof defaults>) {
  const route = createRootRoute({
    component: () => <Fixture values={values} />,
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

/** Records every option the section persists, in call order. */
function recordOptionSaves(): UpdateOptionRequest[] {
  const sent: UpdateOptionRequest[] = []
  vi.spyOn(api, 'put').mockImplementation(async (_url, body) => {
    sent.push(body as UpdateOptionRequest)
    return { data: { success: true, message: '' } } as never
  })
  return sent
}

beforeEach(async () => {
  testI18n = createInstance()
  await testI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} }, zh },
    interpolation: { escapeValue: false },
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  })
})

afterEach(() => {
  if (pointerCapture) {
    Object.defineProperty(
      HTMLElement.prototype,
      'setPointerCapture',
      pointerCapture
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  }
})

describe('Bot Protection provider saves', () => {
  it('persists the provider keys before the enable flag when Turnstile is enabled', async () => {
    const sent = recordOptionSaves()
    const user = userEvent.setup()
    await renderSettings()
    await user.click(screen.getByRole('combobox'))
    await user.click(
      await screen.findByRole('option', { name: 'Cloudflare Turnstile' })
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Site Key' }),
      'site-key'
    )
    await user.type(screen.getByLabelText('Secret Key'), 'secret-key')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(sent).toHaveLength(3))
    expect(sent).toEqual([
      { key: 'TurnstileSiteKey', value: 'site-key' },
      { key: 'TurnstileSecretKey', value: 'secret-key' },
      { key: 'TurnstileCheckEnabled', value: true },
    ])
  })

  it('enables the target provider before the previous one is disabled when switching providers', async () => {
    const sent = recordOptionSaves()
    const user = userEvent.setup()
    await renderSettings(turnstileEnabled)
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'GeeTest' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Captcha ID' }),
      'geetest-id'
    )
    await user.type(screen.getByLabelText('Captcha Key'), 'geetest-key')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(sent).toHaveLength(3))
    expect(sent).toEqual([
      { key: 'GeeTestCaptchaId', value: 'geetest-id' },
      { key: 'GeeTestCaptchaKey', value: 'geetest-key' },
      { key: 'GeeTestCheckEnabled', value: true },
    ])
    // The previous provider stays enabled until the backend confirms the new
    // one, so the client never sends its disable flag in the same save.
    expect(sent.map((option) => option.key)).not.toContain(
      'TurnstileCheckEnabled'
    )
  })

  it('disables the running provider when protection is switched off', async () => {
    const sent = recordOptionSaves()
    const user = userEvent.setup()
    await renderSettings(turnstileEnabled)
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Disabled' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent).toEqual([{ key: 'TurnstileCheckEnabled', value: false }])
  })

  it('saves nothing when the form was not edited', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: true, message: '' },
    } as never)
    const infoToast = vi.spyOn(toast, 'info')
    const user = userEvent.setup()
    await renderSettings(turnstileEnabled)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(infoToast).toHaveBeenCalledWith('No changes to save')
    )
    expect(put).not.toHaveBeenCalled()
  })
})
