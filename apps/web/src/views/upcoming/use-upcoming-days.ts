/**
 * Upcoming view state + derived day model.
 *
 * `useUpcomingStore` (FROZEN name — Task N binds `shift+←/→` and `home` to its
 * `gotoWeek`/`gotoToday` actions) holds only navigation state: the selected day
 * `anchor`, the number of rendered days `range`, and a mirror of `today` the view
 * keeps in sync so the store can clamp without re-reading settings. `useUpcomingDays`
 * combines it with the single `useActiveTasks()` cache to produce the rendered day
 * list, per-day task buckets, and the overdue slice — all via pure `lib/derive`
 * selectors (no view-specific query).
 */

import type { Weekday } from '@opentask/core'
import { addDaysIso, dateInTz, diffDays, isoWeekday } from '@opentask/core'
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useActiveTasks } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { activeTasks, byDayOrder, dueOn, overdue } from '@/lib/derive'
import { useParseCtx } from '@/lib/parse-context'

/* ---------- pure date labels (English, deterministic — mirrors lib/format-date) ---------- */

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const
const WEEKDAYS_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const
/** ISO weekday initials (M T W T F S S) — ambiguous letters are fine; cells carry a full aria-label. */
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

const month = (iso: string): number => Number(iso.slice(5, 7))
const year = (iso: string): number => Number(iso.slice(0, 4))

export const dayOfMonth = (iso: string): number => Number(iso.slice(8, 10))
export const monthDayLabel = (iso: string): string =>
  `${MONTHS_SHORT[month(iso) - 1]} ${dayOfMonth(iso)}`
export const monthYearLabel = (iso: string): string => `${MONTHS_LONG[month(iso) - 1]} ${year(iso)}`
export const weekdayLongLabel = (iso: string): string =>
  WEEKDAYS_LONG[isoWeekday(iso) - 1] as string
export const weekdayInitialLabel = (iso: string): string =>
  WEEKDAY_INITIALS[isoWeekday(iso) - 1] as string
/** Screen-reader-friendly full date, e.g. "Wednesday, July 16, 2026". */
export const fullDateLabel = (iso: string): string =>
  `${weekdayLongLabel(iso)}, ${MONTHS_LONG[month(iso) - 1]} ${dayOfMonth(iso)}, ${year(iso)}`

/** Most recent day on or before `iso` whose ISO weekday equals `weekStart`. */
export function startOfWeek(iso: string, weekStart: Weekday): string {
  const back = (isoWeekday(iso) - weekStart + 7) % 7
  return addDaysIso(iso, -back)
}

/* ---------- navigation store (FROZEN name: useUpcomingStore) ---------- */

const DEFAULT_RANGE = 21
const MAX_RANGE = 365
const WEEK = 7

interface UpcomingState {
  /** today's calendar date in the user's zone; '' until the view first syncs it */
  today: string
  /** the focused day (week-strip selection); '' until first sync, then never < today */
  anchor: string
  /** rendered day count: sections span today … today+range */
  range: number
  /** the view pushes today each time it changes; seeds/clamps anchor */
  syncToday: (today: string) => void
  setAnchor: (date: string) => void
  gotoWeek: (dir: 1 | -1) => void
  gotoToday: () => void
  extend: () => void
}

export const useUpcomingStore = create<UpcomingState>((set) => ({
  today: '',
  anchor: '',
  range: DEFAULT_RANGE,
  syncToday: (today) =>
    set((s) => {
      if (s.today === today) return s
      const anchor = s.anchor === '' || s.anchor < today ? today : s.anchor
      return { today, anchor }
    }),
  setAnchor: (date) => set((s) => ({ anchor: s.today !== '' && date < s.today ? s.today : date })),
  gotoWeek: (dir) =>
    set((s) => {
      if (s.today === '') return s
      const base = s.anchor === '' ? s.today : s.anchor
      const moved = addDaysIso(base, dir * WEEK)
      const anchor = moved < s.today ? s.today : moved
      const needed = diffDays(s.today, anchor) + WEEK
      return { anchor, range: Math.min(MAX_RANGE, Math.max(s.range, needed)) }
    }),
  gotoToday: () => set((s) => (s.today === '' ? s : { anchor: s.today })),
  extend: () => set((s) => ({ range: Math.min(MAX_RANGE, s.range + 14) })),
}))

/* ---------- derived day model ---------- */

export interface UpcomingModel {
  today: string
  /** effective selected day (never '' — falls back to today) */
  anchor: string
  weekStart: Weekday
  /** ordered ISO dates to render as day sections: today … today+range */
  days: string[]
  /** date → that day's dated tasks, ordered by day_order */
  tasksByDay: Map<string, Task[]>
  /** overdue tasks (due.date < today), ordered by date then time */
  overdueTasks: Task[]
  /** every date that carries at least one dated task (drives week-strip dots) */
  datesWithTasks: ReadonlySet<string>
  /** all active dated tasks (the drag handler's lookup pool) */
  dated: Task[]
  isLoading: boolean
  gotoWeek: (dir: 1 | -1) => void
  gotoToday: () => void
  setAnchor: (date: string) => void
  extend: () => void
}

export function useUpcomingDays(): UpcomingModel {
  const ctx = useParseCtx()
  const today = dateInTz(ctx.now, ctx.timezone)
  const tasksQuery = useActiveTasks()

  const anchor = useUpcomingStore((s) => s.anchor)
  const range = useUpcomingStore((s) => s.range)
  const syncToday = useUpcomingStore((s) => s.syncToday)
  const gotoWeek = useUpcomingStore((s) => s.gotoWeek)
  const gotoToday = useUpcomingStore((s) => s.gotoToday)
  const setAnchor = useUpcomingStore((s) => s.setAnchor)
  const extend = useUpcomingStore((s) => s.extend)

  // Keep the store's today mirror current (rolls anchor forward across midnight).
  useEffect(() => {
    syncToday(today)
  }, [today, syncToday])

  const dated = useMemo(
    () => activeTasks(tasksQuery.data ?? []).filter((t) => t.due !== null),
    [tasksQuery.data],
  )
  const days = useMemo(
    () => Array.from({ length: range + 1 }, (_, i) => addDaysIso(today, i)),
    [today, range],
  )
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const d of days) map.set(d, byDayOrder(dueOn(dated, d)))
    return map
  }, [days, dated])
  const overdueTasks = useMemo(
    () =>
      [...overdue(dated, today)].sort(
        (a, b) =>
          (a.due?.date ?? '').localeCompare(b.due?.date ?? '') ||
          (a.due?.time ?? '').localeCompare(b.due?.time ?? '') ||
          a.day_order - b.day_order,
      ),
    [dated, today],
  )
  const datesWithTasks = useMemo(() => new Set(dated.map((t) => t.due?.date ?? '')), [dated])

  return {
    today,
    anchor: anchor === '' ? today : anchor,
    weekStart: ctx.weekStart,
    days,
    tasksByDay,
    overdueTasks,
    datesWithTasks,
    dated,
    isLoading: tasksQuery.isLoading,
    gotoWeek,
    gotoToday,
    setAnchor,
    extend,
  }
}
