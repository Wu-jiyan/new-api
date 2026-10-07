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
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { AnnouncementPopup } from '@/components/announcement-popup'
import type {
  AnnouncementPopup as AnnouncementPopupPayload,
  SystemStatus,
} from '@/features/auth/types'
import { getAnnouncementPopupRevision } from '@/lib/announcement-popup'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useNotificationStore } from '@/stores/notification-store'

const ANNOUNCEMENT: AnnouncementPopupPayload = {
  id: 7,
  content: 'Scheduled maintenance on Sunday',
  publishDate: '2026-10-01T00:00:00Z',
  type: 'warning',
}

function renderPopup(status: Partial<SystemStatus>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, status)

  function Wrapper(props: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, props.children)
  }

  return render(<AnnouncementPopup />, { wrapper: Wrapper })
}

/** The footer owns the two visible choices; the header X also carries "Close". */
function footerButton(name: string): HTMLElement {
  const footer = document.querySelector('[data-slot="dialog-footer"]')
  if (!footer) throw new Error('popup footer is not rendered')
  return within(footer as HTMLElement).getByRole('button', { name })
}

function popupContent(): HTMLElement | null {
  return screen.queryByText(ANNOUNCEMENT.content)
}

/** Let mount effects settle, then assert the popup did not open. */
async function expectPopupClosed(): Promise<void> {
  await act(async () => {})
  expect(popupContent()).not.toBeInTheDocument()
}

beforeEach(() => {
  useNotificationStore.setState({ mutedAnnouncementRevision: '' })
  // jsdom has no Web Animations API, which the dialog uses to await its exit
  // animation; without the stub closing reports an unhandled error.
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    writable: true,
    value: () => [],
  })
})

it('opens with the marked announcement', async () => {
  renderPopup({
    announcement_popup_enabled: true,
    announcement_popup: ANNOUNCEMENT,
  })

  expect(await screen.findByText(ANNOUNCEMENT.content)).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Do not show again' })
  ).toBeInTheDocument()
})

it('stays closed while the popup switch is off', async () => {
  renderPopup({
    announcement_popup_enabled: false,
    announcement_popup: ANNOUNCEMENT,
  })

  await expectPopupClosed()
})

it('stays closed when no announcement is marked', async () => {
  renderPopup({ announcement_popup_enabled: true })

  await expectPopupClosed()
})

it('closing hides the popup until the next page load', async () => {
  const user = userEvent.setup()
  const first = renderPopup({
    announcement_popup_enabled: true,
    announcement_popup: ANNOUNCEMENT,
  })
  await screen.findByText(ANNOUNCEMENT.content)

  await user.click(footerButton('Close'))

  expect(popupContent()).not.toBeInTheDocument()
  expect(useNotificationStore.getState().mutedAnnouncementRevision).toBe('')

  first.unmount()
  renderPopup({
    announcement_popup_enabled: true,
    announcement_popup: ANNOUNCEMENT,
  })

  expect(await screen.findByText(ANNOUNCEMENT.content)).toBeInTheDocument()
})

it('muting the announcement keeps it hidden after the next page load', async () => {
  const user = userEvent.setup()
  const first = renderPopup({
    announcement_popup_enabled: true,
    announcement_popup: ANNOUNCEMENT,
  })
  await screen.findByText(ANNOUNCEMENT.content)

  await user.click(footerButton('Do not show again'))

  expect(popupContent()).not.toBeInTheDocument()
  expect(useNotificationStore.getState().mutedAnnouncementRevision).toBe(
    getAnnouncementPopupRevision(ANNOUNCEMENT)
  )

  first.unmount()
  renderPopup({
    announcement_popup_enabled: true,
    announcement_popup: ANNOUNCEMENT,
  })

  await expectPopupClosed()
})

it('opens again after the muted announcement is updated', async () => {
  useNotificationStore
    .getState()
    .muteAnnouncementPopup(getAnnouncementPopupRevision(ANNOUNCEMENT))

  renderPopup({
    announcement_popup_enabled: true,
    announcement_popup: { ...ANNOUNCEMENT, content: 'Maintenance is complete' },
  })

  expect(
    await screen.findByText('Maintenance is complete')
  ).toBeInTheDocument()
})

describe('announcement popup revision', () => {
  it('keeps the revision stable when only the publish date changes', () => {
    expect(
      getAnnouncementPopupRevision({
        ...ANNOUNCEMENT,
        publishDate: '2026-11-20T00:00:00Z',
      })
    ).toBe(getAnnouncementPopupRevision(ANNOUNCEMENT))
  })

  it('changes the revision when the announcement content changes', () => {
    expect(
      getAnnouncementPopupRevision({ ...ANNOUNCEMENT, content: 'Updated' })
    ).not.toBe(getAnnouncementPopupRevision(ANNOUNCEMENT))
  })

  it('has no revision without content', () => {
    expect(getAnnouncementPopupRevision(null)).toBe('')
    expect(getAnnouncementPopupRevision({ content: '   ' })).toBe('')
  })
})
