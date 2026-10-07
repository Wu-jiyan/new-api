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

import { AnnouncementsSection } from '../announcements-section'

const MARKED_ANNOUNCEMENTS = JSON.stringify([
  {
    id: 1,
    content: 'Older announcement',
    publishDate: '2026-01-01T00:00:00Z',
    type: 'default',
    popup: true,
  },
  {
    id: 2,
    content: 'Newer announcement',
    publishDate: '2026-02-01T00:00:00Z',
    type: 'default',
  },
])

function renderSection(props: { popupEnabled?: boolean; data?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <AnnouncementsSection
        enabled
        popupEnabled={props.popupEnabled ?? false}
        data={props.data ?? '[]'}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

it('saves the announcement popup switch as its own option', async () => {
  const user = userEvent.setup()
  renderSection()

  await user.click(screen.getByRole('switch', { name: 'Announcement popup' }))

  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'console_setting.announcement_popup_enabled',
      value: true,
    })
  )
})

it('keeps a single popup announcement when another one is marked', async () => {
  const user = userEvent.setup()
  renderSection({ popupEnabled: true, data: MARKED_ANNOUNCEMENTS })

  // Rows are listed newest first, so the unmarked announcement is the first row.
  await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
  await user.click(screen.getByRole('switch', { name: 'Display as popup' }))
  await user.click(screen.getByRole('button', { name: 'Update' }))
  await user.click(screen.getByRole('button', { name: 'Save Settings' }))

  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'console_setting.announcements',
      value: expect.any(String),
    })
  )
  const saved = vi
    .mocked(api.put)
    .mock.calls.map(([, body]) => body as { key: string; value: string })
    .findLast((body) => body.key === 'console_setting.announcements')
  expect(JSON.parse(saved?.value ?? '[]')).toEqual([
    expect.objectContaining({ id: 1, popup: false }),
    expect.objectContaining({ id: 2, popup: true }),
  ])
})
