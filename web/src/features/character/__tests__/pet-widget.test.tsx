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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { CharacterPetWidget } from '../components/pet-widget'
import type { CharacterPetStatus, CharacterPetView } from '../types'

const STORAGE_KEY = 'character-pet:v1'

function renderWidget() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CharacterPetWidget />
    </QueryClientProvider>
  )
}

function mockPetApi(
  pet: CharacterPetView,
  status: CharacterPetStatus = { items: [] }
) {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/character/pet') {
      return { data: { success: true, data: pet } }
    }
    if (url === '/api/character/pet/status') {
      return { data: { success: true, data: status } }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
}

function seedPrefs(prefs: Record<string, unknown>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

function readPrefs(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
}

const activePet: CharacterPetView = {
  active: true,
  model_name: 'demo-character',
  display_name: 'Aria the Cartographer',
  image_url: '/uploads/characters/demo/pet/pet.png',
}

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('desk pet rendering', () => {
  it('renders nothing when the server reports no active desk pet', async () => {
    mockPetApi({ active: false })
    const { container } = renderWidget()

    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(container.querySelector('[data-slot="character-pet"]')).toBeNull()
  })

  it('renders the pet image supplied by the server', async () => {
    mockPetApi(activePet)
    renderWidget()

    const pet = await screen.findByRole('button', {
      name: 'Aria the Cartographer',
    })
    const image = pet.querySelector('img')
    expect(image).toHaveAttribute('src', activePet.image_url)
  })

  it('keeps the pet out of the way when the user hid it', async () => {
    seedPrefs({ x: 400, y: 300, side: 'free', scale: 1, hidden: true })
    mockPetApi(activePet)
    const { container } = renderWidget()

    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(container.querySelector('[data-slot="character-pet"]')).toBeNull()
  })
})

describe('desk pet edge snapping', () => {
  const startPrefs = { x: 400, y: 300, side: 'free', scale: 1, hidden: false }

  it('snaps to the left edge and mirrors when dropped inside the left snap zone', async () => {
    seedPrefs(startPrefs)
    mockPetApi(activePet)
    const { container } = renderWidget()

    const pet = await screen.findByRole('button', {
      name: 'Aria the Cartographer',
    })
    fireEvent.pointerDown(pet, {
      pointerId: 1,
      clientX: 400,
      clientY: 300,
      button: 0,
    })
    fireEvent.pointerMove(pet, { pointerId: 1, clientX: 20, clientY: 300 })
    fireEvent.pointerUp(pet, { pointerId: 1, clientX: 20, clientY: 300 })

    await waitFor(() => {
      expect(
        container.querySelector('[data-slot="character-pet"]')
      ).toHaveStyle({
        left: '8px',
      })
    })
    // 贴左必须整体镜像，否则角色会一直"背对"屏幕左缘
    expect(container.querySelector('img')).toHaveClass('-scale-x-100')
    expect(readPrefs().side).toBe('left')
  })

  it('snaps to the right edge without mirroring when dropped inside the right snap zone', async () => {
    seedPrefs(startPrefs)
    mockPetApi(activePet)
    const { container } = renderWidget()

    const pet = await screen.findByRole('button', {
      name: 'Aria the Cartographer',
    })
    fireEvent.pointerDown(pet, {
      pointerId: 1,
      clientX: 400,
      clientY: 300,
      button: 0,
    })
    fireEvent.pointerMove(pet, {
      pointerId: 1,
      clientX: window.innerWidth - 30,
      clientY: 300,
    })
    fireEvent.pointerUp(pet, {
      pointerId: 1,
      clientX: window.innerWidth - 30,
      clientY: 300,
    })

    await waitFor(() => {
      expect(readPrefs().side).toBe('right')
    })
    expect(container.querySelector('img')).not.toHaveClass('-scale-x-100')
  })

  it('leaves the pet where it was dropped in the middle of the viewport', async () => {
    seedPrefs(startPrefs)
    mockPetApi(activePet)
    renderWidget()

    const pet = await screen.findByRole('button', {
      name: 'Aria the Cartographer',
    })
    fireEvent.pointerDown(pet, {
      pointerId: 1,
      clientX: 400,
      clientY: 300,
      button: 0,
    })
    fireEvent.pointerMove(pet, { pointerId: 1, clientX: 480, clientY: 320 })
    fireEvent.pointerUp(pet, { pointerId: 1, clientX: 480, clientY: 320 })

    await waitFor(() => {
      expect(readPrefs().side).toBe('free')
    })
  })

  it('persists the dropped position so the pet reopens where it was left', async () => {
    seedPrefs(startPrefs)
    mockPetApi(activePet)
    renderWidget()

    const pet = await screen.findByRole('button', {
      name: 'Aria the Cartographer',
    })
    fireEvent.pointerDown(pet, {
      pointerId: 1,
      clientX: 400,
      clientY: 300,
      button: 0,
    })
    fireEvent.pointerMove(pet, { pointerId: 1, clientX: 480, clientY: 340 })
    fireEvent.pointerUp(pet, { pointerId: 1, clientX: 480, clientY: 340 })

    await waitFor(() => {
      expect(readPrefs()).toMatchObject({ x: 480, y: 340 })
    })
  })
})

describe('desk pet interaction', () => {
  it('shows an idle line when the pet is tapped without moving it', async () => {
    seedPrefs({ x: 400, y: 300, side: 'free', scale: 1, hidden: false })
    mockPetApi(activePet)
    renderWidget()

    const pet = await screen.findByRole('button', {
      name: 'Aria the Cartographer',
    })
    fireEvent.pointerDown(pet, {
      pointerId: 1,
      clientX: 400,
      clientY: 300,
      button: 0,
    })
    fireEvent.pointerUp(pet, { pointerId: 1, clientX: 400, clientY: 300 })

    const bubble = await screen.findByRole('status')
    expect(bubble.textContent).toMatch(/^character\.pet\.line\.\d$/)
  })

  it('hides the pet and remembers the choice when the hide control is used', async () => {
    seedPrefs({ x: 400, y: 300, side: 'free', scale: 1, hidden: false })
    mockPetApi(activePet)
    renderWidget()

    await screen.findByRole('button', { name: 'Aria the Cartographer' })
    fireEvent.pointerEnter(
      screen.getByRole('button', { name: 'Aria the Cartographer' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'character.pet.hide' })
    )

    await waitFor(() => {
      expect(readPrefs().hidden).toBe(true)
    })
    expect(
      screen.queryByRole('button', { name: 'Aria the Cartographer' })
    ).toBeNull()
  })
})
describe('desk pet site alerts', () => {
  const prefs = { x: 400, y: 300, side: 'free', scale: 1, hidden: false }

  function tap(pet: HTMLElement) {
    fireEvent.pointerDown(pet, {
      pointerId: 1,
      clientX: 400,
      clientY: 300,
      button: 0,
    })
    fireEvent.pointerUp(pet, { pointerId: 1, clientX: 400, clientY: 300 })
  }

  it('marks the pet when the account needs attention', async () => {
    seedPrefs(prefs)
    mockPetApi(activePet, {
      items: [
        {
          key: 'character.pet.status.quotaLow',
          severity: 'warning',
          params: { quota: 100, threshold: 200 },
        },
      ],
    })
    const { container } = renderWidget()

    await screen.findByRole('button', { name: 'Aria the Cartographer' })
    await waitFor(() => {
      expect(
        container.querySelector('[data-severity="warning"]')
      ).not.toBeNull()
    })
  })

  it('reports a critical alert more loudly than a warning', async () => {
    seedPrefs(prefs)
    mockPetApi(activePet, {
      items: [
        {
          key: 'character.pet.status.quotaLow',
          severity: 'warning',
          params: { quota: 100, threshold: 200 },
        },
        {
          key: 'character.pet.status.quotaExhausted',
          severity: 'critical',
          params: { quota: 0 },
        },
      ],
    })
    const { container } = renderWidget()

    await screen.findByRole('button', { name: 'Aria the Cartographer' })
    await waitFor(() => {
      expect(
        container.querySelector('[data-severity="critical"]')
      ).not.toBeNull()
    })
    expect(container.querySelector('[data-severity="warning"]')).toBeNull()
  })

  it('surfaces the alert before idle chatter when the pet is tapped', async () => {
    seedPrefs(prefs)
    mockPetApi(activePet, {
      items: [
        {
          key: 'character.pet.status.errorBurst',
          severity: 'warning',
          params: { count: 7, threshold: 5 },
        },
      ],
    })
    renderWidget()

    const pet = await screen.findByRole('button', {
      name: 'Aria the Cartographer',
    })
    tap(pet)

    const bubble = await screen.findByRole('status')
    expect(bubble.textContent).toContain('character.pet.status.errorBurst')
  })

  it('shows no marker and only idle chatter when nothing needs attention', async () => {
    seedPrefs(prefs)
    mockPetApi(activePet, { items: [] })
    const { container } = renderWidget()

    const pet = await screen.findByRole('button', {
      name: 'Aria the Cartographer',
    })
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(container.querySelector('[data-severity]')).toBeNull()

    tap(pet)
    const bubble = await screen.findByRole('status')
    expect(bubble.textContent).toMatch(/^character\.pet\.line\.\d$/)
  })
})
describe('desk pet conversation entry', () => {
  it('loads the character when the conversation action is used', async () => {
    seedPrefs({ x: 400, y: 300, side: 'free', scale: 1, hidden: false })
    // fetchCharacter resolves to null, so the heavy player never mounts here;
    // this case only pins that the pet asks for the right character.
    mockPetApi(activePet, { items: [] })
    renderWidget()

    const pet = await screen.findByRole('button', {
      name: 'Aria the Cartographer',
    })
    fireEvent.pointerEnter(pet)
    fireEvent.click(
      await screen.findByRole('button', { name: 'character.chat.open' })
    )

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/character/demo-character')
    })
  })

  it('does not request a conversation until the action is used', async () => {
    seedPrefs({ x: 400, y: 300, side: 'free', scale: 1, hidden: false })
    mockPetApi(activePet, { items: [] })
    renderWidget()

    await screen.findByRole('button', { name: 'Aria the Cartographer' })
    await waitFor(() => expect(api.get).toHaveBeenCalled())

    expect(api.get).not.toHaveBeenCalledWith('/api/character/demo-character')
  })
})
