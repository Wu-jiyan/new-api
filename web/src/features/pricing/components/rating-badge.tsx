import { cn } from '@/lib/utils'

export const RATING_STYLES: Record<string, { label: string; className: string }> = {
  N: { label: 'N', className: 'bg-slate-400 text-white' },
  R: { label: 'R', className: 'bg-blue-500 text-white' },
  SR: { label: 'SR', className: 'bg-purple-500 text-white' },
  SSR: { label: 'SSR', className: 'bg-amber-500 text-white' },
  UR: {
    label: 'UR',
    className: 'bg-pink-500 text-white shadow-[0_0_12px_rgba(236,72,153,0.8)]',
  },
}

export function RatingBadge({
  rating,
  className,
}: {
  rating?: string
  className?: string
}) {
  if (!rating || !RATING_STYLES[rating]) return null
  const style = RATING_STYLES[rating]
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-bold leading-none',
        style.className,
        className
      )}
    >
      {style.label}
    </span>
  )
}
