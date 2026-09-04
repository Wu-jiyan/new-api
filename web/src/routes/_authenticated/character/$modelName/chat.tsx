import { createFileRoute } from '@tanstack/react-router'

import CharacterChatPage from '@/features/character/chat'

export const Route = createFileRoute('/_authenticated/character/$modelName/chat')({
  component: CharacterChatPage,
})
