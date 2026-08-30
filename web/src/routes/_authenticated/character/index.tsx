import { createFileRoute } from '@tanstack/react-router'

import CharacterGalleryPage from '@/features/character/gallery'

export const Route = createFileRoute('/_authenticated/character/')({
  component: CharacterGalleryPage,
})
