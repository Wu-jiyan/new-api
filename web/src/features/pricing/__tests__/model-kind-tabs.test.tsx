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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ModelKindTabs } from '../components/model-kind-tabs'
import { useFilters } from '../hooks/use-filters'
import type { PricingModel } from '../types'

function pricingModel(
  modelName: string,
  overrides: Partial<PricingModel>
): PricingModel {
  return {
    id: 1,
    model_name: modelName,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    ...overrides,
  }
}

const models = [
  pricingModel('text-model', { tags: '文本', vendor_name: 'Acme' }),
  pricingModel('image-model', { tags: '文本,图片', vendor_name: 'Acme' }),
  pricingModel('video-model', { tags: '视频', vendor_name: 'Beta' }),
  pricingModel('plain-model', { vendor_name: 'Beta' }),
]

/** 按广场页面同样的方式把页签接到真实筛选状态上。 */
function KindTabsHarness() {
  const filters = useFilters(models)

  return (
    <div>
      <ModelKindTabs
        value={filters.kindFilter}
        onChange={filters.setKindFilter}
      />
      <button type='button' onClick={() => filters.setVendorFilter('Beta')}>
        only-beta
      </button>
      <ul>
        {filters.filteredModels.map((model) => (
          <li key={model.model_name}>{model.model_name}</li>
        ))}
      </ul>
    </div>
  )
}

async function renderKindTabs(initialEntry = '/pricing/') {
  const root = createRootRoute()
  const pricing = createRoute({
    getParentRoute: () => root,
    path: '/pricing/',
    component: KindTabsHarness,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([pricing]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('tablist', { name: 'Model type' })
  return router
}

function listedModels(): string[] {
  return screen.queryAllByRole('listitem').map((item) => item.textContent ?? '')
}

describe('model square type tabs', () => {
  it('starts on the all tab and lists every model', async () => {
    await renderKindTabs()

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'All',
      'Text',
      'Image',
      'Video',
    ])
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(listedModels()).toEqual([
      'image-model',
      'plain-model',
      'text-model',
      'video-model',
    ])
  })

  it('filters the list by the tags of the chosen type', async () => {
    const user = userEvent.setup()
    await renderKindTabs()

    await user.click(screen.getByRole('tab', { name: 'Image' }))

    expect(screen.getByRole('tab', { name: 'Image' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(listedModels()).toEqual(['image-model'])
  })

  it('writes the chosen type to the URL and drops it on the all tab', async () => {
    const user = userEvent.setup()
    const router = await renderKindTabs()

    await user.click(screen.getByRole('tab', { name: 'Video' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ kind: 'video' })
    )

    await user.click(screen.getByRole('tab', { name: 'All' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(listedModels()).toHaveLength(4)
  })

  it('composes with the other filters instead of replacing them', async () => {
    const user = userEvent.setup()
    await renderKindTabs()

    await user.click(screen.getByRole('tab', { name: 'Text' }))
    expect(listedModels()).toEqual(['image-model', 'text-model'])

    await user.click(screen.getByRole('button', { name: 'only-beta' }))
    expect(listedModels()).toEqual([])

    await user.click(screen.getByRole('tab', { name: 'Video' }))
    expect(listedModels()).toEqual(['video-model'])
  })

  it('reads the type from the URL so a shared link keeps the tab', async () => {
    await renderKindTabs('/pricing/?kind=image')

    expect(screen.getByRole('tab', { name: 'Image' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(listedModels()).toEqual(['image-model'])
  })
})
