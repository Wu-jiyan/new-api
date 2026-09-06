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
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundInput } from './components/input/playground-input'
import {
  useCharacterMode,
  useChatHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'

export function Playground() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { character: characterName } = useSearch({
    from: '/_authenticated/playground/',
  })
  const {
    character,
    systemPrompt,
    isCharacterMode,
    isLoading: isLoadingCharacter,
    exitCharacterMode,
  } = useCharacterMode(characterName)

  const {
    config,
    parameterEnabled,
    messages,
    isLoadingMessages,
    models,
    groups,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    clearMessages,
  } = usePlaygroundState()

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    systemPrompt,
    onMessageUpdate: updateMessages,
  })

  const {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  } = usePlaygroundConversation({
    messages,
    updateMessages,
    sendChat,
  })

  const handleClearMessages = () => {
    handleEditOpenChange(false)
    clearMessages()
  }

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  // 角色模式：模型列表限定为角色前缀（如 deepseek → deepseek*）
  const displayModels = useMemo(() => {
    if (!isCharacterMode || !character) return models
    const prefix = character.model_name
    return models.filter((m) => m.value.startsWith(prefix))
  }, [isCharacterMode, character, models])

  // 角色模式：当前模型不在前缀内时自动选中第一个匹配模型
  useEffect(() => {
    if (!isCharacterMode || !character || displayModels.length === 0) return
    if (!config.model || !displayModels.some((m) => m.value === config.model)) {
      updateConfig('model', displayModels[0].value)
    }
  }, [isCharacterMode, character, displayModels, config.model, updateConfig])

  return (
    <div className='relative flex size-full min-h-0 flex-col overflow-hidden'>
      {/* Full-width scroll container: scrolling works even over side whitespace */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        {isLoadingCharacter ? (
          <div className='mx-auto flex w-full max-w-4xl items-center gap-2 px-1 py-3 text-sm text-muted-foreground'>
            <Sparkles className='size-4 animate-pulse' />
            {t('playground.loadingCharacter')}
          </div>
        ) : isCharacterMode && character ? (
          <div className='bg-muted/40 mx-auto mt-2 flex w-full max-w-4xl items-center justify-between gap-3 rounded-lg border px-3 py-2'>
            <div className='flex min-w-0 items-center gap-2 text-sm'>
              <Sparkles className='text-primary size-4 shrink-0' />
              <span className='truncate'>
                {t('playground.characterMode', {
                  name: character.display_name,
                })}
              </span>
            </div>
            <Button
              variant='ghost'
              size='sm'
              className='shrink-0'
              onClick={() => {
                exitCharacterMode()
                void navigate({ to: '/playground', search: { character: '' } })
              }}
            >
              {t('playground.exitCharacterMode')}
            </Button>
          </div>
        ) : null}
        <PlaygroundChat
          messages={messages}
          isLoadingMessages={isLoadingMessages}
          onRegenerateMessage={handleRegenerateMessage}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onSelectPrompt={handleSendMessage}
          isGenerating={isGenerating}
          editingKey={editingMessageKey}
          onCancelEdit={handleEditOpenChange}
          onSaveEdit={(newContent) => applyEdit(newContent, false)}
          onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
        />
      </div>

      {/* Input area: center content and constrain to the same container width */}
      <div className='mx-auto w-full max-w-4xl'>
        <PlaygroundInput
          config={config}
          disabled={isGenerating}
          groups={groups}
          groupValue={config.group}
          isGenerating={isGenerating}
          isModelLoading={isLoadingModels}
          modelValue={config.model}
          models={displayModels}
          onGroupChange={(value) => updateConfig('group', value)}
          onConfigChange={updateConfig}
          onClearMessages={handleClearMessages}
          onModelChange={(value) => updateConfig('model', value)}
          onParameterEnabledChange={updateParameterEnabled}
          onStop={stopGeneration}
          onSubmit={handleSendMessage}
          parameterEnabled={parameterEnabled}
          hasMessages={messages.length > 0}
        />
      </div>
    </div>
  )
}
