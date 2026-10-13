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

import { Button } from '@/components/ui/button'
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
 * 档位在纯文本（维度标签）场景下的配色。键取自 RATING_TIERS，与 RATING_STYLES
 * 共用同一批档位键：角标继续用底色，这里只补文本色，不另建档位表。
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
 * 模型的全部评分维度。四个维度各自成块并排展示：标签与档位同色，未评分的维度
 * 仍然可见但显示占位符，当前选中维度用边框加底色区分（不依赖颜色单独表意）。
 * 传入 onDimensionChange 时每块是可聚焦按钮，点击或键盘激活即切换当前维度；
 * 否则渲染为不可交互的静态块。
 */
export function ModelScores(props: {
  model: PricingModel
  dimension: ScoreDimension
  onDimensionChange?: (dim: ScoreDimension) => void
  /**
   * 是否显示「点击切换维度」的提示。列表里每张卡片都会渲染这一行，重复二十次
   * 会淹没信息密度，因此卡片传 false，提示由工具栏统一出现一次。
   */
  showHint?: boolean
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
    <div className={cn('flex min-w-0 flex-col gap-1', props.className)}>
      <div className='flex min-w-0 flex-wrap items-start gap-1'>
        {SCORE_DIMENSIONS.map((dim) => {
          const score = scoreForDimension(props.model, dim)
          const tier = tierForDimension(props.model, dim)
          const scored = score > 0
          const selected = dim === props.dimension
          const tierTextClass = RATING_TEXT_STYLES[tier as RatingTier]
          const blockClass = cn(
            'flex min-w-0 max-w-full flex-col rounded-md border px-1.5 py-1',
            selected ? 'border-foreground/40 bg-muted/60' : 'border-border/60'
          )
          const blockContent = (
            <>
              <span
                className={cn(
                  'max-w-full truncate text-[10px] leading-4 font-medium tracking-wide whitespace-nowrap uppercase',
                  scored && tierTextClass
                    ? tierTextClass
                    : 'text-muted-foreground'
                )}
              >
                {labels[dim]}
              </span>
              <span className='flex items-center gap-1'>
                <span className='font-mono text-[11px] leading-4 font-semibold tabular-nums'>
                  {scored ? formatNumber(score, locale) : NO_SCORE_MARKER}
                </span>
                <RatingBadge rating={scored ? tier : ''} />
              </span>
            </>
          )

          if (!props.onDimensionChange) {
            return (
              <div
                key={dim}
                className={blockClass}
                aria-current={selected ? 'true' : undefined}
              >
                {blockContent}
              </div>
            )
          }

          return (
            <Button
              key={dim}
              type='button'
              variant='ghost'
              size='xs'
              aria-pressed={selected}
              disabled={!scored}
              title={scored ? undefined : t('No score')}
              className={cn(
                blockClass,
                'h-auto w-max gap-0.5 whitespace-normal'
              )}
              onClick={(event) => {
                event.stopPropagation()
                props.onDimensionChange?.(dim)
              }}
            >
              {blockContent}
            </Button>
          )
        })}
        {props.model.aa_source && (
          <a
            href={AA_SOURCE_URL}
            target='_blank'
            rel='noreferrer'
            className='text-muted-foreground self-center text-[11px] underline-offset-2 hover:underline'
          >
            {t('Artificial Analysis')}
          </a>
        )}
      </div>
      {props.onDimensionChange && props.showHint !== false && (
        <p className='text-muted-foreground/70 text-[10px] leading-4'>
          {t('Click a score to switch dimension')}
        </p>
      )}
    </div>
  )
}
