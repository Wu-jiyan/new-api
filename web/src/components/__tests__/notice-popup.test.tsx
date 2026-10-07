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
import { beforeEach, expect, it, vi } from 'vitest'

import { NoticePopup } from '@/components/notice-popup'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useNotificationStore } from '@/stores/notification-store'

const NOTICE = 'Scheduled maintenance on Sunday'

function stubNotice(notice: string) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: notice },
  })
}

function renderPopup(status: { notice_popup_enabled?: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, status)

  function Wrapper(props: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, props.children)
  }

  return render(<NoticePopup />, { wrapper: Wrapper })
}

/** The footer owns the two visible choices; the header X also carries "Close". */
function footerButton(name: string): HTMLElement {
  const footer = document.querySelector('[data-slot="dialog-footer"]')
  if (!footer) throw new Error('popup footer is not rendered')
  return within(footer as HTMLElement).getByRole('button', { name })
}

function popupContent(): HTMLElement | null {
  return screen.queryByText(NOTICE)
}

/** Let mount effects settle, then assert the popup did not open. */
async function expectPopupClosed(): Promise<void> {
  await act(async () => {})
  expect(popupContent()).not.toBeInTheDocument()
}

beforeEach(() => {
  useNotificationStore.setState({ mutedNotice: '' })
  // jsdom has no Web Animations API, which the dialog uses to await its exit
  // animation; without the stub closing reports an unhandled error.
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    writable: true,
    value: () => [],
  })
})

it('opens with the system notice', async () => {
  stubNotice(NOTICE)
  renderPopup({ notice_popup_enabled: true })

  expect(await screen.findByText(NOTICE)).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Do not show again' })
  ).toBeInTheDocument()
})

it('stays closed while the popup switch is off', async () => {
  stubNotice(NOTICE)
  renderPopup({ notice_popup_enabled: false })

  await expectPopupClosed()
})

it('stays closed when the notice is empty', async () => {
  stubNotice('')
  renderPopup({ notice_popup_enabled: true })

  await expectPopupClosed()
})

it('closing hides the popup until the next page load', async () => {
  const user = userEvent.setup()
  stubNotice(NOTICE)
  const first = renderPopup({ notice_popup_enabled: true })
  await screen.findByText(NOTICE)

  await user.click(footerButton('Close'))

  expect(popupContent()).not.toBeInTheDocument()
  expect(useNotificationStore.getState().mutedNotice).toBe('')

  first.unmount()
  renderPopup({ notice_popup_enabled: true })

  expect(await screen.findByText(NOTICE)).toBeInTheDocument()
})

it('muting the notice keeps it hidden after the next page load', async () => {
  const user = userEvent.setup()
  stubNotice(NOTICE)
  const first = renderPopup({ notice_popup_enabled: true })
  await screen.findByText(NOTICE)

  await user.click(footerButton('Do not show again'))

  expect(popupContent()).not.toBeInTheDocument()
  expect(useNotificationStore.getState().mutedNotice).toBe(NOTICE)

  first.unmount()
  renderPopup({ notice_popup_enabled: true })

  await expectPopupClosed()
})

it('opens again after the muted notice is edited', async () => {
  useNotificationStore.getState().muteNotice(NOTICE)
  stubNotice('Maintenance is complete')

  renderPopup({ notice_popup_enabled: true })

  expect(await screen.findByText('Maintenance is complete')).toBeInTheDocument()
})
