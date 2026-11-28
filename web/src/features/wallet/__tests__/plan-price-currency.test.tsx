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
import { render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { SubscriptionPlansCard } from '../components/subscription-plans-card'

vi.mock('@/features/subscriptions/api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/subscriptions/api')>()
  return {
    ...actual,
    getPublicPlans: vi.fn(),
    getSelfSubscriptionFull: vi.fn(),
    updateBillingPreference: vi.fn(),
  }
})

const i18n = createInstance()

async function renderPlanCard() {
  const subscriptionsApi = await import('@/features/subscriptions/api')
  vi.mocked(subscriptionsApi.getPublicPlans).mockResolvedValue({
    success: true,
    data: [
      {
        plan: {
          id: 1,
          title: 'Pro',
          price_amount: 10,
          total_amount: 500000,
          duration_unit: 'month',
          duration_value: 1,
        },
      },
    ],
  } as never)
  vi.mocked(subscriptionsApi.getSelfSubscriptionFull).mockResolvedValue({
    success: true,
    data: { billing_preference: 'subscription_first' },
  } as never)

  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <SubscriptionPlansCard topupInfo={null} userQuota={0} />
      </I18nextProvider>
    </QueryClientProvider>
  )
  return screen.findByText('Pro')
}

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
})

afterEach(() => {
  useSystemConfigStore.setState((state) => ({
    config: { ...state.config, currency: { ...DEFAULT_CURRENCY_CONFIG } },
  }))
})

it('shows the plan price in the configured display currency, not a hardcoded dollar sign', async () => {
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      quotaDisplayType: 'CNY',
      usdExchangeRate: 7,
    },
  })

  await renderPlanCard()

  expect(screen.getByText('¥70')).toBeVisible()
  expect(screen.queryByText('$10.00')).toBeNull()
})

it('keeps the dollar sign when the display currency is USD', async () => {
  await renderPlanCard()

  expect(screen.getByText('$10')).toBeVisible()
})
