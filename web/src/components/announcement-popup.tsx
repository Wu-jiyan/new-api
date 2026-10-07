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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useStatus } from '@/hooks/use-status'
import { getAnnouncementPopupRevision } from '@/lib/announcement-popup'
import { formatDateTimeObject } from '@/lib/time'
import { useNotificationStore } from '@/stores/notification-store'

/**
 * Site-wide popup for the system announcement the administrator marked.
 *
 * Two ways out, matching the announcement contract:
 * - closing dismisses it for this page session only, so a reload shows it again;
 * - "do not show again" mutes the current announcement revision until its
 *   content is updated, which opens the popup again for every visitor.
 */
export function AnnouncementPopup() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const mutedRevision = useNotificationStore(
    (state) => state.mutedAnnouncementRevision
  )
  const muteAnnouncementPopup = useNotificationStore(
    (state) => state.muteAnnouncementPopup
  )
  const [dismissedRevision, setDismissedRevision] = useState('')

  const announcement = status?.announcement_popup ?? null
  const revision = getAnnouncementPopupRevision(announcement)

  // Derived, so an updated announcement opens the popup again on its own while a
  // closed or muted revision stays closed.
  const open =
    status?.announcement_popup_enabled === true &&
    revision !== '' &&
    revision !== mutedRevision &&
    revision !== dismissedRevision

  if (!announcement) return null

  const dismissForNow = () => {
    setDismissedRevision(revision)
  }

  const muteRevision = () => {
    muteAnnouncementPopup(revision)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismissForNow()
      }}
      title={t('System Announcement')}
      description={
        announcement.publishDate
          ? `${t('Published:')} ${formatDateTimeObject(new Date(announcement.publishDate))}`
          : undefined
      }
      contentClassName='sm:max-w-lg'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button type='button' variant='outline' onClick={muteRevision}>
            {t('Do not show again')}
          </Button>
          <Button type='button' onClick={dismissForNow}>
            {t('Close')}
          </Button>
        </>
      }
    >
      <ScrollArea className='max-h-[min(58vh,520px)] pr-4'>
        <div className='space-y-4'>
          <RichContent breaks content={announcement.content} />
          {announcement.extra ? (
            <RichContent
              breaks
              content={announcement.extra}
              className='text-muted-foreground'
            />
          ) : null}
        </div>
      </ScrollArea>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Choose "Do not show again" to hide this announcement until it is updated.'
        )}
      </p>
    </Dialog>
  )
}
