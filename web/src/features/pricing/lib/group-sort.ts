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
import type { TFunction } from 'i18next'

/**
 * 分组排序方式。默认 `auto`（自动分组链顺序）——没有分组链时它退化成字母序，
 * 因此任何情况下结果都是确定的，不会再出现「每次刷新顺序都不同」。
 */
export const GROUP_SORT_MODES = [
  'auto',
  'name',
  'ratio-asc',
  'ratio-desc',
] as const

export type GroupSortMode = (typeof GROUP_SORT_MODES)[number]

export function isGroupSortMode(value: unknown): value is GroupSortMode {
  return (
    typeof value === 'string' &&
    (GROUP_SORT_MODES as readonly string[]).includes(value)
  )
}

export function getGroupSortLabels(t: TFunction): Record<GroupSortMode, string> {
  return {
    auto: t('Auto group chain'),
    name: t('Group name (A-Z)'),
    'ratio-asc': t('Group ratio: low to high'),
    'ratio-desc': t('Group ratio: high to low'),
  }
}

/** 分组是否在自动分组链里。链上顺序即用户在分组链中配置的先后。 */
export function isAutoChainedGroup(
  group: string,
  autoGroups: readonly string[]
): boolean {
  return autoGroups.includes(group)
}

function compareGroupName(a: string, b: string): number {
  return a.localeCompare(b)
}

/**
 * 按指定方式排列分组。所有模式都以字母序兜底，保证同倍率 / 链外的分组
 * 也有确定次序，而不是取决于后端 map 的遍历顺序。
 */
export function sortGroups(
  groups: readonly string[],
  mode: GroupSortMode,
  context: {
    autoGroups?: readonly string[]
    groupRatios?: Record<string, number>
  }
): string[] {
  const sorted = [...groups]
  const autoGroups = context.autoGroups ?? []
  const groupRatios = context.groupRatios ?? {}
  const ratioOf = (group: string) => {
    const ratio = groupRatios[group]
    return typeof ratio === 'number' && Number.isFinite(ratio) ? ratio : 1
  }

  if (mode === 'auto') {
    // 链内按分组链顺序，链外一律排到最后，彼此之间按字母序
    sorted.sort((a, b) => {
      const rankA = autoGroups.indexOf(a)
      const rankB = autoGroups.indexOf(b)
      const chainedA = rankA !== -1
      const chainedB = rankB !== -1
      if (chainedA && chainedB) return rankA - rankB
      if (chainedA) return -1
      if (chainedB) return 1
      return compareGroupName(a, b)
    })
    return sorted
  }

  if (mode === 'ratio-asc' || mode === 'ratio-desc') {
    const direction = mode === 'ratio-asc' ? 1 : -1
    sorted.sort((a, b) => {
      const diff = (ratioOf(a) - ratioOf(b)) * direction
      return diff !== 0 ? diff : compareGroupName(a, b)
    })
    return sorted
  }

  sorted.sort(compareGroupName)
  return sorted
}