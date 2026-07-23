/**
 * Productivity popover (phase 9 Task L). A top-bar trigger (the `Target` ring button, also
 * bound to the `o>p` hotkey via the exported store) opens a Base UI popover summarising the
 * authed user's goals: daily + weekly goal rings, streaks, and a karma block. Data comes
 * from GET /api/v1/productivity, fetched lazily on open.
 *
 * Shares the ['productivity'] query cache with the Reporting goal charts (Task M). Both
 * parse the FULL ProductivityDto (mirrors apps/server/src/productivity/types.ts, frozen by
 * Task A) so whichever consumer mounts first leaves a complete cache entry.
 */
import { KARMA_LEVELS } from '@opentask/core'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Flame, Minus, Target, TrendingDown, TrendingUp, Umbrella } from 'lucide-react'
import type { ReactElement } from 'react'
import { z } from 'zod'
import { create } from 'zustand'
import { type ApiError, api } from '@/api/client'
import { buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { GoalRing } from './GoalRing'

/** Open state for the popover, driven both by its trigger and the global `o>p` hotkey
 *  (keyboard/index.tsx calls `useProductivityPopoverStore.getState().setOpen(true)`). */
export const useProductivityPopoverStore = create<{
  open: boolean
  setOpen: (open: boolean) => void
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

const DayStatSchema = z.object({
  date: z.string(),
  completed: z.number().int(),
  goalMet: z.boolean(),
  dayOff: z.boolean(),
  vacation: z.boolean(),
})
const WeekStatSchema = z.object({
  start: z.string(),
  completed: z.number().int(),
  goalMet: z.boolean(),
})
const ProductivityDtoSchema = z.object({
  karmaEnabled: z.boolean(),
  karma: z.object({
    total: z.number().int(),
    level: z.object({
      name: z.string(),
      floor: z.number(),
      nextFloor: z.number().nullable(),
      progress: z.number(),
    }),
    trend: z.enum(['up', 'down', 'flat']),
  }),
  goals: z.object({
    dailyGoal: z.number().int(),
    weeklyGoal: z.number().int(),
    daysOff: z.array(z.number().int()),
    vacationMode: z.boolean(),
  }),
  today: z.object({ date: z.string(), completed: z.number().int(), goalMet: z.boolean() }),
  week: z.object({ start: z.string(), completed: z.number().int(), goalMet: z.boolean() }),
  streaks: z.object({
    daily: z.object({ current: z.number().int(), longest: z.number().int() }),
    weekly: z.object({ current: z.number().int(), longest: z.number().int() }),
  }),
  days: z.array(DayStatSchema),
  weeks: z.array(WeekStatSchema),
  karmaHistory: z.array(
    z.object({ date: z.string(), delta: z.number().int(), runningTotal: z.number().int() }),
  ),
})
type ProductivityDto = z.infer<typeof ProductivityDtoSchema>

/** Fetch-on-open: the query stays idle until the popover opens (`enabled`). */
function useProductivity(enabled: boolean) {
  return useQuery<ProductivityDto, ApiError>({
    queryKey: ['productivity'],
    queryFn: () => api('/productivity', { schema: ProductivityDtoSchema }),
    enabled,
  })
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

function RingStat({
  label,
  completed,
  goal,
}: {
  label: string
  completed: number
  goal: number
}): ReactElement {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <GoalRing
        completed={completed}
        goal={goal}
        ariaLabel={`${label}: ${completed} of ${goal} tasks completed`}
      />
      <span className="text-caption text-text-secondary">{label}</span>
      <span className="text-caption text-text-tertiary tabular-nums">goal {goal}</span>
    </div>
  )
}

function StreakLine({
  unit,
  current,
  longest,
}: {
  unit: 'day' | 'week'
  current: number
  longest: number
}): ReactElement {
  return (
    <div className="flex items-center gap-1.5 text-caption text-text-secondary">
      <Flame size={14} className="shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="tabular-nums">
        {current}-{unit} streak <span className="text-text-tertiary">· longest {longest}</span>
      </span>
    </div>
  )
}

function TrendArrow({ trend }: { trend: ProductivityDto['karma']['trend'] }): ReactElement {
  if (trend === 'up') {
    return <TrendingUp size={16} className="text-success" aria-label="Karma trending up" />
  }
  if (trend === 'down') {
    return <TrendingDown size={16} className="text-danger" aria-label="Karma trending down" />
  }
  return <Minus size={16} className="text-text-tertiary" aria-label="Karma flat" />
}

function KarmaBlock({ karma }: { karma: ProductivityDto['karma'] }): ReactElement {
  const { total, level, trend } = karma
  const nextName =
    level.nextFloor === null
      ? null
      : (KARMA_LEVELS.find((l) => l.floor === level.nextFloor)?.name ?? 'next level')
  const remaining = level.nextFloor === null ? 0 : Math.max(level.nextFloor - total, 0)

  return (
    <div className="flex flex-col gap-1.5 border-border border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="text-caption text-text-tertiary uppercase tracking-wide">Karma</span>
        <TrendArrow trend={trend} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-header text-text-primary tabular-nums">
          {total.toLocaleString()}
        </span>
        <span className="text-copy text-text-secondary">{level.name}</span>
      </div>
      {nextName !== null && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.round(clamp01(level.progress) * 100)}%` }}
            />
          </div>
          <span className="text-caption text-text-tertiary tabular-nums">
            {remaining.toLocaleString()} pts to {nextName}
          </span>
        </>
      )}
    </div>
  )
}

function LoadingState(): ReactElement {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-around gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-3 w-32" />
    </div>
  )
}

export function ProductivityPopover(): ReactElement {
  const open = useProductivityPopoverStore((s) => s.open)
  const setOpen = useProductivityPopoverStore((s) => s.setOpen)
  const query = useProductivity(open)
  const data = query.data

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Productivity"
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
      >
        <Target size={20} strokeWidth={1.75} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3.5">
        <h2 className="font-medium text-body text-text-primary">Productivity</h2>

        {query.isError ? (
          <p className="py-6 text-center text-copy text-text-tertiary">
            Couldn't load your productivity stats.
          </p>
        ) : data === undefined ? (
          <LoadingState />
        ) : (
          <>
            <div className="flex items-start justify-around gap-3">
              <RingStat
                label="Today"
                completed={data.today.completed}
                goal={data.goals.dailyGoal}
              />
              <RingStat
                label="This week"
                completed={data.week.completed}
                goal={data.goals.weeklyGoal}
              />
            </div>

            <div className="flex flex-col gap-1">
              <StreakLine
                unit="day"
                current={data.streaks.daily.current}
                longest={data.streaks.daily.longest}
              />
              <StreakLine
                unit="week"
                current={data.streaks.weekly.current}
                longest={data.streaks.weekly.longest}
              />
            </div>

            {data.goals.vacationMode && (
              <div className="flex items-center gap-2 rounded-sm bg-accent-soft px-2.5 py-1.5 text-caption text-text-secondary">
                <Umbrella size={14} className="shrink-0 text-accent" aria-hidden="true" />
                <span>Vacation mode is on — streaks paused</span>
              </div>
            )}

            {data.karmaEnabled && <KarmaBlock karma={data.karma} />}

            <Link
              to="/reporting"
              onClick={() => setOpen(false)}
              className="flex items-center justify-end gap-1 text-accent text-copy hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ot-focus-ring)] focus-visible:outline-offset-2"
            >
              Open Reporting
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
