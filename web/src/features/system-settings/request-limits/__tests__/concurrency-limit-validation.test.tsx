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
import { describe, expect, test } from 'vitest'

import { RateLimitSection } from '../rate-limit-section'

const DEFAULT_VALUES = {
  ModelRequestRateLimitEnabled: false,
  ModelRequestRateLimitDurationMinutes: 1,
  ModelRequestRateLimitCount: 0,
  ModelRequestRateLimitSuccessCount: 1000,
  ModelRequestRateLimitGroup: '',
  ModelRequestConcurrencyLimitEnabled: false,
  ModelRequestConcurrencyLimit: 0,
  ModelRequestConcurrencyLimitGroup: '',
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RateLimitSection defaultValues={DEFAULT_VALUES} />
    </QueryClientProvider>
  )
  return queryClient
}

describe('per-user concurrency settings', () => {
  test('renders the concurrency switch, cap, and group overrides', () => {
    const queryClient = renderSection()

    expect(
      screen.getByRole('switch', { name: 'Enable per-user concurrency limit' })
    ).not.toBeChecked()
    expect(
      screen.getByRole('spinbutton', {
        name: 'Max concurrent requests per user',
      })
    ).toHaveValue(0)
    expect(
      screen.getByRole('textbox', { name: 'Group concurrency overrides' })
    ).toBeInTheDocument()

    queryClient.clear()
  })

  test('accepts 0 as unlimited and rejects a negative cap', async () => {
    const queryClient = renderSection()
    const capInput = screen.getByRole('spinbutton', {
      name: 'Max concurrent requests per user',
    })

    fireEvent.change(capInput, { target: { value: '0' } })
    await waitFor(() =>
      expect(capInput).toHaveAttribute('aria-invalid', 'false')
    )

    fireEvent.change(capInput, { target: { value: '-1' } })
    await waitFor(() =>
      expect(capInput).toHaveAttribute('aria-invalid', 'true')
    )

    queryClient.clear()
  })

  test('rejects group overrides that are not non-negative integers', async () => {
    const queryClient = renderSection()
    const editor = screen.getByRole('textbox', {
      name: 'Group concurrency overrides',
    })

    fireEvent.input(editor, { target: { value: '{"default": -1}' } })
    expect(
      await screen.findByText(
        'Invalid JSON format or values out of allowed range'
      )
    ).toBeInTheDocument()
    expect(editor).toHaveAttribute('aria-invalid', 'true')

    fireEvent.input(editor, { target: { value: '{"default": 8, "vip": 32}' } })
    await waitFor(() =>
      expect(
        screen.queryByText('Invalid JSON format or values out of allowed range')
      ).not.toBeInTheDocument()
    )
    expect(editor).not.toHaveAttribute('aria-invalid')

    queryClient.clear()
  })
})
