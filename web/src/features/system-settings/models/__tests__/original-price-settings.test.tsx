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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { useSystemOptions } from '../../hooks/use-system-options'
import { OriginalPriceSettingsCard } from '../original-price-settings-card'

const defaults = {
  'original_price_setting.enabled': true,
  'original_price_setting.show_by_default': true,
  'original_price_setting.sync_enabled': true,
  'original_price_setting.sync_base_url': 'https://open.er-api.com/v6/latest',
  'original_price_setting.sync_interval_hours': 1,
  'original_price_rate.usd_cny_rate': 7.1234,
  'original_price_rate.updated_at': 1761292800,
  'original_price_rate.source': 'open.er-api.com',
  'original_price_rate.last_error': '',
}

type Defaults = typeof defaults

/**
 * Mirrors how the settings page reads the option list, so a test can prove the
 * card refetches it after a manual sync.
 */
function OptionsProbe() {
  const options = useSystemOptions()
  return (
    <span data-testid='options-state'>{options.data ? 'loaded' : 'idle'}</span>
  )
}

function Fixture(props: { overrides: Partial<Defaults> }) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  return (
    <SettingsPageProvider actionsContainer={actions}>
      <div ref={setActions} />
      <OptionsProbe />
      <OriginalPriceSettingsCard
        defaultValues={{ ...defaults, ...props.overrides }}
      />
    </SettingsPageProvider>
  )
}

function renderCard(overrides: Partial<Defaults> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Fixture overrides={overrides} />
    </QueryClientProvider>
  )
  return client
}

function mockOptionsRequest() {
  return vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, message: '', data: [] },
  })
}

describe('original price settings', () => {
  it('renders the synced rate and refetches options after a manual sync', async () => {
    const get = mockOptionsRequest()
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          usd_cny_rate: 7.2345,
          updated_at: 1761296400,
          source: 'open.er-api.com',
        },
      },
    })
    const client = renderCard()
    const user = userEvent.setup()

    expect(await screen.findByText('1 USD = 7.1234 CNY')).toBeVisible()
    expect(screen.getByText(/Last updated:/)).toBeVisible()
    expect(screen.getByText(/open\.er-api\.com/)).toBeVisible()
    await waitFor(() =>
      expect(screen.getByTestId('options-state')).toHaveTextContent('loaded')
    )
    const optionLoads = () =>
      get.mock.calls.filter(([url]) => url === '/api/option/').length
    const before = optionLoads()

    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/option/original_price/sync', {})
    )
    await waitFor(() => expect(optionLoads()).toBeGreaterThan(before))
    client.clear()
  })

  it('writes the master switch option key when the card is saved', async () => {
    mockOptionsRequest()
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true, message: '' } })
    const client = renderCard()
    const user = userEvent.setup()

    const toggle = screen.getByRole('switch', { name: 'Show official price' })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    await user.click(
      screen.getByRole('button', { name: 'Save official price settings' })
    )
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'original_price_setting.enabled',
      value: false,
    })
    client.clear()
  })

  it('saves the edited base URL without writing the synced rate keys', async () => {
    mockOptionsRequest()
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true, message: '' } })
    const client = renderCard()
    const user = userEvent.setup()

    const baseUrl = screen.getByLabelText('Rate source URL')
    await user.clear(baseUrl)
    await user.type(baseUrl, 'https://er-api.25y.cn/v6/latest')
    await user.click(
      screen.getByRole('button', { name: 'Save official price settings' })
    )
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'original_price_setting.sync_base_url',
      value: 'https://er-api.25y.cn/v6/latest',
    })
    expect(
      put.mock.calls.some(([, body]) =>
        String((body as { key?: string }).key).startsWith(
          'original_price_rate.'
        )
      )
    ).toBe(false)
    client.clear()
  })

  it('never saves a cleared interval as zero hours', async () => {
    mockOptionsRequest()
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true, message: '' } })
    const client = renderCard()
    const user = userEvent.setup()

    const baseUrl = screen.getByLabelText('Rate source URL')
    await user.clear(baseUrl)
    await user.type(baseUrl, 'https://mirror.example/v6/latest')
    await user.clear(screen.getByLabelText('Sync interval (hours)'))
    await user.click(
      screen.getByRole('button', { name: 'Save official price settings' })
    )
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    // The cleared field keeps the previous whole hour, so no interval write
    // (and certainly no zero) reaches the option API.
    expect(put.mock.calls[0][1]).toEqual({
      key: 'original_price_setting.sync_base_url',
      value: 'https://mirror.example/v6/latest',
    })
    client.clear()
  })

  it('shows the last sync error when the service recorded one', () => {
    mockOptionsRequest()
    const client = renderCard({
      'original_price_rate.last_error': 'rates.CNY is missing',
    })

    expect(screen.getByText(/Last error: rates\.CNY is missing/)).toBeVisible()
    client.clear()
  })
})
