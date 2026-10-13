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

import { getScoreDimensionLabels, type RATING_TIERS } from '../constants'
import {
  SCORE_DIMENSIONS,
  scoreForDimension,
  tierForDimension,
  type ScoreDimension,
} from '../lib/scores'
import type { PricingModel } from '../types'
import { RatingBadge } from './rating-badge'

const AA_SOURCE_URL = 'https://artificialanalysis.ai/'

/** 未评分维度的占位符，与页面上其它缺失数值保持一致 */
const NO_SCORE_MARKER = '—'

/**
 * 档位在纯文本（分数）场景下的配色。键取自 RATING_TIERS，与 RATING_STYLES 共用
 * 同一批档位键：角标用底色，纯文本用文字色，不另建档位表。
 */
const RATING_TEXT_STYLES: Record<(typeof RATING_TIERS)[number], string> = {
  N: 'text-slate-600 dark:text-slate-400',
  R: 'text-blue-600 dark:text-blue-400',
  SR: 'text-purple-600 dark:text-purple-400',
  SSR: 'text-amber-700 dark:text-amber-400',
  UR: 'text-pink-600 dark:text-pink-400',
}

type RatingTier = (typeof RATING_TIERS)[number]

/**
 * 模型的全部评分维度，四个维度并排成一行文字。
 *
 * 上色只落在分数上：分数按各自维度的档位着色，维度名只用来区分当前维度（正文色）
 * 与其它维度（弱化色）。维度块不可点击——切换维度由模型广场工具栏的维度选择器负责，
 * 卡片与详情页只负责把当前维度的口径清楚地显示出来。
 */
export function ModelScores(props: {
  model: PricingModel
  dimension: ScoreDimension
  /** 详情页显示档位角标；模型广场卡片保持纯文字，避免视觉噪音 */
  showBadge?: boolean
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
    <dl
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1',
        props.className
      )}
    >
      {SCORE_DIMENSIONS.map((dim) => {
        const score = scoreForDimension(props.model, dim)
        const tier = tierForDimension(props.model, dim) as RatingTier
        const scored = score > 0
        const active = dim === props.dimension
        return (
          <div key={dim} className='flex items-baseline gap-1'>
            <dt
              className={cn(
                'text-[11px]',
                active ? 'text-foreground font-medium' : 'text-muted-foreground'
              )}
            >
              {labels[dim]}
            </dt>
            <dd className='flex items-baseline gap-1'>
              <span
                className={cn(
                  'font-mono text-[11px] tabular-nums',
                  scored
                    ? (RATING_TEXT_STYLES[tier] ?? 'text-foreground')
                    : 'text-muted-foreground'
                )}
              >
                {scored ? formatNumber(score, locale) : NO_SCORE_MARKER}
              </span>
              {props.showBadge && <RatingBadge rating={scored ? tier : ''} />}
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