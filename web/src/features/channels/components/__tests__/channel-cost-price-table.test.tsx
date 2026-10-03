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
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, describe, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'

import { ChannelCostPriceTable } from '../drawers/sections/channel-cost-price-table'

type Prices = Parameters<typeof ChannelCostPriceTable>[0]['prices']

let i18n: ReturnType<typeof createInstance>

beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en }, keySeparator: false })
})

/** Stateful host so edits flow back through onChange like the real drawer. */
function Host(props: { initial: Prices; onPrices: (next: Prices) => void }) {
  const [prices, setPrices] = useState(props.initial)
  return (
    <I18nextProvider i18n={i18n}>
      <ChannelCostPriceTable
        prices={prices}
        onChange={(next) => {
          setPrices(next)
          props.onPrices(next)
        }}
      />
    </I18nextProvider>
  )
}

describe('ChannelCostPriceTable', () => {
  test('shows synced cache and create-cache ratios as editable inputs', async () => {
    const onPrices = vi.fn()
    render(
      <Host
        initial={{
          'deepseek-v4-flash': {
            model_ratio: 1.5,
            completion_ratio: 3,
            cache_ratio: 0.05,
            create_cache_ratio: 1.25,
          },
        }}
        onPrices={onPrices}
      />
    )

    const cache = screen.getByLabelText(
      'deepseek-v4-flash Cache Ratio'
    ) as HTMLInputElement
    const createCache = screen.getByLabelText(
      'deepseek-v4-flash Create Cache Ratio'
    ) as HTMLInputElement

    expect(cache.value).toBe('0.05')
    expect(createCache.value).toBe('1.25')
  })

  test('reports an edited cache ratio to the host', async () => {
    const onPrices = vi.fn()
    render(
      <Host
        initial={{ 'deepseek-v4-flash': { model_ratio: 1.5, cache_ratio: 0.05 } }}
        onPrices={onPrices}
      />
    )

    await userEvent.clear(
      screen.getByLabelText('deepseek-v4-flash Cache Ratio')
    )
    await userEvent.type(
      screen.getByLabelText('deepseek-v4-flash Cache Ratio'),
      '0.2'
    )

    expect(onPrices).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'deepseek-v4-flash': expect.objectContaining({ cache_ratio: 0.2 }),
      })
    )
  })

  test('renders an upstream free entry as free instead of a fallback', () => {
    render(
      <Host
        initial={{ 'space-bunny-free': { free: true, model_ratio: 0 } }}
        onPrices={vi.fn()}
      />
    )

    // Rendered in both the type badge and the price cell.
    expect(screen.getAllByText('Free of charge').length).toBeGreaterThan(0)
    expect(
      screen.queryByText('Fallback to global price')
    ).not.toBeInTheDocument()
  })

  test('disables ratio inputs for a free entry', () => {
    render(
      <Host
        initial={{ 'space-bunny-free': { free: true, model_ratio: 0 } }}
        onPrices={vi.fn()}
      />
    )

    expect(
      screen.getByLabelText('space-bunny-free Cache Ratio')
    ).toBeDisabled()
  })

  test('adds a free entry when only the free checkbox is set', async () => {
    const onPrices = vi.fn()
    render(<Host initial={{}} onPrices={onPrices} />)

    await userEvent.type(screen.getByPlaceholderText('Model name'), 'new-free')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onPrices).toHaveBeenLastCalledWith({
      'new-free': { free: true, model_price: 0, model_ratio: 0 },
    })
  })

  test('renders a synced expression entry as expression, not fallback', () => {
    render(
      <Host
        initial={{
          'deepseek-v4.1-flash': {
            billing_expr: 'tier("base", p * 1 + c * 4)',
          },
        }}
        onPrices={vi.fn()}
      />
    )

    // Rendered in both the type badge and the price cell.
    expect(screen.getAllByText('Expression').length).toBeGreaterThan(0)
    expect(
      screen.queryByText('Fallback to global price')
    ).not.toBeInTheDocument()
  })

  test('disables ratio inputs for an expression entry', () => {
    render(
      <Host
        initial={{
          'deepseek-v4.1-flash': {
            billing_expr: 'tier("base", p * 1 + c * 4)',
          },
        }}
        onPrices={vi.fn()}
      />
    )

    expect(
      screen.getByLabelText('deepseek-v4.1-flash Completion Ratio')
    ).toBeDisabled()
  })

  test('shows the synced expression and reports edits to it', async () => {
    const onPrices = vi.fn()
    render(
      <Host
        initial={{
          'deepseek-v4.1-flash': {
            billing_expr: 'tier("base", p * 1)',
          },
        }}
        onPrices={onPrices}
      />
    )

    // The expression must be visible and editable, not hidden behind a badge.
    const field = screen.getByLabelText(
      'deepseek-v4.1-flash Billing expression'
    ) as HTMLInputElement
    expect(field.value).toBe('tier("base", p * 1)')

    await userEvent.clear(field)
    await userEvent.type(field, 'tier("base", p * 2)')

    expect(onPrices).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'deepseek-v4.1-flash': expect.objectContaining({
          billing_expr: 'tier("base", p * 2)',
        }),
      })
    )
  })

  test('adds an expression entry and ignores the numeric inputs', async () => {
    const onPrices = vi.fn()
    render(<Host initial={{}} onPrices={onPrices} />)

    await userEvent.type(
      screen.getByPlaceholderText('Model name'),
      'deepseek-v4.1-flash'
    )
    // A ratio is typed first to prove the expression wins over it.
    await userEvent.type(screen.getByPlaceholderText('Model Ratio'), '1.5')
    await userEvent.type(
      screen.getByLabelText('Billing expression'),
      'tier("base", p * 1 + c * 4)'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onPrices).toHaveBeenLastCalledWith({
      'deepseek-v4.1-flash': { billing_expr: 'tier("base", p * 1 + c * 4)' },
    })
  })
})
