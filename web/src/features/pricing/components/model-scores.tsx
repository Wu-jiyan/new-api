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
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'

import { getScoreDimensionLabels } from '../constants'
import { SCORE_DIMENSIONS, scoreForDimension } from '../lib/scores'
import type { PricingModel } from '../types'

const AA_SOURCE_URL = 'https://artificialanalysis.ai/'

/**
 * 模型的全部评分维度。四个维度始终并排展示，未评分的显示为破折号；
 * 当前选中维度加粗并带下划线，便于对照角标与档位筛选。
 */
export function ModelScores(props: {
  model: PricingModel
  dimension: string
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const labels = getScoreDimensionLabels(t)
  const hasAnyScore = SCORE_DIMENSIONS.some(
    (dim) => scoreForDimension(props.model, dim) > 0
  )
  if (!hasAnyScore) return null

  return (
    <dl className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', props.className)}>
      {SCORE_DIMENSIONS.map((dim) => {
        const score = scoreForDimension(props.model, dim)
        const active = dim === props.dimension
        return (
          <div key={dim} className='flex items-baseline gap-1'>
            <dt
              className={cn(
                'text-[11px]',
                active
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground'
              )}
            >
              {labels[dim]}
            </dt>
            <dd
              className={cn(
                'font-mono text-[11px] tabular-nums',
                active ? 'text-foreground font-semibold' : 'text-muted-foreground'
              )}
            >
              {score > 0 ? formatNumber(score, locale) : '—'}
            </dd>
          </div>
        )
      })}
      {props.model.aa_source && (
        <a
          href={AA_SOURCE_URL}
          target='_blank'
          rel='noreferrer'
          className='text-muted-foreground text-[11px] underline-offset-2 hover:underline'
        >
          {t('Artificial Analysis')}
        </a>
      )}
    </dl>
  )
}