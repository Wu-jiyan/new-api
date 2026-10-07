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
import { useNotice } from '@/hooks/use-notice'
import { useStatus } from '@/hooks/use-status'
import { useNotificationStore } from '@/stores/notification-store'

/**
 * Site-wide popup for the notice configured under 站点与品牌 -> 系统公告.
 *
 * Two ways out, matching the notice contract:
 * - closing dismisses it for this page session only, so a reload shows it again;
 * - "do not show again" mutes the current notice text until the notice is
 *   edited, which opens the popup again for every visitor.
 */
export function NoticePopup() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { notice } = useNotice()
  const mutedNotice = useNotificationStore((state) => state.mutedNotice)
  const muteNotice = useNotificationStore((state) => state.muteNotice)
  const [dismissedNotice, setDismissedNotice] = useState('')

  // Derived, so an edited notice opens the popup again on its own while a
  // closed or muted notice stays closed.
  const open =
    status?.notice_popup_enabled === true &&
    notice !== '' &&
    notice !== mutedNotice &&
    notice !== dismissedNotice

  if (notice === '') return null

  const dismissForNow = () => {
    setDismissedNotice(notice)
  }

  const muteCurrentNotice = () => {
    muteNotice(notice)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismissForNow()
      }}
      title={t('System Notice')}
      contentClassName='sm:max-w-lg'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button type='button' variant='outline' onClick={muteCurrentNotice}>
            {t('Do not show again')}
          </Button>
          <Button type='button' onClick={dismissForNow}>
            {t('Close')}
          </Button>
        </>
      }
    >
      <ScrollArea className='max-h-[min(58vh,520px)] pr-4'>
        <RichContent breaks content={notice} />
      </ScrollArea>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Choose "Do not show again" to hide this notice until it is updated.'
        )}
      </p>
    </Dialog>
  )
}
