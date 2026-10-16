import { useQuery } from '@tanstack/react-query'
import { MessagesSquare, Minus, Plus, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  fetchCharacter,
  fetchCharacterPet,
  fetchCharacterPetStatus,
} from '../api'
import { StoryPlayer } from './story-player'

/** 桌宠基础宽度（px）。实际渲染尺寸 = 基础宽度 × 用户缩放。 */
const PET_BASE_SIZE = 96
/** 桌宠图通常偏高，用它估算渲染高度，供视口钳制与吸附使用。 */
const PET_ASPECT = 1.35
const VIEWPORT_MARGIN = 8
const SCALE_MIN = 0.6
const SCALE_MAX = 1.8
const SCALE_STEP = 0.2
const STORAGE_KEY = 'character-pet:v1'

/** 吸附区按视口比例计算，取值与 dsh 小鲸鱼挂件一致，保证观感接近。 */
const SNAP_LEFT_RATIO = 0.1
const SNAP_RIGHT_RATIO = 0.1
const SNAP_BOTTOM_RATIO = 0.15

/** 贴边方向决定是否水平镜像与气泡朝向。 */
type PetSide = 'free' | 'left' | 'right'

type PetPrefs = {
  x: number
  y: number
  side: PetSide
  scale: number
  hidden: boolean
}

const IDLE_LINE_KEYS = [
  'character.pet.line.1',
  'character.pet.line.2',
  'character.pet.line.3',
  'character.pet.line.4',
  'character.pet.line.5',
  'character.pet.line.6',
] as const

function readPrefs(): PetPrefs | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const stored = parsed as Record<string, unknown>
    if (typeof stored.x !== 'number' || typeof stored.y !== 'number') {
      return null
    }
    const side =
      stored.side === 'left' || stored.side === 'right'
        ? (stored.side as PetSide)
        : 'free'
    const scale =
      typeof stored.scale === 'number' && Number.isFinite(stored.scale)
        ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, stored.scale))
        : 1
    return {
      x: stored.x,
      y: stored.y,
      side,
      scale,
      hidden: stored.hidden === true,
    }
  } catch {
    return null
  }
}

function writePrefs(prefs: PetPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // 隐私模式等场景下存储不可用，桌宠本次会话仍可正常使用。
  }
}

/** 把坐标钳制回视口内，保证桌宠始终有可见面积留在屏幕上。 */
function clampIntoViewport(
  x: number,
  y: number,
  width: number,
  height: number
) {
  const maxX = Math.max(
    VIEWPORT_MARGIN,
    window.innerWidth - width - VIEWPORT_MARGIN
  )
  const maxY = Math.max(
    VIEWPORT_MARGIN,
    window.innerHeight - height - VIEWPORT_MARGIN
  )
  return {
    x: Math.min(Math.max(VIEWPORT_MARGIN, x), maxX),
    y: Math.min(Math.max(VIEWPORT_MARGIN, y), maxY),
  }
}

/**
 * 松手后归位：落在左右吸附区内就贴边，贴左时水平镜像；
 * 落在底部吸附区内就坐到屏幕底边。这是桌宠「手感」的主要来源。
 */
function snapPosition(x: number, y: number, width: number, height: number) {
  let nextX = x
  let nextY = y
  let side: PetSide = 'free'

  if (x <= window.innerWidth * SNAP_LEFT_RATIO) {
    nextX = VIEWPORT_MARGIN
    side = 'left'
  } else if (
    window.innerWidth - (x + width) <=
    window.innerWidth * SNAP_RIGHT_RATIO
  ) {
    nextX = window.innerWidth - width - VIEWPORT_MARGIN
    side = 'right'
  }
  if (
    window.innerHeight - (y + height) <=
    window.innerHeight * SNAP_BOTTOM_RATIO
  ) {
    nextY = window.innerHeight - height - VIEWPORT_MARGIN
  }
  return { x: nextX, y: nextY, side }
}

export function CharacterPetWidget() {
  const { t, i18n } = useTranslation()

  const { data: pet } = useQuery({
    queryKey: ['character-pet'],
    queryFn: fetchCharacterPet,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const utteranceCursorRef = useRef(0)
  // 站点提醒：只读当前用户自己的数据，60s 轮询与 dsh 小鲸鱼挂件同节奏。
  const { data: petStatus } = useQuery({
    queryKey: ['character-pet-status'],
    queryFn: fetchCharacterPetStatus,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: false,
  })
  // 提醒优先于闲话：有真实事件时，点击先看到事件，而不是又一句俏皮话。
  // 金额与数量在这里就格式化好，i18n 只负责套模板。
  const utterances = useMemo(() => {
    const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
    const alertLines = (petStatus?.items ?? []).map((item) => {
      const params: Record<string, string> = {}
      if (typeof item.params.quota === 'number') {
        params.quota = formatQuota(item.params.quota)
      }
      if (typeof item.params.threshold === 'number') {
        params.threshold = formatQuota(item.params.threshold)
      }
      if (typeof item.params.count === 'number') {
        params.n = formatNumber(item.params.count, locale)
      }
      return { severity: item.severity, text: t(item.key, params) }
    })
    return [
      ...alertLines,
      ...IDLE_LINE_KEYS.map((key) => ({ severity: 'info', text: t(key) })),
    ]
  }, [petStatus, t, i18n.resolvedLanguage, i18n.language])

  const worstSeverity = useMemo(() => {
    const items = petStatus?.items ?? []
    if (items.some((item) => item.severity === 'critical')) return 'critical'
    if (items.some((item) => item.severity === 'warning')) return 'warning'
    return null
  }, [petStatus])
  const initialPrefs = useMemo(() => readPrefs(), [])
  const [prefs, setPrefs] = useState<PetPrefs | null>(initialPrefs)
  const [menuOpen, setMenuOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // 对话沿用现有的 StoryPlayer（chat 模式）：它已经处理了选模型、计费、并发闸与
  // 「忘记她」等全部逻辑，桌宠只负责提供一个入口，不另造一套聊天界面。
  const { data: chatCharacter } = useQuery({
    queryKey: ['character', pet?.model_name],
    queryFn: () => fetchCharacter(pet?.model_name ?? ''),
    enabled: chatOpen && !!pet?.model_name,
    staleTime: 60 * 1000,
    retry: false,
  })
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [bubble, setBubble] = useState<string | null>(null)

  const dragRef = useRef<{
    pointerId: number
    offsetX: number
    offsetY: number
    moved: boolean
  } | null>(null)
  const bubbleTimerRef = useRef<number | null>(null)

  // 首次访问（没有历史位置）落在右下角，留出边距避免挡住右下角内容。
  useEffect(() => {
    if (prefs || !pet?.active) return
    setPrefs({
      x: window.innerWidth - PET_BASE_SIZE - VIEWPORT_MARGIN * 3,
      y: window.innerHeight - PET_BASE_SIZE * PET_ASPECT - VIEWPORT_MARGIN * 3,
      side: 'right',
      scale: 1,
      hidden: false,
    })
  }, [prefs, pet?.active])

  useEffect(() => {
    if (prefs) writePrefs(prefs)
  }, [prefs])

  // 视口变化时（旋转屏幕、拖动窗口边缘）把桌宠拉回可见区域。
  useEffect(() => {
    const keepVisible = () =>
      setPrefs((prev) => {
        if (!prev) return prev
        const scaledWidth = PET_BASE_SIZE * prev.scale
        const scaledHeight = scaledWidth * PET_ASPECT
        const clamped = clampIntoViewport(
          prev.x,
          prev.y,
          scaledWidth,
          scaledHeight
        )
        if (clamped.x === prev.x && clamped.y === prev.y) return prev
        return { ...prev, ...clamped }
      })
    window.addEventListener('resize', keepVisible)
    return () => window.removeEventListener('resize', keepVisible)
  }, [])

  useEffect(() => {
    return () => {
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current)
    }
  }, [])

  const showBubble = useCallback(() => {
    if (utterances.length === 0) return
    // 依次走完「提醒 + 闲话」，连点不会一直重复同一条。
    const next = utteranceCursorRef.current % utterances.length
    utteranceCursorRef.current = (next + 1) % utterances.length
    setBubble(utterances[next].text)
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current)
    bubbleTimerRef.current = window.setTimeout(() => setBubble(null), 4000)
  }, [utterances])

  // 出现严重提醒时主动冒一次泡，其余情况等用户点。
  const announcedRef = useRef('')
  useEffect(() => {
    if (worstSeverity !== 'critical' || utterances.length === 0) return
    const key = petStatus?.items[0]?.key ?? ''
    if (!key || announcedRef.current === key) return
    announcedRef.current = key
    setBubble(utterances[0].text)
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current)
    bubbleTimerRef.current = window.setTimeout(() => setBubble(null), 6000)
  }, [worstSeverity, petStatus, utterances])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!prefs || event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - prefs.x,
      offsetY: event.clientY - prefs.y,
      moved: false,
    }
    setPressed(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !prefs) return
    const targetX = event.clientX - drag.offsetX
    const targetY = event.clientY - drag.offsetY
    if (Math.abs(targetX - prefs.x) > 2 || Math.abs(targetY - prefs.y) > 2) {
      drag.moved = true
    }
    setPrefs((prev) => {
      if (!prev) return prev
      const scaledWidth = PET_BASE_SIZE * prev.scale
      const clamped = clampIntoViewport(
        targetX,
        targetY,
        scaledWidth,
        scaledWidth * PET_ASPECT
      )
      return { ...prev, ...clamped }
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !prefs) return
    dragRef.current = null
    setPressed(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)

    const scaledWidth = PET_BASE_SIZE * prefs.scale
    const scaledHeight = scaledWidth * PET_ASPECT
    if (drag.moved) {
      setPrefs((prev) =>
        prev
          ? {
              ...prev,
              ...snapPosition(prev.x, prev.y, scaledWidth, scaledHeight),
            }
          : prev
      )
      return
    }
    showBubble()
  }

  const changeScale = (delta: number) => {
    setPrefs((prev) =>
      prev
        ? {
            ...prev,
            scale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale + delta)),
          }
        : prev
    )
  }

  if (!pet?.active || !prefs || prefs.hidden) return null

  const mirrored = prefs.side === 'left'
  const width = PET_BASE_SIZE * prefs.scale
  const height = width * PET_ASPECT

  return (
    <div
      data-slot='character-pet'
      className='pointer-events-none fixed z-40'
      style={{ left: prefs.x, top: prefs.y }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {worstSeverity && (
        <span
          data-severity={worstSeverity}
          aria-hidden='true'
          className={cn(
            'border-background pointer-events-none absolute -top-0.5 size-2.5 rounded-full border',
            worstSeverity === 'critical' ? 'bg-destructive' : 'bg-amber-500',
            mirrored ? 'left-0.5' : 'right-0.5'
          )}
        />
      )}
      {bubble && (
        <div
          role='status'
          className={cn(
            'bg-background text-foreground border-border pointer-events-auto absolute bottom-1/2 z-10 w-max max-w-56 -translate-y-1/2 rounded-xl border px-3 py-2 text-sm shadow-lg',
            mirrored ? 'left-full ml-3' : 'right-full mr-3'
          )}
        >
          {bubble}
          <span
            aria-hidden='true'
            className={cn(
              'bg-background border-border absolute top-1/2 size-2 -translate-y-1/2 rotate-45 border-r border-b',
              mirrored ? '-left-1' : '-right-1'
            )}
          />
        </div>
      )}

      <button
        type='button'
        aria-label={pet.display_name ?? t('character.pet.title')}
        title={t('Drag to move')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className='pointer-events-auto block cursor-grab touch-none select-none active:cursor-grabbing'
        style={{
          width,
          height,
          transform: pressed ? 'scaleY(0.92) scaleX(1.04)' : undefined,
          transformOrigin: 'bottom center',
          transition: 'transform 150ms ease-out',
        }}
      >
        <img
          src={pet.image_url}
          alt={pet.display_name ?? ''}
          draggable={false}
          className={cn(
            'h-full w-full object-contain drop-shadow-lg transition-transform duration-200',
            mirrored && '-scale-x-100'
          )}
        />
      </button>

      {/* 工具条：尺寸与隐藏按需展开（而非常驻），避免不可见的控件仍拦截点击。 */}
      <div className='absolute -bottom-1 left-0 flex items-center gap-1'>
        {(menuOpen || hovered) && (
          <div
            role='group'
            aria-label={t('character.pet.size')}
            className='bg-background border-border pointer-events-auto flex items-center gap-0.5 rounded-full border p-0.5 shadow-sm'
          >
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              aria-label={t('character.pet.smaller')}
              disabled={prefs.scale <= SCALE_MIN}
              onClick={() => changeScale(-SCALE_STEP)}
            >
              <Minus aria-hidden='true' />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              aria-label={t('character.pet.larger')}
              disabled={prefs.scale >= SCALE_MAX}
              onClick={() => changeScale(SCALE_STEP)}
            >
              <Plus aria-hidden='true' />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              aria-label={t('character.pet.hide')}
              onClick={() =>
                setPrefs((prev) => (prev ? { ...prev, hidden: true } : prev))
              }
            >
              <X aria-hidden='true' />
            </Button>
          </div>
        )}
        <Button
          type='button'
          variant='secondary'
          size='icon-xs'
          className='pointer-events-auto'
          aria-label={t('character.chat.open')}
          title={t('character.chat.open')}
          onClick={() => setChatOpen(true)}
        >
          <MessagesSquare aria-hidden='true' />
        </Button>
        <Button
          type='button'
          variant='secondary'
          size='icon-xs'
          className='pointer-events-auto'
          aria-label={t('character.pet.settings')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <span aria-hidden='true'>☰</span>
        </Button>
      </div>
      {chatCharacter && (
        <StoryPlayer
          open={chatOpen}
          onOpenChange={setChatOpen}
          character={chatCharacter}
          startInChat
        />
      )}
    </div>
  )
}
