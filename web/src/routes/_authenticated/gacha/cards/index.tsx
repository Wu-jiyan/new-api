import { createFileRoute } from '@tanstack/react-router'

import GachaCardsPage from '@/features/gacha-cards'

export const Route = createFileRoute('/_authenticated/gacha/cards/')({
  component: GachaCardsPage,
})
