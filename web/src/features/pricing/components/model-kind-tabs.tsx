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

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { MODEL_KIND_ORDER, getModelKindLabels } from '../constants'
import { parseModelKind } from '../lib/filters'

type ModelKindTabsProps = {
  /** Current type tab; an unknown or missing value falls back to "all". */
  value: string
  onChange: (value: string) => void
  className?: string
}

/**
 * 模型广场顶部的类型页签：全部 / 文本 / 图片 / 视频。
 *
 * 分类依据是模型标签里的类型词，与侧栏标签筛选同源；一个模型可以同时属于
 * 多个页签（例如文本模型也能输出图片），页签只做包含判断，不做互斥归类。
 */
export function ModelKindTabs(props: ModelKindTabsProps) {
  const { t } = useTranslation()
  const labels = getModelKindLabels(t)

  return (
    <Tabs
      value={parseModelKind(props.value)}
      onValueChange={(value) => {
        if (typeof value === 'string') props.onChange(value)
      }}
      className={cn('items-center', props.className)}
    >
      <TabsList
        aria-label={t('Model type')}
        className='no-scrollbar max-w-full overflow-x-auto'
      >
        {MODEL_KIND_ORDER.map((kind) => (
          <TabsTrigger key={kind} value={kind} className='px-3'>
            {labels[kind]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
