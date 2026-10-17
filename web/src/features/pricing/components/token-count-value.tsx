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
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTokenCountDisplayStore } from '@/stores/token-count-display-store'

import { formatCatalogTokenCount } from '../lib/catalog-metadata'

/**
 * 一个 token 数量：默认紧凑写法（1M / 128K），点一下换成带千分位的精确值
 * （1,000,000 / 128,000）。两种口径的切换是全局的，见 token-count-display-store。
 *
 * 未配置（0 / undefined）时不渲染任何东西 —— 空值不能伪装成「0 token」。
 */
export function TokenCountValue(props: {
  tokens?: number
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const expanded = useTokenCountDisplayStore((state) => state.expanded)
  const toggle = useTokenCountDisplayStore((state) => state.toggleExpanded)

  const compact = formatCatalogTokenCount(props.tokens, locale)
  if (compact === '' || props.tokens === undefined) return null

  return (
    <button
      type='button'
      onClick={toggle}
      aria-pressed={expanded}
      title={
        expanded
          ? t('Show the compact token count')
          : t('Show the exact token count')
      }
      className={cn(
        'cursor-pointer underline-offset-2 tabular-nums hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        props.className
      )}
    >
      {expanded ? formatNumber(props.tokens, locale) : compact}
    </button>
  )
}
