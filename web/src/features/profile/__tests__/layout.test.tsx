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
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { Profile } from '..'
import type { UserProfile } from '../types'

const profile: UserProfile = {
  id: 1,
  username: 'root',
  display_name: 'Root',
  role: 100,
  group: 'default',
  quota: 1000000,
  used_quota: 0,
  request_count: 0,
  status: 1,
  aff_count: 0,
  aff_quota: 0,
  aff_history_quota: 0,
  created_time: 0,
}

const statusState: { status: Record<string, unknown> | null } = { status: null }
const permissionState: { sidebarSettings: boolean } = { sidebarSettings: true }

vi.mock('@/features/profile/hooks', () => ({
  useProfile: () => ({
    profile,
    loading: false,
    refreshProfile: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: statusState.status }),
}))

vi.mock('@/stores/auth-store', () => {
  const storeState = () => ({
    auth: {
      user: {
        permissions: { sidebar_settings: permissionState.sidebarSettings },
      },
    },
  })
  return {
    useAuthStore: (selector?: (state: unknown) => unknown) =>
      typeof selector === 'function' ? selector(storeState()) : storeState(),
  }
})

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn().mockResolvedValue({ data: { success: true } }),
  },
}))

const i18n = createInstance()

function renderProfile() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <Profile />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

function columnCount() {
  return screen.getByTestId('profile-columns').children.length
}

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
  statusState.status = { checkin_enabled: false }
  permissionState.sidebarSettings = true
})

afterEach(() => vi.clearAllMocks())

it('does not reserve the side column when the viewer has nothing to put in it', () => {
  // A root user has no sidebar settings to configure, and check-in is off.
  permissionState.sidebarSettings = false
  renderProfile()

  expect(columnCount()).toBe(1)
})

it('keeps the side column when the sidebar settings are configurable', () => {
  renderProfile()

  expect(columnCount()).toBe(2)
})

it('keeps the side column when check-in is enabled', () => {
  statusState.status = { checkin_enabled: true }
  permissionState.sidebarSettings = false
  renderProfile()

  expect(columnCount()).toBe(2)
})
