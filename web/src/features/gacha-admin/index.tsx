import { useEffect, useState } from 'react'
import { Pencil, Plus, RefreshCw, Trash2, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RatingBadge } from '@/features/pricing/components/rating-badge'
import { formatQuotaWithCurrency } from '@/lib/currency'

import {
  createPool,
  deleteEntry,
  deletePool,
  fetchEconomics,
  listPools,
  listRatings,
  setRating,
  syncRatings,
  updatePool,
  updateThresholds,
  upsertEntry,
} from './api'
import type { GachaCardEntry, GachaPool, ModelRatingItem, PoolEconomics, RatingThresholds } from './types'

const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR']

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
                <Select value={form.pity_rarity ?? ''} onValueChange={(v) => setForm({ ...form, pity_rarity: v ?? '' })}>
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
            <Select value={form.ten_guarantee ?? ''} onValueChange={(v) => setForm({ ...form, ten_guarantee: v ?? '' })}>
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
  const { poolId, entry, onClose, onSaved } = props
  const [form, setForm] = useState<GachaCardEntry>(
    entry ?? { pool_id: poolId, model_name: '', group: '', weight: 1, quota: 0, expire_days: 0 }
  )

  async function save() {
    try {
      await upsertEntry(poolId, form)
      toast.success('条目已保存')
      onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? '编辑条目' : '新增条目'}</DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label>模型名</Label>
            <Input value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} />
          </div>
          <div className='space-y-1.5'>
            <Label>分组</Label>
            <Input value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
          </div>
          <div className='grid grid-cols-3 gap-3'>
            <div className='space-y-1.5'>
              <Label>权重</Label>
              <Input type='number' value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
            </div>
            <div className='space-y-1.5'>
              <Label>额度 (quota)</Label>
              <Input type='number' value={form.quota} onChange={(e) => setForm({ ...form, quota: Number(e.target.value) })} />
            </div>
            <div className='space-y-1.5'>
              <Label>过期天数</Label>
              <Input type='number' value={form.expire_days} onChange={(e) => setForm({ ...form, expire_days: Number(e.target.value) })} />
            </div>
          </div>
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

function PoolsTab() {
  const [pools, setPools] = useState<GachaPool[]>([])
  const [editingPool, setEditingPool] = useState<GachaPool | undefined>()
  const [showCreate, setShowCreate] = useState(false)
  const [editingEntry, setEditingEntry] = useState<{ pool: GachaPool; entry?: GachaCardEntry } | undefined>()

  async function load() {
    try {
      setPools(await listPools())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
    }
  }

  useEffect(() => {
    void load()
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
              </div>
              {pool.entries && pool.entries.length > 0 && (
                <div className='mt-3 space-y-1.5'>
                  {pool.entries.map((entry) => (
                    <div key={entry.id} className='flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-xs'>
                      <div className='flex min-w-0 items-center gap-2'>
                        <span className='truncate font-mono'>{entry.model_name}</span>
                        <Badge className='shrink-0' variant='secondary'>
                          {entry.group}
                        </Badge>
                      </div>
                      <div className='flex shrink-0 items-center gap-3 text-muted-foreground'>
                        <span>权重 {entry.weight}</span>
                        <span>{formatQuotaWithCurrency(entry.quota)}</span>
                        <span>{entry.expire_days > 0 ? `${entry.expire_days} 天` : '永久'}</span>
                        <button className='hover:text-foreground' onClick={() => setEditingEntry({ pool, entry })}>
                          <Pencil className='size-3' />
                        </button>
                        <button className='hover:text-destructive' onClick={() => void removeEntry(entry)}>
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
    </div>
  )
}

function RatingsTab() {
  const [models, setModels] = useState<ModelRatingItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [thresholds, setThresholds] = useState<RatingThresholds>({ ur: 65, ssr: 55, sr: 45, r: 30 })

  async function load() {
    try {
      const res = await listRatings(keyword)
      setModels(res.data)
      setThresholds(res.thresholds)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
    }
  }

  useEffect(() => {
    void load()
  }, [keyword])

  async function changeRating(item: ModelRatingItem, rating: string) {
    try {
      await setRating(item.id, rating, item.rating_score ?? 0)
      toast.success('已更新')
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败')
    }
  }

  async function doSync() {
    try {
      await syncRatings()
      toast.success('同步完成')
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步失败')
    }
  }

  async function saveThresholds() {
    try {
      await updateThresholds(thresholds)
      toast.success('阈值已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败')
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Input
          className='max-w-xs'
          placeholder='搜索模型名'
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Button size='sm' variant='outline' onClick={() => void doSync()}>
          <RefreshCw className='mr-1.5 size-4' /> 同步 DeepSWE
        </Button>
      </div>
      <Card className='p-4'>
        <div className='flex flex-wrap items-center gap-2 text-xs'>
          <span className='font-semibold'>档位阈值：</span>
          {(['ur', 'ssr', 'sr', 'r'] as const).map((key) => (
            <label key={key} className='flex items-center gap-1'>
              <span className='uppercase'>{key} ≥</span>
              <Input
                className='h-7 w-16'
                type='number'
                value={thresholds[key]}
                onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <Button size='sm' variant='outline' onClick={() => void saveThresholds()}>
            保存阈值
          </Button>
        </div>
      </Card>
      <div className='space-y-1.5'>
        {models.map((item) => (
          <div key={item.id} className='flex items-center justify-between rounded-lg border px-3 py-2 text-sm'>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='truncate font-mono'>{item.model_name}</span>
              <RatingBadge rating={item.rating} />
              {item.rating_source === 'manual' && (
                <Badge variant='secondary'>手动</Badge>
              )}
            </div>
            <div className='flex shrink-0 items-center gap-3'>
              {item.rating_score != null && item.rating_score > 0 && (
                <span className='text-xs text-muted-foreground'>{item.rating_score.toFixed(1)}%</span>
              )}
              <Select value={item.rating ?? ''} onValueChange={(v) => void changeRating(item, v ?? '')}>
                <SelectTrigger className='h-7 w-24'>
                  <SelectValue placeholder='未分级' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=''>未分级</SelectItem>
                  {RARITIES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        {models.length === 0 && <p className='py-10 text-center text-sm text-muted-foreground'>暂无模型</p>}
      </div>
    </div>
  )
}

export default function GachaAdminPage() {
  return (
    <main className='min-h-0 flex-1 overflow-y-auto'>
      <div className='container mx-auto max-w-6xl space-y-6 py-8'>
      <div>
        <h1 className='text-2xl font-bold'>抽卡管理</h1>
        <p className='text-sm text-muted-foreground'>卡池配置、条目与经济测算、模型分级</p>
      </div>
      <Tabs defaultValue='pools'>
        <TabsList>
          <TabsTrigger value='pools'>卡池管理</TabsTrigger>
          <TabsTrigger value='ratings'>模型分级</TabsTrigger>
        </TabsList>
        <TabsContent value='pools' className='mt-4'>
          <PoolsTab />
        </TabsContent>
        <TabsContent value='ratings' className='mt-4'>
          <RatingsTab />
        </TabsContent>
      </Tabs>
      </div>
    </main>
  )
}
