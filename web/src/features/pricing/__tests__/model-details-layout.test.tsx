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
import type { PricingModel } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

function catalogueModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'catalogue-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ['default'],
    group_ratio: { default: 1 },
    context_length: 1_050_000,
    max_output_tokens: 65_540,
    input_modalities: ['text', 'image', 'audio', 'video'],
    output_modalities: ['text'],
    ...overrides,
  }
}

function renderDetails(model: PricingModel) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ModelDetailsContent
        model={model}
        groupRatio={{ default: 1 }}
        usableGroup={{ default: { desc: 'Default', ratio: 1 } }}
        endpointMap={{}}
        autoGroups={[]}
        priceRate={1}
        usdExchangeRate={1}
        tokenUnit='M'
        dimension='deepswe'
      />
    </QueryClientProvider>
  )
}

/** 能力/模态小节。价格卡片里也有 Input/Output 文案，所以查询必须限定范围。 */
function signalsSection() {
  const heading = screen.getByRole('heading', {
    level: 2,
    name: /Supported modalities/,
  })
  const section = heading.closest('section')
  if (!section) throw new Error('Missing capabilities section')
  return section
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
    data: {
      success: true,
      data: {
        summary: { avg_latency_ms: 900, success_rate: 99.5, avg_tps: 40 },
      },
    },
  })
})

describe('catalogue metadata layout', () => {
  // 抽屉和独立详情页都比视口窄得多：用 sm:/md: 这类视口断点排版时，容器再窄
  // 也会强行并成两列，把「输入」这类短标签挤成逐字竖排。这里锁定容器查询契约。
  it('lays the capability rows out with a container query, not a viewport breakpoint', () => {
    renderDetails(catalogueModel({ capabilities: ['reasoning', 'vision'] }))

    const label = within(signalsSection()).getByText('Input')
    const row = label.parentElement
    if (!row) throw new Error('Missing modality row')

    expect(row).toHaveClass('@md/details:grid-cols-[auto_minmax(0,1fr)]')
    expect(row.className).not.toMatch(/(^|\s)sm:/)
    expect(row.className).not.toMatch(/(^|\s)md:grid-cols/)
  })

  it('lets the modality value shrink and wrap instead of truncating it', () => {
    renderDetails(catalogueModel())

    const label = within(signalsSection()).getByText('Input')
    const value = label.nextElementSibling
    if (!value) throw new Error('Missing modality value cell')

    // 取值容器必须能缩到比内容更窄，内部的 flex-wrap 才有机会换成多行。
    expect(value).toHaveClass('min-w-0')
    expect(label.className).not.toContain('truncate')
  })

  it('does not reserve an empty column when a model lists no capabilities', () => {
    renderDetails(catalogueModel({ capabilities: undefined }))

    expect(
      screen.getByRole('heading', { level: 2, name: 'Supported modalities' })
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { level: 2, name: /Capabilities/ })
    ).not.toBeInTheDocument()
    // 两个方向各自成行，没有被空占位符顶到第二列。
    expect(within(signalsSection()).getByText('Input')).toBeVisible()
    expect(within(signalsSection()).getByText('Output')).toBeVisible()
  })

  // 快照条每格宽度有限，模态列表用截断会切出半个字；这里锁定换行策略。
  it('wraps the modality summary in the quick stats bar instead of clipping it', () => {
    renderDetails(catalogueModel())

    // 结构是 <div cell><span 标签行><span 文本>…</span></span><span 取值>…
    const labelText = screen.getByText('Modalities')
    const value = labelText.parentElement?.nextElementSibling
    if (!value) throw new Error('Missing quick stat value')

    expect(value).toHaveClass('flex-wrap')
    expect(value.className).not.toContain('truncate')
  })
})
