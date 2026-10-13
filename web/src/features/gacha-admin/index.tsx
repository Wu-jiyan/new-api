import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, Trash2, TrendingUp, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { MultiSelect, type Option } from '@/components/multi-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
// 模型分级已独立成页，卡池条目仍需要读取 DeepSWE 档位用于模型选择提示与展示。
import { listModelRatings } from '@/features/model-rating/api'
import type { ModelRatingItem } from '@/features/model-rating/types'
import { RatingBadge } from '@/features/pricing/components/rating-badge'
import { formatQuotaWithCurrency } from '@/lib/currency'

import {
  createPool,
  deleteEntry,
  deletePool,
  fetchEconomics,
  generateEntries,
  generatePreview,
  listPools,
  updatePool,
  upsertEntry,
} from './api'
import type {
  GachaCardEntry,
  GachaPool,
  GenerateGachaPreview,
  PoolEconomics,
} from './types'

const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR']

const DEFAULT_WEIGHTS: Record<string, number> = { N: 100, R: 40, SR: 15, SSR: 5, UR: 1 }
const DEFAULT_QUOTA_MIN: Record<string, number> = { N: 500, R: 800, SR: 1500, SSR: 3000, UR: 8000 }
const DEFAULT_QUOTA_MAX: Record<string, number> = { N: 800, R: 1500, SR: 3000, SSR: 8000, UR: 20000 }

function PoolEditor(props: { pool?: GachaPool; onClose: () => void; onSaved: () => void }) {
  const { pool, onClose, onSaved } = props
  const [form, setForm] = useState<Partial<GachaPool>>(
    pool ?? {
      name: '',
      description: '',
      price: 0,
      ten_price: 0,
      enabled: true,
      sort_order: 0,
      pity_enabled: false,
      pity_max: 0,
      pity_rarity: '',
      pity_uprate: 0,
      ten_guarantee: '',
    }
  )
  const [economics, setEconomics] = useState<PoolEconomics | null>(null)

  useEffect(() => {
    if (pool) void fetchEconomics(pool.id).then(setEconomics).catch(() => setEconomics(null))
  }, [pool])

  async function save() {
    try {
      if (pool) await updatePool(pool.id, form)
      else await createPool(form)
      toast.success('卡池已保存')
      onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{pool ? `编辑卡池 ${pool.name}` : '新建卡池'}</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label>名称</Label>
              <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className='space-y-1.5'>
              <Label>排序</Label>
              <Input type='number' value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
            </div>
          </div>
          <div className='space-y-1.5'>
            <Label>描述</Label>
            <Input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label>单抽价格 (quota)</Label>
              <Input type='number' value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
            </div>
            <div className='space-y-1.5'>
              <Label>十连价格 (quota)</Label>
              <Input type='number' value={form.ten_price ?? 0} onChange={(e) => setForm({ ...form, ten_price: Number(e.target.value) })} />
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <Switch checked={form.enabled ?? true} onCheckedChange={(checked) => setForm({ ...form, enabled: checked })} />
            <Label>启用</Label>
          </div>
          <div className='flex items-center gap-2'>
            <Switch checked={form.pity_enabled ?? false} onCheckedChange={(checked) => setForm({ ...form, pity_enabled: checked })} />
            <Label>启用硬保底</Label>
          </div>
          {(form.pity_enabled ?? false) && (
            <div className='grid grid-cols-3 gap-3'>
              <div className='space-y-1.5'>
                <Label>保底抽数</Label>
                <Input type='number' value={form.pity_max ?? 0} onChange={(e) => setForm({ ...form, pity_max: Number(e.target.value) })} />
              </div>
              <div className='space-y-1.5'>
                <Label>保底档位</Label>
                <Select
                  items={RARITIES.map((r) => ({ value: r, label: r }))}
                  value={form.pity_rarity ?? ''}
                  onValueChange={(v) => setForm({ ...form, pity_rarity: v ?? '' })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='选择档位' />
                  </SelectTrigger>
                  <SelectContent>
                    {RARITIES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1.5'>
                <Label>UR 升级概率</Label>
                <Input type='number' step='0.01' value={form.pity_uprate ?? 0} onChange={(e) => setForm({ ...form, pity_uprate: Number(e.target.value) })} />
              </div>
            </div>
          )}
          <div className='space-y-1.5'>
            <Label>十连软保底档位</Label>
            <Select
              items={[{ value: '', label: '不启用' }, ...RARITIES.map((r) => ({ value: r, label: r }))]}
              value={form.ten_guarantee ?? ''}
              onValueChange={(v) => setForm({ ...form, ten_guarantee: v ?? '' })}
            >
              <SelectTrigger>
                <SelectValue placeholder='不启用' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=''>不启用</SelectItem>
                {RARITIES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {economics && pool && (
            <div className='space-y-2 rounded-xl border p-3 text-xs'>
              <div className='flex items-center gap-1.5 font-semibold'>
                <TrendingUp className='size-3.5' /> 经济测算
              </div>
              <div className='grid grid-cols-2 gap-2'>
                <span className='text-muted-foreground'>期望价值</span>
                <span className='text-right font-mono'>{formatQuotaWithCurrency(economics.expected_value)}</span>
                <span className='text-muted-foreground'>回报率 RTP</span>
                <span className='text-right font-mono'>{(economics.rtp * 100).toFixed(1)}%</span>
                <span className='text-muted-foreground'>期望成本</span>
                <span className='text-right font-mono'>{formatQuotaWithCurrency(economics.expected_cost)}</span>
                <span className='text-muted-foreground'>预计利润</span>
                <span className='text-right font-mono'>{formatQuotaWithCurrency(economics.profit_est)}</span>
              </div>
              {economics.warn && <p className='text-destructive'>⚠ {economics.warn_reason}</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EntryEditor(props: { poolId: number; entry?: GachaCardEntry; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { poolId, entry, onClose, onSaved } = props
  const [form, setForm] = useState<GachaCardEntry>(
    entry ?? { pool_id: poolId, models: '', group: '', weight: 1, quota: 0, quota_min: 0, quota_max: 0, expire_days: 0 }
  )
  const [modelOptions, setModelOptions] = useState<Option[]>([])

  const selectedModels = useMemo(
    () =>
      form.models
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    [form.models]
  )

  useEffect(() => {
    void listModelRatings({ page: 1, pageSize: 100 })
      .then((result) =>
        setModelOptions(
          result.data.map((model) => ({
            label: model.model_name,
            value: model.model_name,
            hint: model.rating,
          }))
        )
      )
      .catch(() => undefined)
  }, [])

  async function save() {
    if (selectedModels.length === 0) {
      toast.error(t('Select at least one model'))
      return
    }
    try {
      await upsertEntry(poolId, { ...form, models: selectedModels.join(',') })
      toast.success(t('Entry saved'))
      onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Save failed'))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {entry ? t('Edit entry') : t('Add entry')}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label>{t('Model range')}</Label>
            <MultiSelect
              options={modelOptions}
              selected={selectedModels}
              onChange={(values) => setForm({ ...form, models: values.join(',') })}
              placeholder={t('Select models granted by this entry')}
              emptyText={t('No models found')}
              allowCreate
              createLabel={t('Add "{{value}}"')}
            />
            <p className='text-xs text-muted-foreground'>
              {t(
                'Pulling grants one entitlement limited to these models. Pulling the same range again stacks onto the same entitlement.'
              )}
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label>{t('Group')}</Label>
            <Input value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
          </div>
          <div className='grid grid-cols-3 gap-3'>
            <div className='space-y-1.5'>
              <Label>{t('Weight')}</Label>
              <Input type='number' value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
            </div>
            <div className='space-y-1.5'>
              <Label>{t('Base quota')}</Label>
              <Input type='number' value={form.quota} onChange={(e) => setForm({ ...form, quota: Number(e.target.value) })} />
            </div>
            <div className='space-y-1.5'>
              <Label>{t('Expire days')}</Label>
              <Input type='number' value={form.expire_days} onChange={(e) => setForm({ ...form, expire_days: Number(e.target.value) })} />
            </div>
            <div className='space-y-1.5'>
              <Label>{t('Quota min (random)')}</Label>
              <Input type='number' value={form.quota_min ?? 0} onChange={(e) => setForm({ ...form, quota_min: Number(e.target.value) })} />
            </div>
            <div className='space-y-1.5'>
              <Label>{t('Quota max (random)')}</Label>
              <Input type='number' value={form.quota_max ?? 0} onChange={(e) => setForm({ ...form, quota_max: Number(e.target.value) })} />
            </div>
          </div>
          {(form.quota_max ?? 0) > (form.quota_min ?? 0) && (
            <p className='text-xs text-muted-foreground'>
              {t('Quota is random between {{min}} and {{max}} on each pull', {
                min: form.quota_min,
                max: form.quota_max,
              })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GenerateEntriesDialog(props: { pool: GachaPool; onClose: () => void; onSaved: () => void }) {
  const { pool, onClose, onSaved } = props
  const [group, setGroup] = useState('default')
  const [expireDays, setExpireDays] = useState(30)
  const [keyword, setKeyword] = useState('')
  const [ratingFilter, setRatingFilter] = useState('')
  const [models, setModels] = useState<ModelRatingItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [weights, setWeights] = useState<Record<string, number>>({ ...DEFAULT_WEIGHTS })
  const [quotaMin, setQuotaMin] = useState<Record<string, number>>({ ...DEFAULT_QUOTA_MIN })
  const [quotaMax, setQuotaMax] = useState<Record<string, number>>({ ...DEFAULT_QUOTA_MAX })
  const [targetRtp, setTargetRtp] = useState(0.7)
  const [autoPrice, setAutoPrice] = useState(true)
  const [replace, setReplace] = useState(true)
  const [preview, setPreview] = useState<GenerateGachaPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [modelTotal, setModelTotal] = useState(0)
  const [saving, setSaving] = useState(false)
  const MODEL_PAGE_SIZE = 100

  async function loadModels(reset = false, pageNo?: number) {
    const next = pageNo ?? (reset ? 1 : page)
    if (reset) setLoading(true)
    else setLoadingMore(true)
    try {
      const r = await listModelRatings({ page: next, pageSize: MODEL_PAGE_SIZE })
      setModelTotal(r.total)
      setModels((prev) => (reset ? r.data : [...prev, ...r.data]))
      setPage(next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载模型失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void loadModels(true, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(
    () =>
      models.filter((m) => {
        if (ratingFilter && m.rating !== ratingFilter) return false
        if (keyword && !m.model_name.toLowerCase().includes(keyword.toLowerCase())) return false
        return true
      }),
    [models, ratingFilter, keyword]
  )

  const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.model_name))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        filtered.forEach((m) => next.delete(m.model_name))
      } else {
        filtered.forEach((m) => next.add(m.model_name))
      }
      return next
    })
  }

  function toggleOne(name: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })
  }

  function buildReq(): {
    group: string
    models: string[]
    expire_days: number
    weights: Record<string, number>
    quota_min: Record<string, number>
    quota_max: Record<string, number>
    target_rtp: number
    auto_price: boolean
    replace: boolean
  } {
    return {
      group: group.trim() || 'default',
      models: [...selected],
      expire_days: expireDays,
      weights,
      quota_min: quotaMin,
      quota_max: quotaMax,
      target_rtp: targetRtp,
      auto_price: autoPrice,
      replace,
    }
  }

  async function doPreview() {
    if (selected.size === 0) {
      toast.error('请先选择模型')
      return
    }
    setLoading(true)
    try {
      setPreview(await generatePreview(pool.id, buildReq()))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '预览失败')
    } finally {
      setLoading(false)
    }
  }

  async function doSave() {
    if (selected.size === 0) return
    setSaving(true)
    try {
      await generateEntries(pool.id, buildReq())
      toast.success('条目已生成')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[88vh] max-w-3xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>批量添加模型到「{pool.name}」</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='grid grid-cols-3 gap-3'>
            <div className='space-y-1.5'>
              <Label>分组</Label>
              <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder='default' />
            </div>
            <div className='space-y-1.5'>
              <Label>过期天数（0 永久）</Label>
              <Input type='number' value={expireDays} onChange={(e) => setExpireDays(Number(e.target.value))} />
            </div>
            <div className='space-y-1.5'>
              <Label>目标回本率</Label>
              <Input
                type='number'
                step='0.05'
                value={targetRtp}
                onChange={(e) => setTargetRtp(Number(e.target.value))}
              />
            </div>
          </div>

          <div className='space-y-2 rounded-xl border p-3'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-semibold'>模型选择</span>
              <div className='flex items-center gap-2'>
                <Select
                  items={[{ value: '', label: '全部档位' }, ...RARITIES.map((r) => ({ value: r, label: r }))]}
                  value={ratingFilter}
                  onValueChange={(v) => setRatingFilter(v ?? '')}
                >
                  <SelectTrigger className='h-7 w-28'>
                    <SelectValue placeholder='全部档位' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=''>全部档位</SelectItem>
                    {RARITIES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className='relative'>
                  <Search className='absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground' />
                  <Input className='h-7 w-44 pl-7' placeholder='搜索模型' value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                </div>
              </div>
            </div>
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Checkbox checked={allSelected} onCheckedChange={() => toggleAll()} />
              <span>全选当前 {filtered.length} 个 · 已选 {selected.size} 个</span>
              {selected.size > 0 && (
                <Button size='sm' variant='ghost' className='h-6 px-2' onClick={() => setSelected(new Set())}>
                  清空
                </Button>
              )}
            </div>
            <div className='max-h-52 space-y-1 overflow-y-auto'>
              {filtered.map((m) => (
                <label
                  key={m.id}
                  className='hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1'
                >
                  <Checkbox checked={selected.has(m.model_name)} onCheckedChange={(v) => toggleOne(m.model_name, !!v)} />
                  <span className='truncate font-mono text-sm'>{m.model_name}</span>
                  <RatingBadge rating={m.rating} />
                </label>
              ))}
              {filtered.length === 0 && <p className='py-6 text-center text-sm text-muted-foreground'>无匹配模型</p>}
            </div>
            {models.length < modelTotal && (
              <Button
                size='sm'
                variant='ghost'
                className='w-full'
                disabled={loadingMore}
                onClick={() => void loadModels(false, page + 1)}
              >
                {loadingMore ? '加载中…' : `加载更多（已加载 ${models.length}/${modelTotal}）`}
              </Button>
            )}
          </div>

          <div className='space-y-2 rounded-xl border p-3'>
            <div className='flex items-center gap-2 text-sm font-semibold'>
              <Wand2 className='size-4' /> 按档位自动生成权重与额度
            </div>
            <div className='grid grid-cols-[3rem_1fr_1.2fr_1.2fr] items-center gap-2 text-xs text-muted-foreground'>
              <span />
              <span>权重（越大越容易抽中）</span>
              <span>额度下限 (quota)</span>
              <span>额度上限 (quota)</span>
              {RARITIES.map((r) => (
                <FragmentRow
                  key={r}
                  rarity={r}
                  weight={weights[r]}
                  min={quotaMin[r]}
                  max={quotaMax[r]}
                  onWeight={(v) => setWeights({ ...weights, [r]: v })}
                  onMin={(v) => setQuotaMin({ ...quotaMin, [r]: v })}
                  onMax={(v) => setQuotaMax({ ...quotaMax, [r]: v })}
                />
              ))}
            </div>
          </div>

          <div className='flex items-center gap-4'>
            <label className='flex items-center gap-2 text-sm'>
              <Switch checked={autoPrice} onCheckedChange={setAutoPrice} />
              按建议售价自动定价
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <Switch checked={replace} onCheckedChange={setReplace} />
              替换该分组现有条目
            </label>
          </div>

          {preview && (
            <div className='space-y-2 rounded-xl border p-3 text-xs'>
              <div className='flex items-center gap-1.5 font-semibold'>
                <TrendingUp className='size-3.5' /> 生成预览
              </div>
              <div className='grid grid-cols-2 gap-1.5'>
                <span className='text-muted-foreground'>期望卡价值</span>
                <span className='text-right font-mono'>{formatQuotaWithCurrency(preview.expected_value)}</span>
                <span className='text-muted-foreground'>建议单抽价</span>
                <span className='text-right font-mono'>{formatQuotaWithCurrency(preview.suggested_price)}</span>
                <span className='text-muted-foreground'>建议十连价</span>
                <span className='text-right font-mono'>{formatQuotaWithCurrency(preview.suggested_ten)}</span>
                {preview.cost_known_weight > 0 && (
                  <>
                    <span className='text-muted-foreground'>期望成本</span>
                    <span className='text-right font-mono'>{formatQuotaWithCurrency(Math.round(preview.expected_cost))}</span>
                  </>
                )}
              </div>
              {preview.warn && <p className='text-destructive'>⚠ {preview.warn_reason}</p>}
              <div className='max-h-36 space-y-1 overflow-y-auto border-t pt-2'>
                {preview.entries.map((v) => (
                  <div key={v.entry.models} className='flex items-center justify-between gap-2'>
                    <span className='flex min-w-0 items-center gap-2'>
                      <span className='truncate font-mono'>{v.entry.models}</span>
                      <RatingBadge rating={v.rating} />
                    </span>
                    <span className='shrink-0 text-muted-foreground'>
                      {(v.probability * 100).toFixed(1)}% · 权重 {v.entry.weight} · {formatQuotaWithCurrency(v.entry.quota_min)}~
                      {formatQuotaWithCurrency(v.entry.quota_max)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            取消
          </Button>
          <Button variant='secondary' disabled={selected.size === 0 || loading} onClick={() => void doPreview()}>
            预览
          </Button>
          <Button disabled={selected.size === 0 || loading || saving} onClick={() => void doSave()}>
            生成条目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FragmentRow(props: {
  rarity: string
  weight: number
  min: number
  max: number
  onWeight: (v: number) => void
  onMin: (v: number) => void
  onMax: (v: number) => void
}) {
  const { rarity, weight, min, max, onWeight, onMin, onMax } = props
  return (
    <>
      <span className='font-semibold'>{rarity}</span>
      <Input className='h-7' type='number' value={weight} onChange={(e) => onWeight(Number(e.target.value))} />
      <Input className='h-7' type='number' value={min} onChange={(e) => onMin(Number(e.target.value))} />
      <Input className='h-7' type='number' value={max} onChange={(e) => onMax(Number(e.target.value))} />
    </>
  )
}

function PoolsTab() {
  const [pools, setPools] = useState<GachaPool[]>([])
  const [editingPool, setEditingPool] = useState<GachaPool | undefined>()
  const [showCreate, setShowCreate] = useState(false)
  const [editingEntry, setEditingEntry] = useState<{ pool: GachaPool; entry?: GachaCardEntry } | undefined>()
  const [generatingPool, setGeneratingPool] = useState<GachaPool | undefined>()

  async function load() {
    try {
      setPools(await listPools())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
    }
  }

  useEffect(() => {
    let cancelled = false
    void listPools()
      .then((value) => {
        if (!cancelled) setPools(value)
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function removePool(pool: GachaPool) {
    if (!window.confirm(`确认删除卡池 ${pool.name}？其下条目将一并删除`)) return
    try {
      await deletePool(pool.id)
      toast.success('卡池已删除')
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function removeEntry(entry: GachaCardEntry) {
    if (!entry.id) return
    try {
      await deleteEntry(entry.id)
      toast.success('条目已删除')
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex justify-end'>
        <Button size='sm' onClick={() => setShowCreate(true)}>
          <Plus className='mr-1.5 size-4' /> 新建卡池
        </Button>
      </div>
      {pools.length === 0 ? (
        <p className='py-12 text-center text-sm text-muted-foreground'>暂无卡池，点击右上角创建</p>
      ) : (
        <div className='space-y-4'>
          {pools.map((pool) => (
            <Card key={pool.id} className='p-4'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div className='flex items-center gap-2'>
                  <span className='font-semibold'>{pool.name}</span>
                  {pool.enabled ? (
                    <Badge className='bg-green-500/15 text-green-600'>启用</Badge>
                  ) : (
                    <Badge className='bg-slate-500/15 text-slate-500'>停用</Badge>
                  )}
                  {pool.pity_enabled && pool.pity_max > 0 && (
                    <Badge className='bg-purple-500/15 text-purple-600'>
                      保底 {pool.pity_max} 抽 {pool.pity_rarity}
                    </Badge>
                  )}
                </div>
                <div className='flex items-center gap-1.5'>
                  <Button size='sm' variant='outline' onClick={() => setEditingPool(pool)}>
                    <Pencil className='size-3.5' />
                  </Button>
                  <Button size='sm' variant='outline' title='批量添加模型' onClick={() => setGeneratingPool(pool)}>
                    <Wand2 className='size-3.5' />
                  </Button>
                  <Button size='sm' variant='outline' onClick={() => setEditingEntry({ pool })}>
                    <Plus className='size-3.5' />
                  </Button>
                  <Button size='sm' variant='outline' onClick={() => void removePool(pool)}>
                    <Trash2 className='size-3.5 text-destructive' />
                  </Button>
                </div>
              </div>
              <div className='mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground'>
                <span>单抽 {formatQuotaWithCurrency(pool.price)}</span>
                {pool.ten_price > 0 && <span>十连 {formatQuotaWithCurrency(pool.ten_price)}</span>}
                {pool.ten_guarantee && <span>十连保底 {pool.ten_guarantee}+</span>}
                {pool.entries && pool.entries.length > 0 && <span>{pool.entries.length} 个条目</span>}
              </div>
              {pool.entries && pool.entries.length > 0 && (
                <div className='mt-3 space-y-1.5'>
                  {pool.entries.map((entry) => (
                    <div key={entry.id} className='flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-xs'>
                      <div className='flex min-w-0 items-center gap-2'>
                        <span className='truncate font-mono'>{entry.models}</span>
                        <Badge className='shrink-0' variant='secondary'>
                          {entry.group}
                        </Badge>
                      </div>
                      <div className='flex shrink-0 items-center gap-3 text-muted-foreground'>
                        <span>权重 {entry.weight}</span>
                        <span>
                          {(entry.quota_max ?? 0) > (entry.quota_min ?? 0)
                            ? `${formatQuotaWithCurrency(entry.quota_min ?? 0)}~${formatQuotaWithCurrency(entry.quota_max ?? 0)}`
                            : formatQuotaWithCurrency(entry.quota)}
                        </span>
                        <span>{entry.expire_days > 0 ? `${entry.expire_days} 天` : '永久'}</span>
                        <button type='button' className='hover:text-foreground' onClick={() => setEditingEntry({ pool, entry })}>
                          <Pencil className='size-3' />
                        </button>
                        <button type='button' className='hover:text-destructive' onClick={() => void removeEntry(entry)}>
                          <Trash2 className='size-3' />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {showCreate && <PoolEditor onClose={() => setShowCreate(false)} onSaved={() => void load()} />}
      {editingPool && <PoolEditor pool={editingPool} onClose={() => setEditingPool(undefined)} onSaved={() => void load()} />}
      {editingEntry && (
        <EntryEditor
          poolId={editingEntry.pool.id}
          entry={editingEntry.entry}
          onClose={() => setEditingEntry(undefined)}
          onSaved={() => void load()}
        />
      )}
      {generatingPool && (
        <GenerateEntriesDialog
          pool={generatingPool}
          onClose={() => setGeneratingPool(undefined)}
          onSaved={() => void load()}
        />
      )}
    </div>
  )
}

export default function GachaAdminPage() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Gacha Admin')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <p className='text-sm text-muted-foreground'>{t('Card pools, entries and economics')}</p>
          <PoolsTab />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
