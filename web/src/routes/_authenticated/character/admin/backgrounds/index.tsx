import { createFileRoute, redirect } from '@tanstack/react-router'

import CharacterBackgroundsPage from '@/features/character-backgrounds'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/character/admin/backgrounds/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
  },
  component: CharacterBackgroundsPage,
})
