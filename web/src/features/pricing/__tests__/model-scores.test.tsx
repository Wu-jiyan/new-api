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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'

import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { ModelCard } from '../components/model-card'
import { ModelDetailsContent } from '../components/model-details'
import { ModelScores } from '../components/model-scores'
import type { PricingModel } from '../types'

// The detail view pulls in the charting library through its performance tab;
// jsdom cannot load its ESM build, and the tab is never opened in these tests.
vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

/** AA Agentic is left unscored so the empty state stays observable. */
function scoredModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'scored-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ['default'],
    group_ratio: { default: 1 },
    rating: 'R',
    rating_score: 62,
    aa_intelligence_score: 58,
    aa_intelligence_rating: 'N',
    aa_coding_score: 71,
    aa_coding_rating: 'SR',
    aa_source: 'artificialanalysis',
    ...overrides,
  }
}

/** The label, the score and the row element for one dimension. */
function dimension(label: string) {
  const dt = screen.getByText(label)
  const row = dt.parentElement
  if (!row) throw new Error(`Missing score row for ${label}`)
  const score = row.querySelector('dd > span')
  if (!score) throw new Error(`Missing score for ${label}`)
  return { dt, score, row }
}

let queryClient: QueryClient
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
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
})
afterEach(() => {
  queryClient.clear()
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  vi.unstubAllGlobals()
  useSystemConfigStore.persist.setOptions({ storage: originalStorage })
})

describe('model score row', () => {
  it('shows every dimension with its own score and marks the unscored one', () => {
    render(<ModelScores model={scoredModel()} dimension='deepswe' />)

    expect(dimension('DeepSWE').score).toHaveTextContent('62')
    expect(dimension('AA Intelligence').score).toHaveTextContent('58')
    expect(dimension('AA Coding').score).toHaveTextContent('71')
    // 未评分不是隐藏，而是显示占位符，读者才知道「没有数据」而不是「分很低」
    expect(dimension('AA Agentic').score).toHaveTextContent('—')
    expect(dimension('AA Agentic').score).toHaveClass('text-muted-foreground')
  })

  it('colours each score by its own tier and greys the inactive labels', () => {
    render(<ModelScores model={scoredModel()} dimension='aa_coding' />)

    // 上色落在分数上：SR 紫、R 蓝、N 灰
    expect(dimension('AA Coding').score).toHaveClass('text-purple-600')
    expect(dimension('DeepSWE').score).toHaveClass('text-blue-600')
    expect(dimension('AA Intelligence').score).toHaveClass('text-slate-600')

    // 维度名只用正文色/弱化色区分当前维度，不参与档位配色
    expect(dimension('AA Coding').dt).toHaveClass('text-foreground')
    expect(dimension('DeepSWE').dt).toHaveClass('text-muted-foreground')
    expect(dimension('DeepSWE').dt).not.toHaveClass('text-blue-600')
  })

  it('renders plain text with nothing to click', () => {
    render(<ModelScores model={scoredModel()} dimension='deepswe' />)

    expect(screen.queryByRole('button')).toBeNull()
    // 维度切换由模型广场工具栏负责，这一行不再承担任何交互或额外提示
    expect(screen.getByText('AA Coding').closest('dl')).toBeVisible()
  })

  it('omits the tier badge inside the score row on the model square card', () => {
    render(
      <ModelCard
        model={scoredModel()}
        onClick={vi.fn()}
        dimension='aa_coding'
      />
    )

    // 卡片标题旁的档位角标保留；分数行本身保持纯文字，不给每格再加角标
    const scoreRow = document.querySelector('dl')
    if (!scoreRow) throw new Error('Missing score row')
    expect(within(scoreRow).queryByText('SR')).toBeNull()
    expect(within(scoreRow).queryByText('N')).toBeNull()
    // 分数行是纯文本，没有任何可点击元素
    expect(within(scoreRow).queryAllByRole('button')).toHaveLength(0)
  })
})

describe('model detail header', () => {
  it('shows the tier badge and follows the selected dimension', () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          summary: { avg_latency_ms: 900, success_rate: 99.5, avg_tps: 40 },
        },
      },
    })

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ModelDetailsContent
          model={scoredModel()}
          groupRatio={{ default: 1 }}
          usableGroup={{ default: { desc: 'Default', ratio: 1 } }}
          endpointMap={{}}
          autoGroups={[]}
          priceRate={1}
          usdExchangeRate={1}
          tokenUnit='M'
          dimension='aa_coding'
        />
      </QueryClientProvider>
    )

    // 标题旁的角标跟随当前维度：AA Coding 是 SR，DeepSWE 是 R
    const header = document.querySelector('header')
    if (!header) throw new Error('Missing model header')
    // 标题行是第一层 div；分数行 <dl> 是它的兄弟节点，各自的角标互不影响
    const titleRow = header.querySelector('div')
    if (!titleRow) throw new Error('Missing model title row')
    expect(within(titleRow).getByText('SR')).toBeVisible()

    rerender(
      <QueryClientProvider client={queryClient}>
        <ModelDetailsContent
          model={scoredModel()}
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

    expect(within(titleRow).getByText('R')).toBeVisible()
    expect(within(titleRow).queryByText('SR')).toBeNull()
  })
})
