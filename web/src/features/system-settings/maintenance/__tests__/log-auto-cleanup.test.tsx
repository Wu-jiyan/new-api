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
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { getCurrentLogCleanupTask } from '../../api'
import { SettingsPageProvider } from '../../components/settings-page-context'
import { LogSettingsSection } from '../log-settings-section'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  getCurrentLogCleanupTask: vi.fn(),
}))

function renderSection(
  overrides: { autoCleanupEnabled?: boolean; retentionDays?: number } = {}
) {
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
        <LogSettingsSection
          defaultEnabled={false}
          defaultAutoCleanupEnabled={overrides.autoCleanupEnabled ?? false}
          defaultRetentionDays={overrides.retentionDays ?? 0}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(getCurrentLogCleanupTask).mockResolvedValue({
    success: true,
    message: '',
    data: null,
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: null },
  })
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

it('keeps the retention field disabled until automatic cleanup is enabled', async () => {
  const user = userEvent.setup()
  renderSection({ retentionDays: 30 })

  const retention = screen.getByRole('spinbutton', { name: /Retention days/ })
  expect(retention).toBeDisabled()

  await user.click(
    screen.getByRole('switch', { name: /Enable automatic cleanup/ })
  )

  await waitFor(() => expect(retention).toBeEnabled())
})

it('saves the switch and the retention as separate log_cleanup options', async () => {
  const user = userEvent.setup()
  renderSection()

  await user.click(
    screen.getByRole('switch', { name: /Enable automatic cleanup/ })
  )
  const retention = await screen.findByRole('spinbutton', {
    name: /Retention days/,
  })
  await user.clear(retention)
  await user.type(retention, '45')
  await user.click(screen.getByRole('button', { name: /Save log settings/ }))

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'log_cleanup_setting.enabled',
      value: true,
    })
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'log_cleanup_setting.retention_days',
      value: '45',
    })
  })
})

it('refuses to save a retention beyond the supported range', async () => {
  const user = userEvent.setup()
  renderSection({ autoCleanupEnabled: true, retentionDays: 30 })

  const retention = screen.getByRole('spinbutton', { name: /Retention days/ })
  await user.clear(retention)
  await user.type(retention, '99999')
  await user.click(screen.getByRole('button', { name: /Save log settings/ }))

  expect(
    await screen.findByText('Retention cannot exceed 3650 days.')
  ).toBeVisible()
  expect(api.put).not.toHaveBeenCalled()
})
