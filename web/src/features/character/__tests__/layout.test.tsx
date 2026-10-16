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
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import CharacterGalleryPage from '../gallery'
import CharacterDetailPage from '../index'
import type { CharacterPetView, CharacterView } from '../types'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  useParams: () => ({ modelName: 'demo-character' }),
}))

const MODEL_NAME = 'demo-character'

const character: CharacterView = {
  id: 7,
  model_name: MODEL_NAME,
  display_name: 'Aria the Cartographer',
  title: 'Wandering Scribe',
  description: 'Maps every place she has never been.',
  tags: 'explorer,writer',
  max_stage: 0,
  affinity: 40,
  affinity_required: 60,
  total_tokens: 1200,
  total_calls: 3,
  pet_image_url: '/images/aria-pet.png',
  stages: [
    {
      index: 0,
      name: 'First Meeting',
      image_url: '/images/aria-stage-0.png',
      silhouette_url: '/images/aria-silhouette.png',
      unlock_tokens: 0,
      unlock_text: 'Say hello to unlock',
      claimed: true,
      eligible: false,
    },
  ],
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

function mockDetailApi(characterData: CharacterView | null) {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === `/api/character/${MODEL_NAME}`) {
      return { data: { success: true, data: characterData } }
    }
    if (url === `/api/character/${MODEL_NAME}/chat/meta`) {
      return {
        data: {
          success: true,
          data: { has_history: false, stage_index: 0, message_count: 0 },
        },
      }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
}

function mockGalleryApi(
  list: CharacterView[],
  pet: CharacterPetView = { active: false }
) {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/character/characters') {
      return { data: { success: true, data: list } }
    }
    if (url === '/api/character/pet') {
      return { data: { success: true, data: pet } }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
}

describe('character detail page shell', () => {
  it('keeps the loaded character body inside the layout scroll region', async () => {
    mockDetailApi(character)
    renderPage(<CharacterDetailPage />)

    const description = await screen.findByText(
      'Maps every place she has never been.'
    )
    const { scroller } = layoutShell()
    expect(scroller).toContainElement(description)
    expect(scroller).toContainElement(
      await screen.findByRole('button', { name: /First Meeting/ })
    )
  })

  it('presents the character name as the page heading above the scroll region', async () => {
    mockDetailApi(character)
    renderPage(<CharacterDetailPage />)

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Aria the Cartographer',
    })
    const { main, scroller } = layoutShell()
    expect(main).toContainElement(heading)
    expect(scroller).not.toContainElement(heading)
  })

  it('keeps the loading skeleton inside the layout scroll region', () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}))
    renderPage(<CharacterDetailPage />)

    const { scroller } = layoutShell()
    expect(scroller.querySelectorAll('[data-slot="skeleton"]').length).toBe(2)
    expect(
      screen.getByRole('heading', { level: 2, name: MODEL_NAME })
    ).toBeVisible()
  })

  it('keeps the not-found notice inside the layout scroll region', async () => {
    mockDetailApi(null)
    renderPage(<CharacterDetailPage />)

    const notice = await screen.findByText('character.notFound')
    const { scroller } = layoutShell()
    expect(scroller).toContainElement(notice)
  })

  it('keeps the back control outside the scroll region and operable', async () => {
    mockDetailApi(character)
    const historyBack = vi
      .spyOn(window.history, 'back')
      .mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderPage(<CharacterDetailPage />)

    const back = await screen.findByRole('button', { name: 'common.back' })
    const { scroller } = layoutShell()
    expect(back).toBeVisible()
    expect(scroller).not.toContainElement(back)

    await user.click(back)
    expect(historyBack).toHaveBeenCalled()
  })
})

describe('character gallery page shell', () => {
  it('keeps the character grid inside the layout scroll region', async () => {
    mockGalleryApi([character])
    renderPage(<CharacterGalleryPage />)

    const card = await screen.findByRole('heading', {
      name: 'Aria the Cartographer',
    })
    const { scroller } = layoutShell()
    expect(scroller).toContainElement(card)
    expect(scroller).toContainElement(
      screen.getByText('character.gallery.subtitle')
    )
  })

  it('presents the gallery title as the page heading above the scroll region', async () => {
    mockGalleryApi([character])
    renderPage(<CharacterGalleryPage />)

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'character.gallery.title',
    })
    const { main, scroller } = layoutShell()
    expect(main).toContainElement(heading)
    expect(scroller).not.toContainElement(heading)
  })

  it('keeps the empty gallery notice inside the layout scroll region', async () => {
    mockGalleryApi([])
    renderPage(<CharacterGalleryPage />)

    const notice = await screen.findByText('character.gallery.empty')
    const { scroller } = layoutShell()
    expect(scroller).toContainElement(notice)
  })

  it('keeps the loading skeleton inside the layout scroll region', () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}))
    renderPage(<CharacterGalleryPage />)

    const { scroller } = layoutShell()
    expect(
      scroller.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    expect(
      screen.getByRole('heading', { level: 2, name: 'character.gallery.title' })
    ).toBeVisible()
  })
})

describe('character gallery desk pet activation', () => {
  it('offers the activate control for a claimed character that has a pet image', async () => {
    mockGalleryApi([character])
    renderPage(<CharacterGalleryPage />)

    expect(
      await screen.findByRole('button', { name: 'character.pet.activate' })
    ).toBeVisible()
  })

  it('omits the activate control for a claimed character without a pet image', async () => {
    mockGalleryApi([{ ...character, pet_image_url: undefined }])
    renderPage(<CharacterGalleryPage />)

    expect(
      await screen.findByRole('heading', { name: 'Aria the Cartographer' })
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'character.pet.activate' })
    ).toBeNull()
  })

  it('posts the chosen character and shows it as the active desk pet', async () => {
    mockGalleryApi([character], {
      active: true,
      model_name: MODEL_NAME,
      display_name: 'Aria the Cartographer',
      image_url: '/images/aria-pet.png',
    })
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          active: true,
          model_name: MODEL_NAME,
          display_name: 'Aria the Cartographer',
          image_url: '/images/aria-pet.png',
        },
      },
    })
    const user = userEvent.setup()
    renderPage(<CharacterGalleryPage />)

    const deactivate = await screen.findByRole('button', {
      name: 'character.pet.deactivate',
    })
    expect(deactivate).toHaveAttribute('aria-pressed', 'true')

    await user.click(deactivate)
    expect(post).toHaveBeenCalledWith(
      '/api/character/pet',
      { model_name: '' },
      { skipErrorHandler: true }
    )
  })

  it('sends the model name when activating a character', async () => {
    mockGalleryApi([character])
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          active: true,
          model_name: MODEL_NAME,
          display_name: 'Aria the Cartographer',
          image_url: '/images/aria-pet.png',
        },
      },
    })
    const user = userEvent.setup()
    renderPage(<CharacterGalleryPage />)

    await user.click(
      await screen.findByRole('button', { name: 'character.pet.activate' })
    )
    expect(post).toHaveBeenCalledWith('/api/character/pet', {
      model_name: MODEL_NAME,
    }, { skipErrorHandler: true })
  })
})
