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
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PricingToolbar,
  type PricingToolbarProps,
} from '../components/pricing-toolbar'
import { useOriginalPriceToggle } from '../hooks/use-original-price-toggle'

function toolbarProps(): PricingToolbarProps {
  return {
    filteredCount: 1,
    totalCount: 1,
    sortBy: 'name',
    dimension: 'deepswe',
    onDimensionChange: vi.fn(),
    groupSort: 'auto',
    onGroupSortChange: vi.fn(),
    tokenUnit: 'M',
    showRechargePrice: false,
    viewMode: 'card',
    quotaTypeFilter: 'all',
    endpointTypeFilter: 'all',
    modalityFilter: 'all',
    vendorFilter: 'all',
    groupFilter: 'all',
    tagFilter: 'all',
    ratingFilter: 'all',
    onSortChange: vi.fn(),
    onTokenUnitChange: vi.fn(),
    onRechargePriceChange: vi.fn(),
    onViewModeChange: vi.fn(),
    onQuotaTypeChange: vi.fn(),
    onEndpointTypeChange: vi.fn(),
    onModalityChange: vi.fn(),
    onVendorChange: vi.fn(),
    onGroupChange: vi.fn(),
    onTagChange: vi.fn(),
    onRatingChange: vi.fn(),
    vendors: [],
    groups: ['default'],
    groupRatios: { default: 1 },
    tags: [],
    models: [],
    hasActiveFilters: false,
    activeFilterCount: 0,
    onClearFilters: vi.fn(),
  }
}

/** Minimal host that exercises the persisted preference hook. */
function ToggleHost(props: { showByDefault: boolean }) {
  const [value, setValue] = useOriginalPriceToggle(props.showByDefault)
  return (
    <button type='button' onClick={() => setValue(!value)}>
      {value ? 'on' : 'off'}
    </button>
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('original price toggle in the toolbar', () => {
  it('reports the visitor choice through an accessible switch', async () => {
    const user = userEvent.setup()
    const onOriginalPriceChange = vi.fn()
    render(
      <PricingToolbar
        {...toolbarProps()}
        showOriginalPrice={false}
        onOriginalPriceChange={onOriginalPriceChange}
      />
    )

    const toggle = screen.getByRole('switch', { name: 'Show original price' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await user.click(toggle)

    // Base UI passes its event details as a second argument.
    expect(onOriginalPriceChange.mock.calls[0][0]).toBe(true)
  })

  it('shows the switch as checked when the visitor already enabled it', () => {
    render(
      <PricingToolbar
        {...toolbarProps()}
        showOriginalPrice
        onOriginalPriceChange={vi.fn()}
      />
    )

    expect(
      screen.getByRole('switch', { name: 'Show original price' })
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('hides the switch entirely when the site disables the feature', () => {
    render(<PricingToolbar {...toolbarProps()} />)

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByText('Show original price')).not.toBeInTheDocument()
  })
})

describe('original price preference', () => {
  it('starts from the configured default before the visitor chooses', () => {
    render(<ToggleHost showByDefault />)

    expect(screen.getByRole('button', { name: 'on' })).toBeVisible()
  })

  it('keeps the visitor choice across visits instead of the default', async () => {
    const user = userEvent.setup()
    const first = render(<ToggleHost showByDefault={false} />)

    await user.click(screen.getByRole('button', { name: 'off' }))
    expect(screen.getByRole('button', { name: 'on' })).toBeVisible()
    first.unmount()

    // A fresh mount reads the stored preference, not the configured default.
    render(<ToggleHost showByDefault={false} />)
    expect(screen.getByRole('button', { name: 'on' })).toBeVisible()
  })

  it('remembers switching the feature off against a default of on', async () => {
    const user = userEvent.setup()
    const first = render(<ToggleHost showByDefault />)

    await user.click(screen.getByRole('button', { name: 'on' }))
    expect(screen.getByRole('button', { name: 'off' })).toBeVisible()
    first.unmount()

    render(<ToggleHost showByDefault />)
    expect(screen.getByRole('button', { name: 'off' })).toBeVisible()
  })
})
