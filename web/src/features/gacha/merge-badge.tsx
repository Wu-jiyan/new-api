import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { MERGE_BADGE_META } from './level'
import { mergeBadgeOf } from './types'

/** 合并徽标组件：展示当前等级图标与累计抽中次数。 */
export function MergeBadgeView({
  count,
  className,
  showCount = true,
}: {
  count?: number
  className?: string
  showCount?: boolean
}) {
  const { t } = useTranslation()
  const badge = mergeBadgeOf(count)
  if (!badge) return null
  const meta = MERGE_BADGE_META[badge]
  const Icon = meta.icon
  const merged = Math.max(count ?? 1, 1)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground',
        className
      )}
    >
      <Icon className={cn('size-3.5', meta.className)} />
      {showCount && <span>{t('Merged {{count}} times', { count: merged })}</span>}
    </span>
  )
}