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
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, expect, it } from 'vitest'

import type { CharacterView } from '@/features/character/types'
import { api } from '@/lib/api'
import { useAuthStore, type AuthBundle } from '@/stores/auth-store'

import { useCharacterMap } from '../hooks/use-character-map'
import type { PricingModel } from '../types'

const originalAdapter = api.defaults.adapter

afterEach(() => {
  api.defaults.adapter = originalAdapter
  useAuthStore.getState().auth.reset()
})

function createWrapper(client: QueryClient) {
  return function Wrapper(props: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, props.children)
  }
}

function model(modelName: string): PricingModel {
  return {
    id: 1,
    model_name: modelName,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
  }
}

function character(modelName: string, displayName: string): CharacterView {
  return {
    id: 1,
    model_name: modelName,
    display_name: displayName,
    max_stage: 1,
    affinity: 0,
    affinity_required: 0,
    total_tokens: 0,
    total_calls: 0,
    stages: [],
  }
}

function signedInBundle(): AuthBundle {
  return {
    access_token: 'access',
    token_type: 'Bearer',
    access_expires_at: 2_000_000_000,
    user: { id: 1, username: 'test-user', role: 1 },
    session: {
      sid: 'test-session',
      current: true,
      login_method: 'password',
      ip: '',
      user_agent: '',
      created_at: 1,
      last_active_at: 1,
      expires_at: 2_000_000_000,
    },
  }
}

/** Serve the real character endpoint and record which URLs the hook requested. */
function stubCharacters(characters: CharacterView[]): string[] {
  const requested: string[] = []
  api.defaults.adapter = async (config) => {
    requested.push(String(config.url))
    return {
      data: { success: true, data: characters },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  return requested
}

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

it('does not request the session-scoped character list for a visitor who is not signed in', async () => {
  const requested = stubCharacters([character('deepseek', 'DeepSeek')])
  const { result } = renderHook(
    () => useCharacterMap([model('deepseek-chat')]),
    { wrapper: createWrapper(createClient()) }
  )

  await act(async () => {})

  expect(requested).toEqual([])
  expect(result.current.size).toBe(0)
})

it('maps each model to its longest matching character prefix once signed in', async () => {
  useAuthStore.getState().auth.setBundle(signedInBundle())
  const requested = stubCharacters([
    character('deepseek', 'DeepSeek'),
    character('deepseek-r1', 'DeepSeek R1'),
    character('gpt', 'GPT'),
  ])
  const { result } = renderHook(
    () =>
      useCharacterMap([
        model('deepseek-r1-distill'),
        model('deepseek-chat'),
        model('claude-3'),
      ]),
    { wrapper: createWrapper(createClient()) }
  )

  await waitFor(() => expect(result.current.size).toBe(2))

  expect(requested).toEqual(['/api/character/characters'])
  expect(result.current.get('deepseek-r1-distill')?.display_name).toBe(
    'DeepSeek R1'
  )
  expect(result.current.get('deepseek-chat')?.display_name).toBe('DeepSeek')
  expect(result.current.has('claude-3')).toBe(false)
})
