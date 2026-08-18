import { createFileRoute } from '@tanstack/react-router'

import GachaPage from '@/features/gacha'

export const Route = createFileRoute('/_authenticated/gacha/')({
  component: GachaPage,
})
