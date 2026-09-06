import { Download, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ShareCardProps {
  modelName: string
  displayName: string
  title: string
  stageName: string
  imageUrl: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CARD_WIDTH = 750
const CARD_HEIGHT = 1000
const IMAGE_HEIGHT = 720

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let truncated = text
  while (truncated.length > 0 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return `${truncated}…`
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    try {
      const isCrossOrigin =
        new URL(src, window.location.origin).origin !== window.location.origin
      if (isCrossOrigin) img.crossOrigin = 'anonymous'
    } catch {
      // 忽略 URL 解析错误
    }
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

export function ShareCard({
  modelName,
  displayName,
  title,
  stageName,
  imageUrl,
  open,
  onOpenChange,
}: ShareCardProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setReady(false)

    const draw = async () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      try {
        canvas.width = CARD_WIDTH
        canvas.height = CARD_HEIGHT

        // 深色渐变背景
        const gradient = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT)
        gradient.addColorStop(0, '#1a1a2e')
        gradient.addColorStop(1, '#0f0f1a')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

        // 立绘（cover 方式，裁剪居中），加载失败不影响卡片生成
        if (imageUrl) {
          const img = await loadImage(imageUrl)
          if (cancelled) return
          if (img) {
            const scale = Math.max(
              CARD_WIDTH / img.naturalWidth,
              IMAGE_HEIGHT / img.naturalHeight
            )
            const dw = img.naturalWidth * scale
            const dh = img.naturalHeight * scale
            ctx.drawImage(img, (CARD_WIDTH - dw) / 2, (IMAGE_HEIGHT - dh) / 2, dw, dh)
          }
        }
        if (cancelled) return

      // 文字区
      const textTop = IMAGE_HEIGHT + 44
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'

      // 角色名
      ctx.fillStyle = 'rgba(255,255,255,0.96)'
      ctx.font = '600 44px system-ui, sans-serif'
      ctx.fillText(truncateText(ctx, displayName, CARD_WIDTH - 96), 48, textTop + 44)

      // 称号
      if (title) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.font = '400 24px system-ui, sans-serif'
        ctx.fillText(truncateText(ctx, title, CARD_WIDTH - 96), 48, textTop + 96)
      }

      // 阶段名徽章
      if (stageName) {
        ctx.font = '500 22px system-ui, sans-serif'
        const badgeText = stageName
        const badgeWidth = ctx.measureText(badgeText).width + 36
        const badgeY = textTop + 136
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        roundRectPath(ctx, 48, badgeY, badgeWidth, 46, 23)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(badgeText, 48 + badgeWidth / 2, badgeY + 23 + 1)
      }

      // 署名
      ctx.textAlign = 'right'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.font = '400 20px system-ui, sans-serif'
      ctx.fillText('AI Character', CARD_WIDTH - 48, CARD_HEIGHT - 44)

      } catch {
        // 绘制异常时也完成绘制，避免一直停留在加载态
      } finally {
        if (!cancelled) setReady(true)
      }
    }

    void draw()
    return () => {
      cancelled = true
    }
  }, [open, imageUrl, displayName, title, stageName])

  const handleDownload = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `${modelName}-share.png`
      a.click()
    } catch {
      toast.error(t('character.share.failed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('character.share.title')}</DialogTitle>
          <DialogDescription>{displayName}</DialogDescription>
        </DialogHeader>

        <div className='relative overflow-hidden rounded-lg'>
          <canvas ref={canvasRef} className='block h-auto w-full' />
          {!ready && (
            <div className='absolute inset-0 flex items-center justify-center bg-background/70'>
              <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
            </div>
          )}
        </div>

        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button onClick={handleDownload} disabled={!ready}>
            <Download className='mr-2 h-4 w-4' />
            {t('character.share.download')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
