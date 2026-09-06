import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface GlassSelectProps {
  value: string
  options: string[]
  onChange: (value: string) => void
  /** 弹出菜单向上展开（贴近屏幕底部时使用），默认向上 */
  dropUp?: boolean
  className?: string
  menuClassName?: string
}

/**
 * galgame 播放器内的轻量玻璃拟态下拉。
 * 不走 portal：Base UI Select 的弹层 z-50 会被 z-100 的播放器遮住，这里用本地绝对定位菜单。
 */
export function GlassSelect({
  value,
  options,
  onChange,
  dropUp = true,
  className,
  menuClassName,
}: GlassSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type='button'
        className={cn(
          'flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 text-xs text-white backdrop-blur-md transition-colors hover:bg-black/75',
          open && 'border-white/35'
        )}
        onClick={() => setOpen((o) => !o)}
      >
        <span className='max-w-[13rem] truncate'>{value || '…'}</span>
        <svg
          viewBox='0 0 24 24'
          className={cn('size-3 shrink-0 text-white/50 transition-transform', open && 'rotate-180')}
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
        >
          <path d='m6 9 6 6 6-6' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
      </button>
      {open && (
        <div
          className={cn(
            'absolute z-30 min-w-40 max-h-56 overflow-y-auto rounded-lg border border-white/15 bg-zinc-900/95 py-1 shadow-xl backdrop-blur-md',
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1',
            menuClassName
          )}
        >
          {options.map((o) => (
            <button
              key={o}
              type='button'
              className={cn(
                'block w-full px-3 py-1.5 text-left text-xs whitespace-nowrap transition-colors',
                o === value ? 'text-primary bg-white/10' : 'text-white/80 hover:bg-white/10'
              )}
              onClick={() => {
                onChange(o)
                setOpen(false)
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
