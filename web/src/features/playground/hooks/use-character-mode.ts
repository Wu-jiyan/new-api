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
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { fetchCharacter } from '@/features/character/api'
import type { CharacterView } from '@/features/character/types'

/**
 * 角色模式：根据 URL ?character= 参数加载角色。
 * 已解锁角色返回 character + 隐藏只读 systemPrompt（对话请求注入用）；
 * 角色不存在或未解锁时 toast 提示并清除 URL 参数退出角色模式。
 */
export function useCharacterMode(modelName: string) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: character, isLoading } = useQuery({
    queryKey: ['character', modelName],
    queryFn: () => fetchCharacter(modelName),
    enabled: modelName !== '',
  })

  const exitCharacterMode = () => {
    navigate({ to: '/playground', search: { character: '' }, replace: true })
  }

  useEffect(() => {
    if (!modelName || isLoading) return
    if (!character) {
      toast.error(t('character.notFound'))
      exitCharacterMode()
      return
    }
    if (character.total_calls < 1) {
      toast.error(t('character.unlockHint'))
      exitCharacterMode()
      return
    }
  }, [modelName, isLoading, character, t])

  if (!modelName) {
    return {
      character: null,
      systemPrompt: '',
      isCharacterMode: false,
      isLoading: false,
      exitCharacterMode,
    }
  }

  const unlocked = !!character && character.total_calls >= 1

  return {
    character: unlocked ? (character as CharacterView) : null,
    systemPrompt: unlocked ? (character?.system_prompt ?? '') : '',
    isCharacterMode: unlocked,
    isLoading,
    exitCharacterMode,
  }
}
