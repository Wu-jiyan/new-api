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
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchCharacters } from '@/features/character/api'
import type { CharacterView } from '@/features/character/types'
import { useAuthStore } from '@/stores/auth-store'

import type { PricingModel } from '../types'

/**
 * Character portraits for the model square's cards.
 *
 * The character list is user-scoped and its endpoint requires a session, so a
 * guest never requests it: the model square is public, and a rejected request
 * there would be handled as an expired session instead of a page a visitor may
 * see.
 */
export function useCharacterMap(
  models: PricingModel[]
): ReadonlyMap<string, CharacterView> {
  const isAuthenticated = useAuthStore((state) => Boolean(state.auth.user))

  const { data: characters } = useQuery({
    queryKey: ['characters'],
    queryFn: fetchCharacters,
    enabled: isAuthenticated,
    retry: false,
    staleTime: 60 * 1000,
  })

  return useMemo(() => {
    // 角色 model_name 为前缀（如 deepseek），匹配该前缀下所有模型；多个角色覆盖同一模型时取最长前缀。
    const map = new Map<string, CharacterView>()
    for (const model of models) {
      let best: CharacterView | null = null
      let bestLength = -1
      for (const character of characters ?? []) {
        const prefix = character.model_name
        const matches =
          model.model_name === prefix ||
          model.model_name.startsWith(`${prefix}-`) ||
          model.model_name.startsWith(`${prefix}/`) ||
          model.model_name.startsWith(`${prefix}.`)
        if (matches && prefix.length > bestLength) {
          bestLength = prefix.length
          best = character
        }
      }
      if (best) map.set(model.model_name, best)
    }
    return map
  }, [characters, models])
}
