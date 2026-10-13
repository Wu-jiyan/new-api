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
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import CharacterEditorPage from '../editor'
import CharacterAdminPage from '../index'
import type { CharacterAdminItem } from '../types'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  useParams: () => ({ modelName: 'demo-character' }),
}))

// 编辑器的默认对话模型候选来自 playground 接口，与页面外壳无关，隔离掉外部请求。
vi.mock('@/features/playground/api', () => ({
  getUserGroups: async () => [],
  getUserModels: async () => [],
}))

const item: CharacterAdminItem = {
  id: 7,
  model_name: 'demo-character',
  display_name: 'Aria the Cartographer',
  title: 'Wandering Scribe',
  stages_json: JSON.stringify({ stages: [{ index: 0, name: '初遇' }] }),
  enabled: true,
  created_at: 0,
  updated_at: 0,
}

function renderPage(page: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{page}</QueryClientProvider>
  )
}

/**
 * SectionPageLayout 的 Main 是 overflow-hidden，页面正文必须落在布局自己的
 * overflow-auto 区域内；否则手机上整页无法滚动，内容永远够不着。
 */
function layoutShell() {
  const main = screen.getByRole('main')
  expect(main.className).toContain('overflow-hidden')
  const scroller = main.querySelector<HTMLElement>('.overflow-auto')
  expect(scroller).not.toBeNull()
  return { main, scroller: scroller as HTMLElement }
}

function mockAdminApi(list: CharacterAdminItem[]) {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.startsWith('/api/character/admin/characters')) {
      return { data: { success: true, data: list } }
    }
    if (url === '/api/character/admin/backgrounds') {
      return { data: { success: true, data: [] } }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
}

describe('character admin list page shell', () => {
  it('keeps the character cards inside the layout scroll region', async () => {
    mockAdminApi([item])
    renderPage(<CharacterAdminPage />)

    const card = await screen.findByText('Aria the Cartographer')
    const { scroller } = layoutShell()
    expect(scroller).toContainElement(card)
    expect(scroller).toContainElement(
      screen.getByPlaceholderText('character.admin.search')
    )
  })

  it('presents the admin title as the page heading above the scroll region', async () => {
    mockAdminApi([item])
    renderPage(<CharacterAdminPage />)

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'character.admin.title',
    })
    const { main, scroller } = layoutShell()
    expect(main).toContainElement(heading)
    expect(scroller).not.toContainElement(heading)
  })

  it('keeps the create and background buttons outside the scroll region', async () => {
    mockAdminApi([item])
    renderPage(<CharacterAdminPage />)

    const create = await screen.findByRole('button', {
      name: 'character.admin.create',
    })
    const backgrounds = screen.getByRole('button', {
      name: 'character.admin.backgroundLibrary',
    })
    const { scroller } = layoutShell()
    expect(scroller).not.toContainElement(create)
    expect(scroller).not.toContainElement(backgrounds)
  })

  it('keeps the empty list notice inside the layout scroll region', async () => {
    mockAdminApi([])
    renderPage(<CharacterAdminPage />)

    const notice = await screen.findByText('character.admin.noCharacters')
    const { scroller } = layoutShell()
    expect(scroller).toContainElement(notice)
  })
})

describe('character editor page shell', () => {
  it('keeps the edit form inside the layout scroll region', async () => {
    mockAdminApi([item])
    renderPage(<CharacterEditorPage />)

    const modelName = await screen.findByDisplayValue('Aria the Cartographer')
    const { scroller } = layoutShell()
    expect(scroller).toContainElement(modelName)
    expect(scroller).toContainElement(
      screen.getByRole('button', { name: 'common.save' })
    )
  })

  it('presents the editor title as the page heading above the scroll region', async () => {
    mockAdminApi([item])
    renderPage(<CharacterEditorPage />)

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'character.admin.edit',
    })
    const { main, scroller } = layoutShell()
    expect(main).toContainElement(heading)
    expect(scroller).not.toContainElement(heading)
  })

  it('keeps the back control outside the scroll region', async () => {
    mockAdminApi([item])
    renderPage(<CharacterEditorPage />)

    const back = await screen.findByRole('button', {
      name: 'character.admin.backToCharacters',
    })
    const { scroller } = layoutShell()
    expect(back).toBeVisible()
    expect(scroller).not.toContainElement(back)
  })
})