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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ModelMutateDrawer } from '../components/drawers/model-mutate-drawer'
import type { Model } from '../types'

const model: Model = {
  id: 11,
  model_name: 'priced-model',
  description: 'Priced model',
  status: 1,
  sync_official: 1,
  name_rule: 0,
  endpoints: '',
  created_time: 1,
  updated_time: 1,
}

afterEach(() => {
  useAuthStore.getState().auth.reset()
})

function mockModelRequest(detail: Model) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === `/api/models/${detail.id}`) {
      return { data: { success: true, data: detail } }
    }
    if (url === '/api/vendors/') {
      return { data: { success: true, data: { items: [] } } }
    }
    return { data: { success: true, data: { items: [] } } }
  })
  return vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: detail } })
}

function renderDrawer(currentRow: Model) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ModelMutateDrawer open onOpenChange={() => {}} currentRow={currentRow} />
    </QueryClientProvider>
  )
  return client
}

describe('model original price', () => {
  it('keeps a configured original price and currency in the save payload', async () => {
    const priced: Model = {
      ...model,
      original_price_currency: 'USD',
      original_price_input: 1.5,
      original_price_output: 6,
      original_price_cache: 0.15,
      original_price_cache_write: 0.1875,
      original_price_request: 0.002,
    }
    const put = mockModelRequest(priced)
    const client = renderDrawer(priced)
    const user = userEvent.setup()

    expect(await screen.findByLabelText('Input price')).toHaveValue(1.5)
    expect(screen.getByLabelText('Output price')).toHaveValue(6)
    expect(screen.getByLabelText('Cache read price')).toHaveValue(0.15)
    expect(screen.getByLabelText('Cache write price')).toHaveValue(0.1875)
    expect(screen.getByLabelText('Per-request price')).toHaveValue(0.002)
    expect(
      screen.getByRole('combobox', { name: 'Original price currency' })
    ).toHaveValue('USD')

    await user.click(screen.getByRole('button', { name: 'Save metadata' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(put.mock.calls[0][1]).toMatchObject({
      original_price_currency: 'USD',
      original_price_input: 1.5,
      original_price_output: 6,
      original_price_cache: 0.15,
      original_price_cache_write: 0.1875,
      original_price_request: 0.002,
    })
    client.clear()
  })

  it('saves an emptied amount as zero instead of dropping it', async () => {
    const unpriced: Model = { ...model, original_price_currency: 'CNY' }
    const put = mockModelRequest(unpriced)
    const client = renderDrawer(unpriced)
    const user = userEvent.setup()

    const input = await screen.findByLabelText('Input price')
    expect(input).toHaveValue(0)
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: 'Save metadata' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(put.mock.calls[0][1]).toMatchObject({
      original_price_currency: 'CNY',
      original_price_input: 0,
      original_price_output: 0,
      original_price_cache: 0,
      original_price_cache_write: 0,
      original_price_request: 0,
    })
    client.clear()
  })

  it('disables the amount inputs while no currency is configured', async () => {
    const unconfigured: Model = { ...model }
    mockModelRequest(unconfigured)
    const client = renderDrawer(unconfigured)

    expect(await screen.findByLabelText('Input price')).toBeDisabled()
    expect(screen.getByLabelText('Per-request price')).toBeDisabled()
    expect(
      screen.getByRole('combobox', { name: 'Original price currency' })
    ).toHaveValue('Not configured')
    client.clear()
  })
})
