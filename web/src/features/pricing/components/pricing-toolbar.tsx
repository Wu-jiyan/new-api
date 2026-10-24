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
import { ArrowUpDown, Check, Filter, Gauge, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableViewModeToggle } from '@/components/data-table'
import {
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import {
  getScoreDimensionLabels,
  getSortLabels,
  type SortOption,
  type ViewMode,
} from '../constants'
import {
  parseSearchScopes,
  SEARCH_SCOPES,
  type SearchScope,
} from '../lib/filters'
import type { GroupSortMode } from '../lib/group-sort'
import type { ScoreDimension } from '../lib/scores'
import type { PricingModel, PricingVendor, TokenUnit } from '../types'
import { PricingSidebar, type FilterCollapseConfig } from './pricing-sidebar'

export interface PricingToolbarProps {
  filteredCount: number
  totalCount?: number
  /** Fields the search box matches; defaults to model name only */
  searchScopes?: string[]
  onSearchScopesChange?: (value: string[]) => void
  sortBy: string
  onSortChange: (value: string) => void
  /** Score dimension driving score sorting, tier badges and the tier filter */
  dimension: ScoreDimension
  onDimensionChange: (value: ScoreDimension) => void
  tokenUnit: TokenUnit
  onTokenUnitChange: (value: TokenUnit) => void
  showRechargePrice: boolean
  onRechargePriceChange: (value: boolean) => void
  /** Visitor display preference for the original price; omitted when the site disables the feature */
  showOriginalPrice?: boolean
  onOriginalPriceChange?: (value: boolean) => void
  viewMode: ViewMode
  onViewModeChange: (value: ViewMode) => void
  quotaTypeFilter: string
  endpointTypeFilter: string
  modalityFilter: string
  vendorFilter: string
  groupFilter: string
  tagFilter: string
  ratingFilter: string
  onQuotaTypeChange: (value: string) => void
  onEndpointTypeChange: (value: string) => void
  onModalityChange: (value: string) => void
  onVendorChange: (value: string) => void
  onGroupChange: (value: string) => void
  onTagChange: (value: string) => void
  onRatingChange: (value: string) => void
  vendors: PricingVendor[]
  groups: string[]
  groupRatios?: Record<string, number>
  autoGroups?: string[]
  groupSort: GroupSortMode
  onGroupSortChange: (value: GroupSortMode) => void
  tags: string[]
  models: PricingModel[]
  hasActiveFilters: boolean
  activeFilterCount: number
  onClearFilters: () => void
  /** 移动端筛选抽屉里同样按后台配置折叠长选项列表 */
  collapse?: FilterCollapseConfig
}

type PricingSearchScopeSelectProps = Pick<
  PricingToolbarProps,
  'searchScopes' | 'onSearchScopesChange'
>

/**
 * 选择搜索命中的字段，默认只有模型名，避免描述、标签与供应商名带来的误导结果。
 */
function PricingSearchScopeSelect(props: PricingSearchScopeSelectProps) {
  const { t } = useTranslation()
  const scopeLabels: Record<SearchScope, string> = {
    name: t('Search model name'),
    description: t('Search description'),
    tags: t('Search tags'),
    vendor: t('Search vendor'),
  }
  const selectedScopes = parseSearchScopes(props.searchScopes)
  // 触发按钮直接回显当前生效的范围，否则用户只能打开菜单才知道搜的是哪些字段。
  const scopeSummary =
    selectedScopes.length === 1
      ? scopeLabels[selectedScopes[0]]
      : t('Search scope · {{count}} fields', { count: selectedScopes.length })

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size='sm'
            // 可见文本回显当前生效的范围，按钮本身仍需有稳定的无障碍名称。
            aria-label={t('Search scope')}
            className='h-8 gap-1.5 px-3 text-xs'
          />
        }
      >
        <Search className='size-3.5' />
        <span className='max-w-32 truncate'>{scopeSummary}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-52'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('Search scope')}</DropdownMenuLabel>
          {SEARCH_SCOPES.map((scope) => (
            <DropdownMenuCheckboxItem
              key={scope}
              checked={selectedScopes.includes(scope)}
              onCheckedChange={(checked) => {
                const next = checked
                  ? [...selectedScopes, scope]
                  : selectedScopes.filter((item) => item !== scope)
                // 至少保留一个范围，否则搜索结果无法解释。
                props.onSearchScopesChange?.(parseSearchScopes(next))
              }}
            >
              {scopeLabels[scope]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PricingToolbar(props: PricingToolbarProps) {
  const { t } = useTranslation()
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const sortLabels = getSortLabels(t)
  const dimensionLabels = getScoreDimensionLabels(t)

  return (
    <div className='bg-card rounded-xl border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setMobileFiltersOpen(true)}
            className='gap-1.5 xl:hidden'
          >
            <Filter className='size-4' />
            {t('Filter')}
            {props.activeFilterCount > 0 && (
              <Badge className='ml-0.5 size-5 justify-center p-0 text-[10px]'>
                {props.activeFilterCount}
              </Badge>
            )}
          </Button>

          <div className='text-muted-foreground flex items-baseline gap-1 text-sm'>
            <span className='text-foreground font-semibold tabular-nums'>
              {props.filteredCount.toLocaleString()}
            </span>
            <span>{props.filteredCount === 1 ? t('model') : t('models')}</span>
            {props.totalCount != null &&
              props.filteredCount !== props.totalCount && (
                <span className='text-muted-foreground/60 text-xs'>
                  / {props.totalCount.toLocaleString()}
                </span>
              )}
          </div>
        </div>

        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <PricingSearchScopeSelect
            searchScopes={props.searchScopes}
            onSearchScopesChange={props.onSearchScopesChange}
          />
          <ToggleGroup
            value={[props.showRechargePrice ? 'recharge' : 'standard']}
            onValueChange={(values) => {
              if (values.length > 0) {
                props.onRechargePriceChange(values[0] === 'recharge')
              }
            }}
            variant='outline'
            size='sm'
            aria-label={t('Price display mode')}
          >
            <ToggleGroupItem value='standard'>{t('Standard')}</ToggleGroupItem>
            <ToggleGroupItem value='recharge'>{t('Recharge')}</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            value={[props.tokenUnit]}
            onValueChange={(values) => {
              if (values[0] === 'M' || values[0] === 'K') {
                props.onTokenUnitChange(values[0])
              }
            }}
            variant='outline'
            size='sm'
            aria-label={t('Token unit')}
          >
            <ToggleGroupItem value='M'>/1M</ToggleGroupItem>
            <ToggleGroupItem value='K'>/1K</ToggleGroupItem>
          </ToggleGroup>

          {/* A display preference, so it never touches the URL filter state. */}
          {props.onOriginalPriceChange && (
            <div className='flex items-center gap-2'>
              <Switch
                id='pricing-show-original-price'
                size='sm'
                checked={props.showOriginalPrice ?? false}
                onCheckedChange={props.onOriginalPriceChange}
                aria-label={t('Show official price')}
              />
              <Label
                htmlFor='pricing-show-original-price'
                className='text-muted-foreground text-xs font-normal'
              >
                {t('Show official price')}
              </Label>
            </div>
          )}

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-8 gap-1.5 px-3 text-xs'
                />
              }
            >
              <Gauge className='size-3.5' />
              <span>{dimensionLabels[props.dimension]}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-52'>
              <DropdownMenuGroup>
                {Object.entries(dimensionLabels).map(([value, label]) => (
                  <DropdownMenuItem
                    key={value}
                    onClick={() =>
                      props.onDimensionChange(value as ScoreDimension)
                    }
                    className='gap-2'
                  >
                    <Check
                      className={cn(
                        'size-4 shrink-0',
                        props.dimension === value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-8 gap-1.5 px-3 text-xs'
                />
              }
            >
              <ArrowUpDown className='size-3.5' />
              <span>{sortLabels[props.sortBy as SortOption] || t('Sort')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              <DropdownMenuGroup>
                {Object.entries(sortLabels).map(([value, label]) => (
                  <DropdownMenuItem
                    key={value}
                    onClick={() => props.onSortChange(value)}
                    className='gap-2'
                  >
                    <Check
                      className={cn(
                        'size-4 shrink-0',
                        props.sortBy === value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DataTableViewModeToggle
            value={props.viewMode}
            onChange={props.onViewModeChange}
          />
        </div>
      </div>

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent
          side='left'
          className={sideDrawerContentClassName('sm:max-w-md')}
        >
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>{t('Filter')}</SheetTitle>
            <SheetDescription>
              {t('Filter models by provider, group, type, endpoint, and tags.')}
            </SheetDescription>
          </SheetHeader>
          <div className={sideDrawerFormClassName('gap-0')}>
            <PricingSidebar
              quotaTypeFilter={props.quotaTypeFilter}
              endpointTypeFilter={props.endpointTypeFilter}
              modalityFilter={props.modalityFilter}
              vendorFilter={props.vendorFilter}
              groupFilter={props.groupFilter}
              tagFilter={props.tagFilter}
              ratingFilter={props.ratingFilter}
              dimension={props.dimension}
              onQuotaTypeChange={props.onQuotaTypeChange}
              onEndpointTypeChange={props.onEndpointTypeChange}
              onModalityChange={props.onModalityChange}
              onVendorChange={props.onVendorChange}
              onGroupChange={props.onGroupChange}
              onTagChange={props.onTagChange}
              onRatingChange={props.onRatingChange}
              vendors={props.vendors}
              groups={props.groups}
              groupRatios={props.groupRatios}
              autoGroups={props.autoGroups}
              groupSort={props.groupSort}
              onGroupSortChange={props.onGroupSortChange}
              tags={props.tags}
              models={props.models}
              hasActiveFilters={props.hasActiveFilters}
              onClearFilters={props.onClearFilters}
              collapse={props.collapse}
              className='border-0 bg-transparent p-0 shadow-none'
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
