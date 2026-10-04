import { createFileRoute } from '@tanstack/react-router'

import GachaEntitlementsPage from '@/features/gacha-entitlements'

export const Route = createFileRoute('/_authenticated/gacha/cards/')({
  component: GachaEntitlementsPage,
})
