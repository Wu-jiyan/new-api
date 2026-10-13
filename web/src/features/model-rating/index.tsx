import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { listModelRatings } from './api'
import { DimensionTab } from './components/dimension-tab'
import { SettingsTab } from './components/settings-tab'
import { DIMENSION_META, RATING_DIMENSIONS } from './constants'
import type { ModelRatingItem, RatingDimension } from './types'

const EMPTY_THRESHOLDS = { ur: 65, ssr: 55, sr: 45, r: 30 }

export default function ModelRatingPage() {
  const { t } = useTranslation()
  const [dimension, setDimension] = useState<RatingDimension>('deepswe')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<ModelRatingItem[]>([])
  const [total, setTotal] = useState(0)
  const [thresholds, setThresholds] = useState<
    Partial<Record<RatingDimension, typeof EMPTY_THRESHOLDS>>
  >({})
  const [deepsweSync, setDeepSweSync] = useState({
    last_sync_at: 0,
    last_sync_num: 0,
  })
  const [aaStatus, setAaStatus] = useState({
    last_sync_at: 0,
    last_sync_num: 0,
    api_key_set: false,
    last_error: '',
  })
  // 同步、保存阈值后递增以触发列表重新拉取，避免把刷新逻辑散进各 tab。
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    listModelRatings({ keyword, page })
      .then((res) => {
        if (cancelled) return
        setItems(res.data)
        setTotal(res.total)
        setThresholds(res.thresholds)
        setDeepSweSync(res.deepswe)
        setAaStatus(res.aa)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : t('Load failed'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [keyword, page, reloadToken, t])

  const reload = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  const changeKeyword = useCallback((value: string) => {
    setKeyword(value)
    setPage(1)
  }, [])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Model Rating')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Score models across four independent dimensions. Each dimension syncs from its own source, keeps its own thresholds, and manual entries are never overwritten.'
            )}
          </p>
          <Tabs
            value={dimension}
            onValueChange={(value) => setDimension(value as RatingDimension)}
          >
            <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
              {RATING_DIMENSIONS.map((dim) => (
                <TabsTrigger key={dim} value={dim}>
                  {DIMENSION_META[dim].label}
                </TabsTrigger>
              ))}
              <TabsTrigger value='settings'>{t('Settings')}</TabsTrigger>
            </TabsList>
            {RATING_DIMENSIONS.map((dim) => (
              <TabsContent key={dim} value={dim} className='mt-4'>
                <DimensionTab
                  dimension={dim}
                  items={items}
                  total={total}
                  page={page}
                  keyword={keyword}
                  thresholds={thresholds[dim] ?? EMPTY_THRESHOLDS}
                  deepsweSync={deepsweSync}
                  aaKeySet={aaStatus.api_key_set}
                  onKeywordChange={changeKeyword}
                  onPageChange={setPage}
                  onReload={reload}
                />
              </TabsContent>
            ))}
            <TabsContent value='settings' className='mt-4'>
              <SettingsTab aa={aaStatus} onReload={reload} />
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
