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
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { ModelCard } from '../components/model-card'
import {
  createOriginalPriceDisplay,
  type OriginalPriceContext,
} from '../lib/original-price'
import type { PricingModel } from '../types'

// model_ratio 1 prices input at 2 USD / 1M and output at 6 USD / 1M.
function pricingModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'example-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ['default'],
    group_ratio: { default: 1 },
    ...overrides,
  }
}

const USD_DISPLAY = createOriginalPriceDisplay({
  quotaDisplayType: 'USD',
  usdExchangeRate: 7,
  customCurrencyExchangeRate: 0.9,
})

function originalPriceContext(): OriginalPriceContext {
  return { display: USD_DISPLAY, usdCnyRate: 7.2, groupRatio: { default: 1 } }
}

const originalStorage = useSystemConfigStore.persist.getOptions().storage

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
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
})

afterEach(() => {
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  vi.unstubAllGlobals()
  useSystemConfigStore.persist.setOptions({ storage: originalStorage })
})

describe('model card original price', () => {
  it('shows the discount and the official price when the visitor asked for it', () => {
    render(
      <ModelCard
        model={pricingModel({
          original_price: { currency: 'USD', input: 2.5, output: 7.5 },
        })}
        onClick={vi.fn()}
        originalPrice={originalPriceContext()}
      />
    )

    // 2 / 2.5 = 6 / 7.5 = 0.8, so every price type agrees on 20% off.
    expect(screen.getByText('20% off')).toBeVisible()
    expect(screen.getByText(/Official price/)).toBeVisible()
    expect(screen.getByText(/\$2\.5 \/ \$7\.5/)).toBeVisible()
  })

  it('says the discount starts at a value when the price types differ', () => {
    render(
      <ModelCard
        model={pricingModel({
          original_price: { currency: 'USD', input: 2.5, output: 8 },
        })}
        onClick={vi.fn()}
        originalPrice={originalPriceContext()}
      />
    )

    // Input is 20% off and output 25% off, so the card quotes the deeper one.
    expect(screen.getByText('From 25% off')).toBeVisible()
  })

  it('renders nothing when the feature is off', () => {
    render(
      <ModelCard
        model={pricingModel({
          original_price: { currency: 'USD', input: 2.5, output: 7.5 },
        })}
        onClick={vi.fn()}
      />
    )

    expect(screen.queryByText('20% off')).not.toBeInTheDocument()
    expect(screen.queryByText(/Official price/)).not.toBeInTheDocument()
  })

  it('renders nothing when the model has no original price', () => {
    render(
      <ModelCard
        model={pricingModel()}
        onClick={vi.fn()}
        originalPrice={originalPriceContext()}
      />
    )

    expect(screen.queryByText(/Official price/)).not.toBeInTheDocument()
  })
})
