import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface LightboxProps {
  open: boolean
  src?: string
  alt?: string
  onOpenChange: (open: boolean) => void
}

export function Lightbox({ open, src, alt, onOpenChange }: LightboxProps) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  if (!open || !src) return null

  return createPortal(
    <div
      data-lightbox
      className='fixed inset-0 z-[110] flex cursor-zoom-out items-center justify-center bg-black/90 p-4 backdrop-blur-sm'
      onClick={() => onOpenChange(false)}
      role='button'
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onOpenChange(false)
      }}
    >
      <img
        src={src}
        alt={alt ?? ''}
        className='max-h-full max-w-full rounded-lg object-contain shadow-2xl'
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type='button'
        className='absolute top-4 right-4 flex size-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20'
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(false)
        }}
        aria-label='Close'
      >
        ✕
      </button>
      <style>{`
        [data-lightbox][role='button']:active {
          transform: none !important;
        }
      `}</style>
    </div>,
    document.body
  )
}
