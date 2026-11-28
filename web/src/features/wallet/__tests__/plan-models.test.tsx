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
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

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

const PLAN_MODELS = ['model-alpha', 'model-beta', 'model-gamma']

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
          available_models: PLAN_MODELS,
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

it('previews only the first two models and counts the rest', async () => {
  await renderPlanCard()

  const row = screen.getByRole('button', { name: '查看全部可用模型' })
  expect(row).toHaveTextContent('model-alpha、model-beta +1')
  expect(within(row).queryByText('model-gamma')).toBeNull()
})

it('opens the full model list when the row is clicked', async () => {
  const user = userEvent.setup()
  await renderPlanCard()

  await user.click(screen.getByRole('button', { name: '查看全部可用模型' }))

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('3 个模型可消耗此套餐')).toBeVisible()
  for (const modelName of PLAN_MODELS) {
    expect(within(dialog).getByText(modelName)).toBeVisible()
  }
})
