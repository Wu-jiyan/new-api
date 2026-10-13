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

import CharacterBackgroundsPage from '../index'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

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

function mockBackgroundApi(
  list: { id: number; name: string; image_url: string }[]
) {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/character/admin/backgrounds') {
      return {
        data: {
          success: true,
          data: list.map((background) => ({
            ...background,
            created_at: 0,
            updated_at: 0,
          })),
        },
      }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
}

describe('character backgrounds page shell', () => {
  it('keeps the background cards inside the layout scroll region', async () => {
    mockBackgroundApi([
      { id: 1, name: 'Rainy alley', image_url: '/images/rainy-alley.png' },
    ])
    renderPage(<CharacterBackgroundsPage />)

    const card = await screen.findByText('Rainy alley')
    const { scroller } = layoutShell()
    expect(scroller).toContainElement(card)
    expect(scroller).toContainElement(
      screen.getByRole('button', { name: 'character.admin.upload' })
    )
  })

  it('presents the library title as the page heading above the scroll region', async () => {
    mockBackgroundApi([
      { id: 1, name: 'Rainy alley', image_url: '/images/rainy-alley.png' },
    ])
    renderPage(<CharacterBackgroundsPage />)

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'character.admin.backgroundLibrary',
    })
    const { main, scroller } = layoutShell()
    expect(main).toContainElement(heading)
    expect(scroller).not.toContainElement(heading)
  })

  it('keeps the empty library notice inside the layout scroll region', async () => {
    mockBackgroundApi([])
    renderPage(<CharacterBackgroundsPage />)

    const notice = await screen.findByText('character.admin.noBackgrounds')
    const { scroller } = layoutShell()
    expect(scroller).toContainElement(notice)
  })

  it('keeps the back control outside the scroll region', async () => {
    mockBackgroundApi([])
    renderPage(<CharacterBackgroundsPage />)

    const back = await screen.findByRole('button', {
      name: 'character.admin.backToCharacters',
    })
    const { scroller } = layoutShell()
    expect(back).toBeVisible()
    expect(scroller).not.toContainElement(back)
  })
})