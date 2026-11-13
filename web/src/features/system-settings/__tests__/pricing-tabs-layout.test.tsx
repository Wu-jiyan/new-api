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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPage } from '../components/settings-page'
import { RatioSettingsCard } from '../models/ratio-settings-card'
import type { ModelSettings } from '../types'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ section: 'models' }),
}))

vi.mock('../hooks/use-system-options', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-system-options')>()),
  useSystemOptions: () => ({
    data: { success: true, data: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

const modelDefaults = {
  ModelPrice: '{}',
  ModelRatio: '{}',
  CacheRatio: '{}',
  CreateCacheRatio: '{}',
  CompletionRatio: '{}',
  ImageRatio: '{}',
  AudioRatio: '{}',
  AudioCompletionRatio: '{}',
  ExposeRatioEnabled: false,
  BillingMode: '{}',
  BillingExpr: '{}',
  PluginBillingExpr: '{}',
}

const groupDefaults = {
  GroupRatio: '{}',
  TopupGroupRatio: '{}',
  UserUsableGroups: '{}',
  GroupGroupRatio: '{}',
  AutoGroups: '[]',
  MaxTokenAutoGroups: 5,
  DefaultUseAutoGroup: false,
  GroupSpecialUsableGroup: '{}',
  GroupForcedPrice: '{}',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pricing settings tabs', () => {
  it('scrolls the title row instead of clipping tabs beyond a narrow screen', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { entries: [], empty_version: 'v1', options: {} },
      },
    })
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    render(
      <QueryClientProvider client={client}>
        <SettingsPage
          routePath='/_authenticated/system-settings/models/$section'
          defaultSettings={{} as ModelSettings}
          defaultSection='models'
          getSectionMeta={() => ({ titleKey: 'Model prices' })}
          getSectionContent={() => (
            <RatioSettingsCard
              modelDefaults={modelDefaults}
              groupDefaults={groupDefaults}
              toolPricesDefault='{}'
            />
          )}
        />
      </QueryClientProvider>
    )

    const tabList = await screen.findByRole('tablist')
    expect(tabList.className).toContain('w-max')
    expect(tabList.className).not.toContain('max-w-full')

    // The strip keeps its intrinsic width, so the title row must be the
    // horizontal scroll container that keeps the last tab reachable.
    expect(tabList.parentElement?.className).toContain('overflow-x-auto')
  })
})
