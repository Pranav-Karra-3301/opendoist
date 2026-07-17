import { cn } from '@/lib/utils'

/**
 * Shimmering placeholder block: `bg-hover`, 5px radius, animated by the `.od-skeleton`
 * keyframe in tokens.css (which the global reduced-motion gate disables). `aria-hidden`
 * — parents supply `aria-busy` on the live region.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={cn('od-skeleton rounded-sm bg-hover', className)} />
}

/**
 * `rows` task-row-shaped placeholders (18px circle + two text bars, 42px row height).
 * The wrapper is `aria-hidden` so screen readers ignore the whole loading block.
 */
export function TaskListSkeleton({ rows = 8 }: { rows?: number }) {
  const keys = Array.from({ length: rows }, (_, i) => `od-skeleton-row-${i}`)
  return (
    <div aria-hidden data-rows={rows} className="flex flex-col">
      {keys.map((key) => (
        <div key={key} className="flex h-[42px] items-center gap-3 px-2">
          <Skeleton className="size-[18px] shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
