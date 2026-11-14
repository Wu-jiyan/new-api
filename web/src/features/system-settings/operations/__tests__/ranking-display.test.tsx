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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import type { UpdateOptionRequest } from '../../types'
import { RankingDisplaySection } from '../ranking-display-section'

function renderSection(enabled: boolean, multiplier: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  // The save button renders through a portal into the page-level actions bar,
  // so the section only exposes it when that container is provided.
  const actionsContainer = document.createElement('div')
  document.body.appendChild(actionsContainer)

  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actionsContainer}>
        <RankingDisplaySection
          defaultValues={{
            'ranking_display_setting.multiplier_enabled': enabled,
            'ranking_display_setting.multiplier': multiplier,
          }}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
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

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

describe('Rankings display multiplier', () => {
  it('keeps the multiplier read-only and shows the configured value while it is off', () => {
    renderSection(false, 9.8)

    const multiplier = screen.getByRole('spinbutton', { name: /Multiplier/ })
    expect(multiplier).toBeDisabled()
    expect(multiplier).toHaveValue(9.8)
  })

  it('enables the multiplier input when the multiplier is switched on', async () => {
    const user = userEvent.setup()
    renderSection(false, 1)

    const multiplier = screen.getByRole('spinbutton', { name: /Multiplier/ })
    expect(multiplier).toBeDisabled()

    await user.click(
      screen.getByRole('switch', { name: /Enable rankings multiplier/ })
    )

    await waitFor(() => expect(multiplier).toBeEnabled())
  })

  it('persists the switch before the multiplier when both change', async () => {
    const sent = recordOptionSaves()
    const user = userEvent.setup()
    renderSection(false, 1)

    await user.click(
      screen.getByRole('switch', { name: /Enable rankings multiplier/ })
    )
    fireEvent.change(screen.getByRole('spinbutton', { name: /Multiplier/ }), {
      target: { value: '9.8' },
    })
    await user.click(screen.getByRole('button', { name: /Save Changes/ }))

    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent).toEqual([
      { key: 'ranking_display_setting.multiplier_enabled', value: true },
      { key: 'ranking_display_setting.multiplier', value: 9.8 },
    ])
  })

  it('persists only the multiplier when the switch already matches', async () => {
    const sent = recordOptionSaves()
    const user = userEvent.setup()
    renderSection(true, 1)

    fireEvent.change(screen.getByRole('spinbutton', { name: /Multiplier/ }), {
      target: { value: '9.8' },
    })
    await user.click(screen.getByRole('button', { name: /Save Changes/ }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent).toEqual([
      { key: 'ranking_display_setting.multiplier', value: 9.8 },
    ])
  })

  it('reports no changes and saves nothing when the form was not edited', async () => {
    const infoToast = vi.spyOn(toast, 'info')
    const user = userEvent.setup()
    renderSection(true, 9.8)

    await user.click(screen.getByRole('button', { name: /Save Changes/ }))

    await waitFor(() =>
      expect(infoToast).toHaveBeenCalledWith('No changes to save')
    )
    expect(api.put).not.toHaveBeenCalled()
  })

  it('rejects a zero multiplier with a field error instead of saving it', async () => {
    const user = userEvent.setup()
    renderSection(true, 9.8)

    const multiplier = screen.getByRole('spinbutton', { name: /Multiplier/ })
    fireEvent.change(multiplier, { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: /Save Changes/ }))

    await waitFor(() =>
      expect(multiplier).toHaveAttribute('aria-invalid', 'true')
    )
    expect(screen.getByText('Multiplier must be greater than 0')).toBeVisible()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('keeps the last valid multiplier when the field is emptied instead of saving it', async () => {
    const user = userEvent.setup()
    renderSection(true, 9.8)

    const multiplier = screen.getByRole('spinbutton', { name: /Multiplier/ })
    fireEvent.change(multiplier, { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: /Save Changes/ }))

    expect(multiplier).toHaveValue(9.8)
    expect(api.put).not.toHaveBeenCalled()
  })
})
