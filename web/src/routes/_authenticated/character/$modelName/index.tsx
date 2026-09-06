import { createFileRoute } from '@tanstack/react-router'

import CharacterDetailPage from '@/features/character'

export const Route = createFileRoute('/_authenticated/character/$modelName/')({
  component: CharacterDetailPage,
})
