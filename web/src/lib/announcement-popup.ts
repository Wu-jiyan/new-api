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
import type { AnnouncementPopup } from '@/features/auth/types'

/**
 * Revision identity of the popup announcement.
 *
 * A visitor who chose "do not show again" is muted for this exact revision, so
 * editing the announcement's content pops it up again for everyone, while
 * re-dating the same announcement keeps it muted.
 *
 * Returns an empty string when there is nothing to show.
 */
export function getAnnouncementPopupRevision(
  announcement: AnnouncementPopup | null | undefined
): string {
  const content = announcement?.content?.trim()
  if (!content) return ''

  return JSON.stringify([
    announcement?.id ?? null,
    content,
    announcement?.extra?.trim() ?? '',
    announcement?.type ?? '',
  ])
}
