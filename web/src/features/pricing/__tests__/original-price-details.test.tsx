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
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'

import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { ModelDetailsContent } from '../components/model-details'
import {
  createOriginalPriceDisplay,
  type OriginalPriceContext,
} from '../lib/original-price'
import type { PricingModel } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

// model_ratio 1 prices input at 2 USD / 1M and output at 6 USD / 1M before the
// group ratio, and premium halves both.
function pricingModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'catalogue-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ['default', 'premium'],
    group_ratio: { default: 1, premium: 0.5 },
    original_price: { currency: 'USD', input: 2.5, output: 7.5 },
    ...overrides,
  }
}

const USD_DISPLAY = createOriginalPriceDisplay({
  quotaDisplayType: 'USD',
  usdExchangeRate: 7,
  customCurrencyExchangeRate: 0.9,
})

function originalPriceContext(): OriginalPriceContext {
  return { display: USD_DISPLAY, usdCnyRate: 7.2 }
}

function renderDetails(
  model: PricingModel,
  originalPrice?: OriginalPriceContext
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ModelDetailsContent
        model={model}
        groupRatio={model.group_ratio ?? {}}
        usableGroup={{
          default: { desc: 'Default', ratio: 1 },
          premium: { desc: 'Premium', ratio: 0.5 },
        }}
        endpointMap={{}}
        autoGroups={[]}
        priceRate={1}
        usdExchangeRate={1}
        tokenUnit='M'
        dimension='deepswe'
        originalPrice={originalPrice}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size
    },
  })
  useSystemConfigStore.persist.setOptions({
    storage: createJSONStorage(() => localStorage),
  })
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { summary: {} } },
  })
})

describe('model details original price', () => {
  it('lists the official price in the model currency with the discount', () => {
    renderDetails(
      pricingModel({
        enable_groups: ['default'],
        group_ratio: { default: 1 },
      }),
      originalPriceContext()
    )

    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Official price',
    })
    const section = heading.closest('section')
    if (!section) throw new Error('Missing original price section')

    expect(within(section).getByText('$2.5')).toBeVisible()
    expect(within(section).getByText('$7.5')).toBeVisible()
    // Every price type is 20% off, so the card states it without "from".
    expect(within(section).getByText('20% off')).toBeVisible()
  })

  it('shows each group its own discount and the best one in the section header', () => {
    renderDetails(pricingModel(), originalPriceContext())

    // default is 20% off, premium is 1 / 2.5 = 3 / 7.5 = 0.4, so 60% off.
    expect(screen.getByText('20% off')).toBeVisible()
    expect(screen.getByText('60% off')).toBeVisible()
    // The header and the official price card quote the deepest discount.
    expect(screen.getAllByText('From 60% off').length).toBeGreaterThanOrEqual(1)
    expect(
      screen.getByRole('columnheader', { name: 'Discount' })
    ).toBeInTheDocument()
  })

  it('shows each group its own discount on expression-priced group cards', () => {
    renderDetails(
      pricingModel({
        model_ratio: 0,
        completion_ratio: 0,
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("base", p * 2 + c * 8)',
        original_price: { currency: 'USD', input: 2.5, output: 10 },
      }),
      originalPriceContext()
    )

    // default: 2 / 2.5 = 8 / 10 = 0.8. premium: 0.5 x that = 0.4 → 60% off.
    // Each group card carries its own chip instead of only the section header.
    expect(screen.getByText('20% off')).toBeVisible()
    expect(screen.getByText('60% off')).toBeVisible()
  })

  it('hides every discount when the feature is off', () => {
    renderDetails(pricingModel())

    expect(
      screen.queryByRole('heading', { level: 2, name: 'Official price' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: 'Discount' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('20% off')).not.toBeInTheDocument()
  })
})
