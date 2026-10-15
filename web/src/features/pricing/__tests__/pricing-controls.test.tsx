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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { PricingSidebar } from '../components/pricing-sidebar'
import {
  PricingToolbar,
  type PricingToolbarProps,
} from '../components/pricing-toolbar'
import { SORT_OPTIONS } from '../constants'
import { useFilters } from '../hooks/use-filters'
import type { ScoreDimension } from '../lib/scores'
import type { PricingModel } from '../types'

type PricingDefaults = { sort?: string; dimension?: ScoreDimension }

function toolbarProps(): PricingToolbarProps {
  return {
    filteredCount: 2,
    totalCount: 2,
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
    onVendorChange: vi.fn(),
    onGroupChange: vi.fn(),
    onTagChange: vi.fn(),
    onRatingChange: vi.fn(),
    vendors: [],
    groups: ['default', 'premium'],
    groupRatios: { default: 1, premium: 3 },
    tags: [],
    models: [],
    hasActiveFilters: false,
    activeFilterCount: 0,
    onClearFilters: vi.fn(),
  }
}

/** Wires the real filter state into the toolbar, the way the pricing page does. */
function PricingControlsWithDefaults(props: { defaults: PricingDefaults }) {
  const filters = useFilters([], props.defaults)

  return (
    <PricingToolbar
      {...toolbarProps()}
      filteredCount={filters.filteredModels.length}
      searchScopes={filters.searchScopes}
      onSearchScopesChange={filters.setSearchScopes}
      sortBy={filters.sortBy}
      onSortChange={filters.setSortBy}
      dimension={filters.scoreDimension}
      onDimensionChange={filters.setScoreDimension}
    />
  )
}

async function renderPricingControls(defaults: PricingDefaults) {
  const root = createRootRoute()
  const pricing = createRoute({
    getParentRoute: () => root,
    path: '/pricing/',
    component: () => <PricingControlsWithDefaults defaults={defaults} />,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([pricing]),
    history: createMemoryHistory({ initialEntries: ['/pricing/'] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('button', { name: 'Search scope' })
  return router
}

/** A controlled host so the scope picker behaves like a parent page would. */
function PricingSearchScopeToolbar() {
  const [scopes, setScopes] = useState<string[]>(['name'])
  return (
    <PricingToolbar
      {...toolbarProps()}
      searchScopes={scopes}
      onSearchScopesChange={setScopes}
    />
  )
}

describe('pricing controls', () => {
  it('counts each model once per filter and updates counts when the catalog changes', () => {
    const props = toolbarProps()
    const base: PricingModel = {
      id: 1,
      model_name: 'text-model',
      vendor_name: 'Vendor A',
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 1,
      enable_groups: ['default'],
      tags: 'Chat,chat',
      supported_endpoint_types: ['openai', 'openai'],
    }
    const models: PricingModel[] = [
      base,
      {
        ...base,
        id: 2,
        model_name: 'image-model',
        quota_type: 1,
        tags: 'chat,Image',
        supported_endpoint_types: ['image-generation'],
      },
      {
        ...base,
        id: 3,
        model_name: 'task-model',
        vendor_name: 'Vendor B',
        tags: 'Video',
        supported_endpoint_types: ['openai-video'],
        billing_usage_schema: { seconds: { type: 'number', unit: 'second' } },
      },
    ]
    const sidebarProps = {
      ...props,
      vendors: [
        { id: 1, name: 'Vendor A' },
        { id: 2, name: 'Vendor B' },
      ],
      tags: ['Chat', 'Image', 'Video'],
    }
    const { rerender } = render(
      <PricingSidebar {...sidebarProps} models={models} />
    )

    expect(
      screen.getByRole('button', { name: /^All Vendors\s*3$/ })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /^Vendor A\s*2$/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Vendor B\s*1$/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Chat\s*2$/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Chat\s*1$/ })).toBeVisible()
    expect(
      screen.getByRole('button', { name: /^Token-based\s*1$/ })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: /^Per Request\s*1$/ })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: /^Task billing\s*1$/ })
    ).toBeVisible()

    rerender(<PricingSidebar {...sidebarProps} models={[models[1]]} />)
    expect(
      screen.getByRole('button', { name: /^All Vendors\s*1$/ })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /^Vendor A\s*1$/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Vendor B\s*1$/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Chat\s*1$/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Chat\s*0$/ })).toBeVisible()
    expect(
      screen.getByRole('button', { name: /^Token-based\s*0$/ })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: /^Task billing\s*0$/ })
    ).toBeVisible()
  })

  it('changes the token unit and keeps the selected unit pressed when clicked again', async () => {
    const props = toolbarProps()
    const user = userEvent.setup()
    const { rerender } = render(<PricingToolbar {...props} />)
    await user.click(screen.getByRole('button', { name: '/1K' }))
    expect(props.onTokenUnitChange).toHaveBeenCalledWith('K')
    rerender(<PricingToolbar {...props} tokenUnit='K' />)
    const selected = screen.getByRole('button', { name: '/1K' })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    await user.click(selected)
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(props.onTokenUnitChange).toHaveBeenCalledTimes(1)
  })

  it('changes the recharge display mode with an accessible selected state', async () => {
    const props = toolbarProps()
    const user = userEvent.setup()
    const { rerender } = render(<PricingToolbar {...props} />)
    await user.click(screen.getByRole('button', { name: 'Recharge' }))
    expect(props.onRechargePriceChange).toHaveBeenCalledWith(true)
    rerender(<PricingToolbar {...props} showRechargePrice />)
    expect(screen.getByRole('button', { name: 'Recharge' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('switches to table view with the keyboard and exposes the selected view', async () => {
    const props = toolbarProps()
    const user = userEvent.setup()
    const { rerender } = render(<PricingToolbar {...props} />)
    const tableButton = screen.getByRole('button', { name: 'Table view' })
    tableButton.focus()
    await user.keyboard('{Enter}')
    expect(props.onViewModeChange).toHaveBeenCalledWith('table')
    rerender(<PricingToolbar {...props} viewMode='table' />)
    expect(tableButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Card view' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('selects price sorting from the shared dropdown', async () => {
    const props = toolbarProps()
    const user = userEvent.setup()
    render(<PricingToolbar {...props} />)
    await user.click(screen.getByRole('button', { name: 'Name' }))
    await user.click(
      screen.getByRole('menuitem', { name: 'Input Price: Low to High' })
    )
    expect(props.onSortChange).toHaveBeenCalledWith('input-price-low')
  })

  it('opens mobile filters from the left, selects a group, and restores focus on close', async () => {
    const props = toolbarProps()
    const user = userEvent.setup()
    const { rerender } = render(<PricingToolbar {...props} />)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    const dialog = await screen.findByRole('dialog', { name: 'Filter' })
    expect(dialog).toHaveAttribute('data-side', 'left')
    expect(within(dialog).getByRole('button', { name: 'Reset' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: /premium/ }))
    expect(props.onGroupChange).toHaveBeenCalledWith('premium')
    rerender(
      <PricingToolbar
        {...props}
        groupFilter='premium'
        hasActiveFilters
        activeFilterCount={1}
      />
    )
    expect(
      within(dialog).getByRole('button', { name: /premium/ })
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(dialog).getByRole('button', { name: 'Reset' }))
    expect(props.onClearFilters).toHaveBeenCalledOnce()
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: /Filter/ })).toHaveFocus()
  })

  it('keeps the score dimension the user picked when the configured default is another dimension', async () => {
    const user = userEvent.setup()
    await renderPricingControls({ dimension: 'aa_intelligence' })
    expect(
      screen.getByRole('button', { name: 'AA Intelligence' })
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'AA Intelligence' }))
    await user.click(screen.getByRole('menuitem', { name: 'DeepSWE' }))

    expect(screen.getByRole('button', { name: 'DeepSWE' })).toBeVisible()
  })

  it('keeps name sorting when the configured default sorts by score', async () => {
    const user = userEvent.setup()
    await renderPricingControls({ sort: SORT_OPTIONS.SCORE_HIGH })
    expect(
      screen.getByRole('button', { name: 'Score: High to Low' })
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Score: High to Low' }))
    await user.click(screen.getByRole('menuitem', { name: 'Name' }))

    expect(screen.getByRole('button', { name: 'Name' })).toBeVisible()
  })

  it('marks only the model name as searched while no scope is chosen', async () => {
    const user = userEvent.setup()
    render(<PricingToolbar {...toolbarProps()} />)

    await user.click(screen.getByRole('button', { name: 'Search scope' }))

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Search model name' })
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Search description' })
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Search tags' })
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Search vendor' })
    ).toHaveAttribute('aria-checked', 'false')
  })

  it('adds and removes searched fields from the search scope dropdown', async () => {
    const user = userEvent.setup()
    render(<PricingSearchScopeToolbar />)

    await user.click(screen.getByRole('button', { name: 'Search scope' }))
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Search description' })
    )
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Search description' })
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Search model name' })
    ).toHaveAttribute('aria-checked', 'true')

    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Search model name' })
    )
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Search model name' })
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Search description' })
    ).toHaveAttribute('aria-checked', 'true')
  })
})

describe('group ordering', () => {
  const groupChip = (name: string) =>
    screen.getByRole('button', { name: new RegExp(`^${name}\\s*`) })
  const renderedBefore = (a: HTMLElement, b: HTMLElement) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

  function sidebarProps(groupSort: 'auto' | 'name') {
    return {
      ...toolbarProps(),
      groups: ['vip', 'default', 'beta'],
      groupRatios: { vip: 3, default: 1, beta: 1 },
      autoGroups: ['vip'],
      models: [] as PricingModel[],
      groupSort,
      onGroupSortChange: vi.fn(),
    }
  }

  it('lists groups alphabetically by default ordering', () => {
    render(<PricingSidebar {...sidebarProps('name')} />)

    expect(renderedBefore(groupChip('beta'), groupChip('default'))).toBe(true)
    expect(renderedBefore(groupChip('default'), groupChip('vip'))).toBe(true)
  })

  it('puts auto group chain groups first and the rest last by name', () => {
    render(<PricingSidebar {...sidebarProps('auto')} />)

    expect(renderedBefore(groupChip('vip'), groupChip('beta'))).toBe(true)
    expect(renderedBefore(groupChip('beta'), groupChip('default'))).toBe(true)
  })

  it('offers the ordering switcher in the groups section', () => {
    render(<PricingSidebar {...sidebarProps('auto')} />)

    expect(screen.getByRole('button', { name: 'Group order' })).toBeVisible()
  })
})

describe('free group ratio', () => {
  function sidebarWithRatios(groupRatios: Record<string, number>) {
    return {
      ...toolbarProps(),
      groups: Object.keys(groupRatios),
      groupRatios,
      models: [] as PricingModel[],
      groupSort: 'name' as const,
      onGroupSortChange: vi.fn(),
    }
  }

  it('labels a zero-ratio group as free instead of showing "x0"', () => {
    render(<PricingSidebar {...sidebarWithRatios({ free: 0, default: 1 })} />)

    expect(screen.getByText('Free of charge')).toBeVisible()
    expect(screen.queryByText('x0')).not.toBeInTheDocument()
  })

  it('keeps the multiplier suffix for a paid group', () => {
    render(<PricingSidebar {...sidebarWithRatios({ premium: 0.5 })} />)

    expect(screen.getByText('x0.5')).toBeVisible()
  })

  it('shows the flat price instead of a ratio for a forced-price group', () => {
    render(
      <PricingSidebar
        {...sidebarWithRatios({ 'image-gen': 1 })}
        groupForcedPrice={{ 'image-gen': 0.02 }}
      />
    )

    expect(screen.getByText('$0.02')).toBeVisible()
    expect(screen.queryByText('x1')).not.toBeInTheDocument()
  })
})
