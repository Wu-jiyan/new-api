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

/** Only AA Agentic is left unscored so the empty state stays observable. */
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

/** The block wrapping a dimension label, whether it renders as a button or a div. */
function dimensionBlock(label: string): HTMLElement {
  const block = screen.getByText(label).parentElement
  if (!block) throw new Error(`Missing score block for ${label}`)
  return block
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
  it('shows a score for every scored dimension and an empty marker for the unscored one', () => {
    render(<ModelScores model={scoredModel()} dimension='deepswe' />)

    expect(within(dimensionBlock('DeepSWE')).getByText('62')).toBeVisible()
    expect(
      within(dimensionBlock('AA Intelligence')).getByText('58')
    ).toBeVisible()
    expect(within(dimensionBlock('AA Coding')).getByText('71')).toBeVisible()
    expect(within(dimensionBlock('AA Agentic')).getByText('—')).toBeVisible()
  })

  it('colours each dimension label with the colour of its own tier', () => {
    render(<ModelScores model={scoredModel()} dimension='deepswe' />)

    expect(screen.getByText('DeepSWE')).toHaveClass('text-blue-600')
    expect(screen.getByText('AA Intelligence')).toHaveClass('text-slate-600')
    expect(screen.getByText('AA Coding')).toHaveClass('text-purple-600')
    expect(screen.getByText('AA Agentic')).toHaveClass('text-muted-foreground')
  })

  it('renders read-only blocks without buttons or an interaction hint', () => {
    render(<ModelScores model={scoredModel()} dimension='deepswe' />)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(
      screen.queryByText('Click a score to switch dimension')
    ).not.toBeInTheDocument()
    expect(dimensionBlock('DeepSWE')).toHaveAttribute('aria-current', 'true')
    expect(dimensionBlock('AA Coding')).not.toHaveAttribute('aria-current')
  })

  it('disables the dimensions that have no score when the row is interactive', () => {
    render(
      <ModelScores
        model={scoredModel()}
        dimension='deepswe'
        onDimensionChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /AA Agentic/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /AA Coding/ })).toBeEnabled()
  })

  it('reports the clicked dimension and keeps the active one exposed as pressed', async () => {
    const user = userEvent.setup()
    const onDimensionChange = vi.fn()
    render(
      <ModelScores
        model={scoredModel()}
        dimension='deepswe'
        onDimensionChange={onDimensionChange}
      />
    )

    await user.click(screen.getByRole('button', { name: /AA Coding/ }))

    expect(onDimensionChange).toHaveBeenCalledWith('aa_coding')
    expect(screen.getByRole('button', { name: /DeepSWE/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /AA Coding/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByText('Click a score to switch dimension')).toBeVisible()
  })

  it('names each score button with its dimension, score and tier', () => {
    render(
      <ModelScores
        model={scoredModel()}
        dimension='deepswe'
        onDimensionChange={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /AA Coding.*71.*SR/ })
    ).toBeVisible()
  })

  it('switches the dimension when a score block is activated from the keyboard', async () => {
    const user = userEvent.setup()
    const onDimensionChange = vi.fn()
    render(
      <ModelScores
        model={scoredModel()}
        dimension='deepswe'
        onDimensionChange={onDimensionChange}
      />
    )

    screen.getByRole('button', { name: /AA Intelligence/ }).focus()

    await user.keyboard('{Enter}')
    expect(onDimensionChange).toHaveBeenCalledWith('aa_intelligence')
  })

  it('keeps the model card closed when a score block inside it is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onDimensionChange = vi.fn()
    render(
      <ModelCard
        model={scoredModel()}
        onClick={onClick}
        dimension='deepswe'
        onDimensionChange={onDimensionChange}
      />
    )

    await user.click(screen.getByRole('button', { name: /AA Coding/ }))

    expect(onDimensionChange).toHaveBeenCalledWith('aa_coding')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('follows the dimension prop for the detail header badge and the highlighted score', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          summary: { avg_latency_ms: 900, success_rate: 99.5, avg_tps: 40 },
        },
      },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ModelDetailsContent
          model={scoredModel()}
          groupRatio={{ default: 1 }}
          usableGroup={{ default: { desc: 'Default', ratio: 1 } }}
          endpointMap={{}}
          autoGroups={['default']}
          priceRate={1}
          usdExchangeRate={1}
          tokenUnit='M'
          dimension='aa_coding'
          onDimensionChange={vi.fn()}
        />
      </QueryClientProvider>
    )
    // Settles the header's performance query so no update lands after the test.
    await screen.findByText('99.50%')

    const titleRow = screen.getByRole('heading', {
      name: 'scored-model',
    }).parentElement
    if (!titleRow) throw new Error('Missing model header title row')
    expect(within(titleRow).getByText('SR')).toBeVisible()
    expect(within(titleRow).queryByText('R')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AA Coding/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /DeepSWE/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })
})
