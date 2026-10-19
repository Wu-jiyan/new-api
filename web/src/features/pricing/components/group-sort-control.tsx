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
import { ArrowUpDown, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import {
  GROUP_SORT_MODES,
  getGroupSortLabels,
  type GroupSortMode,
} from '../lib/group-sort'

/**
 * 分组排序选择器。模型广场左栏的分组筛选与模型详情的分组价格表共用，
 * 两处用同一套排序逻辑，避免出现「侧栏一种顺序、详情另一种顺序」。
 */
export function GroupSortControl(props: {
  value: GroupSortMode
  onChange: (value: GroupSortMode) => void
  className?: string
}) {
  const { t } = useTranslation()
  const labels = getGroupSortLabels(t)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size='sm'
            aria-label={t('Group order')}
            className={cn('h-7 gap-1.5 px-2 text-xs', props.className)}
          />
        }
      >
        <ArrowUpDown className='size-3.5' />
        <span className='max-w-36 truncate'>{labels[props.value]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-56'>
        <DropdownMenuGroup>
          {GROUP_SORT_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode}
              onClick={() => props.onChange(mode)}
              className='gap-2'
            >
              <Check
                className={cn(
                  'size-4 shrink-0',
                  props.value === mode ? 'opacity-100' : 'opacity-0'
                )}
              />
              {labels[mode]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {props.value === 'auto' && (
          <p className='text-muted-foreground border-t px-2 py-1.5 text-[11px]'>
            {t(
              'Groups in the auto group chain come first in chain order; the rest are listed last by name.'
            )}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
