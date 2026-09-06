import { createFileRoute, redirect } from '@tanstack/react-router'

import CharacterEditorPage from '@/features/character-admin/editor'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/character/admin/characters/$modelName')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
  },
  component: CharacterEditorPage,
})
