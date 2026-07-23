/**
 * Productivity/karma API — phase 9 Task K.
 *
 *   GET   /api/v1/productivity           → ProductivityDto (scope read)
 *   GET   /api/v1/productivity/settings  → ProductivitySettings
 *   PATCH /api/v1/productivity/settings  → updated ProductivitySettings (read_write via app guard)
 *
 * All computation is scoped to the authed user: every karma_ledger and day_stats read carries
 * `WHERE user_id = ?` (phase 3's composite `(user_id, date)` PK). Karma point/level/streak/trend
 * math lives entirely in `@opentask/core` (pure, zero-IO) — this module only shapes SQL rollups
 * into the frozen DTO and delegates the math. `buildProductivityDto` is exported (and takes an
 * explicit `now` instant) so tests can pin the clock without going through HTTP.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  addDaysIso,
  computeDailyStreak,
  computeWeeklyStreak,
  dateInTz,
  isoWeekday,
  karmaLevel,
  karmaTrend,
  type Weekday,
} from '@opentask/core'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import type { AppEnv } from '../app'
import type { Db } from '../db/db'
import { dayStats, karmaLedger } from '../db/schema'
import { nowIso } from '../lib/ids'
import { problem } from '../lib/problem'
import { getSettings } from '../services/task-write'
import { getProductivitySettings, updateProductivitySettings } from './settings'
import { ProductivityDtoSchema, ProductivitySettingsSchema } from './types'

type ProductivityDto = z.infer<typeof ProductivityDtoSchema>

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]

const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
})

/** Number of trailing day_stats days fed to the streak engine. */
const STREAK_WINDOW = 400
const DAYS_WINDOW = 28
const WEEKS_WINDOW = 12
const KARMA_HISTORY_WINDOW = 90
const TREND_WINDOW = 14

/** Start-of-week calendar date on or before `date`, given the user's `weekStart` weekday (1..7). */
function weekStartOf(date: string, weekStart: number): string {
  const delta = (isoWeekday(date) - weekStart + 7) % 7
  return addDaysIso(date, -delta)
}

interface DayStatRow {
  date: string
  completedCount: number
  goalMet: boolean
  isDayOff: boolean
  isVacation: boolean
}

export interface ProductivityInputs {
  /** ISO instant used to derive the user-tz "today" */
  now: string
  timezone: string
  /** ISO weekday 1..7 (stored/validated as a plain number by WeekdaySchema) */
  weekStart: number
  karmaEnabled: boolean
  goals: { dailyGoal: number; weeklyGoal: number; daysOff: number[]; vacationMode: boolean }
}

/**
 * Assemble the ProductivityDto for `userId` from their karma_ledger + day_stats rows.
 * Pure w.r.t. the injected `now` — no `Date.now()` — so tests can pin the calendar.
 */
export function buildProductivityDto(
  db: Db,
  userId: string,
  inputs: ProductivityInputs,
): ProductivityDto {
  const { now, timezone, weekStart, karmaEnabled, goals } = inputs
  const today = dateInTz(now, timezone)

  // --- karma total: SUM(delta) over the whole ledger (0 when empty) ---
  const totalRow = db
    .select({ total: sql<number>`coalesce(sum(${karmaLedger.delta}), 0)` })
    .from(karmaLedger)
    .where(eq(karmaLedger.userId, userId))
    .get()
  const total = Number(totalRow?.total ?? 0)

  // --- per-day ledger deltas for the last 90 days (covers karmaHistory + 14-day trend) ---
  const earliestHistory = addDaysIso(today, -(KARMA_HISTORY_WINDOW - 1))
  const ledgerRows = db
    .select({ date: karmaLedger.date, delta: sql<number>`sum(${karmaLedger.delta})` })
    .from(karmaLedger)
    .where(
      and(
        eq(karmaLedger.userId, userId),
        gte(karmaLedger.date, earliestHistory),
        lte(karmaLedger.date, today),
      ),
    )
    .groupBy(karmaLedger.date)
    .all()
  const deltaByDate = new Map<string, number>(ledgerRows.map((r) => [r.date, Number(r.delta)]))

  // --- day_stats rows for the last STREAK_WINDOW days (covers days + weeks + streaks) ---
  const earliestStats = addDaysIso(today, -(STREAK_WINDOW - 1))
  const statsRows: DayStatRow[] = db
    .select({
      date: dayStats.date,
      completedCount: dayStats.completedCount,
      goalMet: dayStats.goalMet,
      isDayOff: dayStats.isDayOff,
      isVacation: dayStats.isVacation,
    })
    .from(dayStats)
    .where(
      and(
        eq(dayStats.userId, userId),
        gte(dayStats.date, earliestStats),
        lte(dayStats.date, today),
      ),
    )
    .all()
  const statByDate = new Map<string, DayStatRow>(statsRows.map((r) => [r.date, r]))

  // --- streaks (core walks the calendar; sparse rows = missing days break) ---
  const streakDays = statsRows.map((r) => ({
    date: r.date,
    completed: r.completedCount,
    goalMet: r.goalMet,
    dayOff: r.isDayOff,
    vacation: r.isVacation,
  }))
  const daily = computeDailyStreak(streakDays, today)
  const weekly = computeWeeklyStreak(streakDays, {
    today,
    weeklyGoal: goals.weeklyGoal,
    // WeekdaySchema validates 1..7 at the boundary; narrow to the Weekday literal union for core.
    weekStart: weekStart as Weekday,
  })

  // --- days: last 28, padded with zero-days, oldest first ---
  const days: {
    date: string
    completed: number
    goalMet: boolean
    dayOff: boolean
    vacation: boolean
  }[] = []
  for (let i = DAYS_WINDOW - 1; i >= 0; i--) {
    const date = addDaysIso(today, -i)
    const row = statByDate.get(date)
    days.push({
      date,
      completed: row?.completedCount ?? 0,
      goalMet: row?.goalMet ?? false,
      dayOff: row?.isDayOff ?? false,
      vacation: row?.isVacation ?? false,
    })
  }

  // --- weeks: last 12 buckets by weekStart, oldest first (current week is last) ---
  const currentWeekStart = weekStartOf(today, weekStart)
  const weeks: { start: string; completed: number; goalMet: boolean }[] = []
  for (let i = WEEKS_WINDOW - 1; i >= 0; i--) {
    const start = addDaysIso(currentWeekStart, -7 * i)
    let completed = 0
    for (let d = 0; d < 7; d++) {
      completed += statByDate.get(addDaysIso(start, d))?.completedCount ?? 0
    }
    weeks.push({ start, completed, goalMet: completed >= goals.weeklyGoal })
  }
  const currentWeek = weeks[weeks.length - 1] ?? {
    start: currentWeekStart,
    completed: 0,
    goalMet: false,
  }

  // --- today ---
  const todayRow = statByDate.get(today)
  const todayDto = {
    date: today,
    completed: todayRow?.completedCount ?? 0,
    goalMet: todayRow?.goalMet ?? false,
  }

  // --- karmaHistory: last 90 days of per-day deltas with a running total ending at `total` ---
  let windowSum = 0
  for (const delta of deltaByDate.values()) windowSum += delta
  let running = total - windowSum
  const karmaHistory: { date: string; delta: number; runningTotal: number }[] = []
  for (let i = KARMA_HISTORY_WINDOW - 1; i >= 0; i--) {
    const date = addDaysIso(today, -i)
    const delta = deltaByDate.get(date) ?? 0
    running += delta
    karmaHistory.push({ date, delta, runningTotal: running })
  }

  // --- trend: last-14-day per-day deltas → core ---
  const trendDeltas: number[] = []
  for (let i = TREND_WINDOW - 1; i >= 0; i--) {
    trendDeltas.push(deltaByDate.get(addDaysIso(today, -i)) ?? 0)
  }
  const trend = karmaTrend(trendDeltas)

  return ProductivityDtoSchema.parse({
    karmaEnabled,
    karma: { total, level: karmaLevel(total), trend },
    goals: {
      dailyGoal: goals.dailyGoal,
      weeklyGoal: goals.weeklyGoal,
      daysOff: goals.daysOff,
      vacationMode: goals.vacationMode,
    },
    today: todayDto,
    week: {
      start: currentWeek.start,
      completed: currentWeek.completed,
      goalMet: currentWeek.goalMet,
    },
    streaks: { daily, weekly },
    days,
    weeks,
    karmaHistory,
  })
}

const getProductivityRoute = createRoute({
  method: 'get',
  path: '/productivity',
  tags: ['Productivity'],
  summary: 'Karma, goals, streaks, and rollups for the current user',
  security,
  responses: {
    200: {
      description: 'Productivity snapshot',
      content: { 'application/json': { schema: ProductivityDtoSchema } },
    },
    401: { description: 'Unauthorized' },
  },
})

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/productivity/settings',
  tags: ['Productivity'],
  summary: 'Goal + karma settings',
  security,
  responses: {
    200: {
      description: 'Productivity settings',
      content: { 'application/json': { schema: ProductivitySettingsSchema } },
    },
    401: { description: 'Unauthorized' },
  },
})

const patchSettingsRoute = createRoute({
  method: 'patch',
  path: '/productivity/settings',
  tags: ['Productivity'],
  summary: 'Update goal + karma settings',
  description:
    'Partial update of dailyGoal / weeklyGoal / daysOff / vacationMode / karmaEnabled. Values are merged into the shared user-settings document and re-validated.',
  security,
  request: {
    body: {
      content: { 'application/json': { schema: ProductivitySettingsSchema.partial() } },
    },
  },
  responses: {
    200: {
      description: 'Updated productivity settings',
      content: { 'application/json': { schema: ProductivitySettingsSchema } },
    },
    400: {
      description: 'Validation failed',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    },
    401: { description: 'Unauthorized' },
  },
})

export const productivityRouter = () => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })

  app.openapi(getProductivityRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    const settings = getSettings(db, auth.userId)
    const prod = getProductivitySettings(db, auth.userId)
    const dto = buildProductivityDto(db, auth.userId, {
      now: nowIso(),
      timezone: settings.timezone,
      weekStart: settings.weekStart,
      karmaEnabled: prod.karmaEnabled,
      goals: {
        dailyGoal: prod.dailyGoal,
        weeklyGoal: prod.weeklyGoal,
        daysOff: prod.daysOff,
        vacationMode: prod.vacationMode,
      },
    })
    return c.json(dto, 200)
  })

  app.openapi(getSettingsRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db } = c.get('deps')
    return c.json(getProductivitySettings(db, auth.userId), 200)
  })

  app.openapi(patchSettingsRoute, (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { db, bus } = c.get('deps')
    const patch = c.req.valid('json')
    const updated = updateProductivitySettings(db, auth.userId, patch)
    bus.publish({
      userId: auth.userId,
      type: 'settings.updated',
      entity: 'settings',
      ids: [auth.userId],
    })
    return c.json(updated, 200)
  })

  return app
}
