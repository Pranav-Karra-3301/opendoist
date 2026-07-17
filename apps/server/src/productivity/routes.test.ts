/**
 * Task K — Productivity API tests.
 *
 * Core karma math (karmaLevel / computeDailyStreak / computeWeeklyStreak / karmaTrend) lives in
 * `@opendoist/core` and is owned + exhaustively tested by Task B. This suite runs in parallel with
 * Task B, so it mocks exactly those four functions (spreading the real module for everything else)
 * and asserts (a) the route feeds them correctly-shaped inputs and (b) it wires their outputs into
 * the DTO. Everything the route computes itself — SQL rollups, 28-day padding, weekly bucketing,
 * 90-day karma history, user scoping — is asserted exactly against a clock-pinned fixture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const karma = vi.hoisted(() => ({
  karmaLevel: vi.fn(),
  computeDailyStreak: vi.fn(),
  computeWeeklyStreak: vi.fn(),
  karmaTrend: vi.fn(),
}))
vi.mock('@opendoist/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opendoist/core')>()
  return { ...actual, ...karma }
})

import { user } from '../db/auth-schema'
import type { Db } from '../db/db'
import { dayStats, karmaLedger } from '../db/schema'
import { newId } from '../lib/ids'
import { createTestApp, json, type TestApp } from '../test/helpers'
import { buildProductivityDto } from './routes'
import {
  ProductivityDtoSchema,
  type ProductivitySettings,
  ProductivitySettingsSchema,
} from './types'

type ProductivityDto = ReturnType<typeof buildProductivityDto>

const BEGINNER = { name: 'Beginner', floor: 0, nextFloor: 500, progress: 0 } as const

beforeEach(() => {
  for (const fn of Object.values(karma)) fn.mockReset()
  karma.karmaLevel.mockReturnValue({ ...BEGINNER })
  karma.computeDailyStreak.mockReturnValue({ current: 0, longest: 0 })
  karma.computeWeeklyStreak.mockReturnValue({ current: 0, longest: 0 })
  karma.karmaTrend.mockReturnValue('flat')
})

let apps: TestApp[] = []
async function make(opts?: Parameters<typeof createTestApp>[0]): Promise<TestApp> {
  const t = await createTestApp(opts)
  apps.push(t)
  return t
}
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
})

function seedDay(
  db: Db,
  userId: string,
  date: string,
  completed: number,
  goalMet = false,
  dayOff = false,
  vacation = false,
): void {
  db.insert(dayStats)
    .values({
      userId,
      date,
      completedCount: completed,
      goalMet,
      isDayOff: dayOff,
      isVacation: vacation,
    })
    .run()
}

type LedgerReason =
  | 'completion'
  | 'on_time_bonus'
  | 'daily_goal'
  | 'weekly_goal'
  | 'overdue_penalty'
  | 'reversal'
  | 'reconcile'

function seedLedger(
  db: Db,
  userId: string,
  date: string,
  reason: LedgerReason,
  delta: number,
  taskId: string | null = null,
): void {
  db.insert(karmaLedger)
    .values({ id: newId(), userId, at: `${date}T12:00:00.000Z`, date, reason, taskId, delta })
    .run()
}

/**
 * Deterministic fixture, "today" = 2026-06-15 (a Monday), UTC, weekStart Monday.
 * day_stats: today(3,met) · Sun 06-14(5,met) · Sat 06-13(2,dayOff) · Mon 06-08(4,met) ·
 *   06-01(1) · 03-07(10) — the last is inside the 400-day streak window but outside 28d/12w.
 * ledger: today +8 (5 completion + 3 on-time) · 06-14 +5 · 06-10 −10 · 06-08 +25 (weekly) ·
 *   2026-01-15 +50 (outside the 90-day history window → shows up as the running-total baseline).
 * Totals: karma 78, this-week 3, week-of-06-08 = 11.
 */
const NOW = '2026-06-15T12:00:00.000Z'
const TODAY = '2026-06-15'
const GOALS = { dailyGoal: 2, weeklyGoal: 10, daysOff: [6, 7], vacationMode: false }

function seedFixture(db: Db, userId: string): void {
  seedDay(db, userId, TODAY, 3, true)
  seedDay(db, userId, '2026-06-14', 5, true)
  seedDay(db, userId, '2026-06-13', 2, false, true)
  seedDay(db, userId, '2026-06-08', 4, true)
  seedDay(db, userId, '2026-06-01', 1)
  seedDay(db, userId, '2026-03-07', 10, true)
  seedLedger(db, userId, TODAY, 'completion', 5, 't1')
  seedLedger(db, userId, TODAY, 'on_time_bonus', 3, 't1')
  seedLedger(db, userId, '2026-06-14', 'completion', 5, 't2')
  seedLedger(db, userId, '2026-06-10', 'overdue_penalty', -10, 't3')
  seedLedger(db, userId, '2026-06-08', 'weekly_goal', 25)
  seedLedger(db, userId, '2026-01-15', 'completion', 50, 't4')
}

function buildFixtureDto(db: Db, userId: string): ProductivityDto {
  return buildProductivityDto(db, userId, {
    now: NOW,
    timezone: 'UTC',
    weekStart: 1,
    karmaEnabled: true,
    goals: GOALS,
  })
}

const findDay = (dto: ProductivityDto, date: string) => dto.days.find((d) => d.date === date)
const findHistory = (dto: ProductivityDto, date: string) =>
  dto.karmaHistory.find((h) => h.date === date)

describe('buildProductivityDto (clock pinned)', () => {
  it('sums karma over only the authed user, then asks core for the level', async () => {
    const t = await make()
    seedFixture(t.deps.db, t.userId)
    karma.karmaLevel.mockReturnValue({
      name: 'Novice',
      floor: 500,
      nextFloor: 2500,
      progress: 0.25,
    })

    const dto = buildFixtureDto(t.deps.db, t.userId)

    expect(dto.karma.total).toBe(78) // 8 + 5 − 10 + 25 + 50
    expect(karma.karmaLevel).toHaveBeenCalledWith(78)
    expect(dto.karma.level).toEqual({ name: 'Novice', floor: 500, nextFloor: 2500, progress: 0.25 })
  })

  it('pads days to 28 (oldest first), reads stored flags, and excludes rows past the window', async () => {
    const t = await make()
    seedFixture(t.deps.db, t.userId)

    const dto = buildFixtureDto(t.deps.db, t.userId)

    expect(dto.days).toHaveLength(28)
    expect(dto.days[0]?.date).toBe('2026-05-19') // today − 27
    expect(dto.days[27]?.date).toBe(TODAY)
    expect(findDay(dto, TODAY)).toEqual({
      date: TODAY,
      completed: 3,
      goalMet: true,
      dayOff: false,
      vacation: false,
    })
    expect(findDay(dto, '2026-06-13')).toEqual({
      date: '2026-06-13',
      completed: 2,
      goalMet: false,
      dayOff: true,
      vacation: false,
    })
    expect(findDay(dto, '2026-06-01')?.completed).toBe(1)
    // a day with no row is padded to zero
    expect(findDay(dto, '2026-05-20')).toEqual({
      date: '2026-05-20',
      completed: 0,
      goalMet: false,
      dayOff: false,
      vacation: false,
    })
    // 2026-03-07 is inside the streak window but well outside the 28-day list
    expect(findDay(dto, '2026-03-07')).toBeUndefined()
  })

  it('buckets the last 12 weeks by weekStart with Σcompleted ≥ weeklyGoal', async () => {
    const t = await make()
    seedFixture(t.deps.db, t.userId)

    const dto = buildFixtureDto(t.deps.db, t.userId)

    expect(dto.weeks).toHaveLength(12)
    expect(dto.weeks[11]).toEqual({ start: TODAY, completed: 3, goalMet: false }) // current week
    expect(dto.weeks[10]).toEqual({ start: '2026-06-08', completed: 11, goalMet: true }) // 4+2+5 ≥ 10
    expect(dto.weeks[9]).toEqual({ start: '2026-06-01', completed: 1, goalMet: false })
    expect(dto.weeks[0]?.start).toBe('2026-03-30') // today − 77
    // today block and current-week block are consistent
    expect(dto.today).toEqual({ date: TODAY, completed: 3, goalMet: true })
    expect(dto.week).toEqual({ start: TODAY, completed: 3, goalMet: false })
  })

  it('builds 90-day karma history whose running total ends at karma.total', async () => {
    const t = await make()
    seedFixture(t.deps.db, t.userId)

    const dto = buildFixtureDto(t.deps.db, t.userId)

    expect(dto.karmaHistory).toHaveLength(90)
    // the +50 row (2026-01-15) is older than 90 days, so it only shows as the baseline
    expect(dto.karmaHistory[0]).toEqual({ date: '2026-03-18', delta: 0, runningTotal: 50 })
    expect(findHistory(dto, '2026-06-08')?.delta).toBe(25)
    expect(findHistory(dto, '2026-06-10')?.delta).toBe(-10)
    const last = dto.karmaHistory[89]
    expect(last).toEqual({ date: TODAY, delta: 8, runningTotal: 78 })
  })

  it('delegates streaks + trend to core with correctly-shaped inputs', async () => {
    const t = await make()
    seedFixture(t.deps.db, t.userId)
    karma.computeDailyStreak.mockReturnValue({ current: 2, longest: 9 })
    karma.computeWeeklyStreak.mockReturnValue({ current: 1, longest: 4 })
    karma.karmaTrend.mockReturnValue('up')

    const dto = buildFixtureDto(t.deps.db, t.userId)

    // streak engine gets the last-400-days rows (sparse) + today
    const [dailyDays, dailyToday] = karma.computeDailyStreak.mock.calls[0] ?? []
    expect(dailyToday).toBe(TODAY)
    expect(dailyDays).toHaveLength(6)
    expect(dailyDays).toContainEqual({
      date: TODAY,
      completed: 3,
      goalMet: true,
      dayOff: false,
      vacation: false,
    })
    expect(dailyDays).toContainEqual({
      date: '2026-03-07',
      completed: 10,
      goalMet: true,
      dayOff: false,
      vacation: false,
    })
    expect(karma.computeWeeklyStreak).toHaveBeenCalledWith(dailyDays, {
      today: TODAY,
      weeklyGoal: 10,
      weekStart: 1,
    })

    // trend gets 14 daily deltas, oldest first
    const trendArg = karma.karmaTrend.mock.calls[0]?.[0] as number[]
    expect(trendArg).toHaveLength(14)
    expect(trendArg[13]).toBe(8) // today
    expect(trendArg[12]).toBe(5) // 06-14
    expect(trendArg[8]).toBe(-10) // 06-10
    expect(trendArg[6]).toBe(25) // 06-08
    expect(trendArg[0]).toBe(0) // 06-02, nothing there

    // outputs are wired straight through
    expect(dto.streaks).toEqual({
      daily: { current: 2, longest: 9 },
      weekly: { current: 1, longest: 4 },
    })
    expect(dto.karma.trend).toBe('up')
  })

  it('does not count another user’s ledger or day_stats rows', async () => {
    const t = await make()
    t.deps.db.insert(user).values({ id: 'user-b', name: 'B', email: 'b@example.com' }).run()
    seedFixture(t.deps.db, t.userId)
    // user B has louder numbers on the very same dates
    seedDay(t.deps.db, 'user-b', TODAY, 999, true)
    seedLedger(t.deps.db, 'user-b', TODAY, 'completion', 999, 'x1')
    seedLedger(t.deps.db, 'user-b', '2026-01-15', 'completion', 999)

    const dto = buildFixtureDto(t.deps.db, t.userId)

    expect(dto.karma.total).toBe(78)
    expect(karma.karmaLevel).toHaveBeenCalledWith(78)
    expect(dto.today.completed).toBe(3)
    expect(findHistory(dto, TODAY)?.delta).toBe(8)
  })

  it('reflects karmaEnabled + goals passthrough', async () => {
    const t = await make()
    const dto = buildProductivityDto(t.deps.db, t.userId, {
      now: NOW,
      timezone: 'UTC',
      weekStart: 1,
      karmaEnabled: false,
      goals: { dailyGoal: 7, weeklyGoal: 30, daysOff: [7], vacationMode: true },
    })
    expect(dto.karmaEnabled).toBe(false)
    expect(dto.goals).toEqual({ dailyGoal: 7, weeklyGoal: 30, daysOff: [7], vacationMode: true })
  })
})

describe('GET /api/v1/productivity', () => {
  it('returns a zeroed, schema-valid DTO for an empty database', async () => {
    const t = await make()
    const res = await t.get('/api/v1/productivity')
    expect(res.status).toBe(200)
    const dto = ProductivityDtoSchema.parse(await json(res))

    expect(dto.karma.total).toBe(0)
    expect(karma.karmaLevel).toHaveBeenCalledWith(0)
    expect(dto.karma.level.name).toBe('Beginner')
    expect(dto.streaks).toEqual({
      daily: { current: 0, longest: 0 },
      weekly: { current: 0, longest: 0 },
    })
    expect(dto.karma.trend).toBe('flat')
    expect(dto.days).toHaveLength(28)
    expect(dto.days.every((d) => d.completed === 0 && !d.goalMet)).toBe(true)
    expect(dto.weeks).toHaveLength(12)
    expect(dto.weeks.every((w) => w.completed === 0 && !w.goalMet)).toBe(true)
    expect(dto.karmaHistory).toHaveLength(90)
    expect(dto.karmaHistory.every((h) => h.delta === 0 && h.runningTotal === 0)).toBe(true)
    expect(dto.today.completed).toBe(0)
    // empty DB → core defaults surface as goals
    expect(dto.goals).toEqual({
      dailyGoal: 5,
      weeklyGoal: 25,
      daysOff: [6, 7],
      vacationMode: false,
    })
    expect(dto.karmaEnabled).toBe(true)
  })

  it('serves real-time rollups through the router (auth + wiring)', async () => {
    const t = await make()
    const { dateInTz } = await import('@opendoist/core')
    const today = dateInTz(new Date().toISOString(), 'UTC')
    seedDay(t.deps.db, t.userId, today, 2, true)
    seedLedger(t.deps.db, t.userId, today, 'completion', 5, 'task-a')
    seedLedger(t.deps.db, t.userId, today, 'on_time_bonus', 3, 'task-a')

    const res = await t.get('/api/v1/productivity')
    expect(res.status).toBe(200)
    const dto = ProductivityDtoSchema.parse(await json(res))
    expect(dto.karma.total).toBe(8)
    expect(karma.karmaLevel).toHaveBeenCalledWith(8)
    expect(dto.today).toEqual({ date: today, completed: 2, goalMet: true })
    expect(dto.karmaHistory[dto.karmaHistory.length - 1]?.runningTotal).toBe(8)
  })

  it('401s without a session', async () => {
    const t = await make()
    const res = await t.request('/api/v1/productivity')
    expect(res.status).toBe(401)
  })
})

describe('productivity settings', () => {
  it('GET returns the core defaults for a fresh user', async () => {
    const t = await make()
    const res = await t.get('/api/v1/productivity/settings')
    expect(res.status).toBe(200)
    const s = ProductivitySettingsSchema.parse(await json(res))
    expect(s).toEqual({
      dailyGoal: 5,
      weeklyGoal: 25,
      daysOff: [6, 7],
      vacationMode: false,
      karmaEnabled: true,
    })
  })

  it('PATCH persists a partial update and merges it', async () => {
    const t = await make()
    const res = await t.patch('/api/v1/productivity/settings', {
      dailyGoal: 7,
      karmaEnabled: false,
    })
    expect(res.status).toBe(200)
    const s = await json<ProductivitySettings>(res)
    expect(s.dailyGoal).toBe(7)
    expect(s.karmaEnabled).toBe(false)
    expect(s.weeklyGoal).toBe(25) // untouched

    const again = await json<ProductivitySettings>(await t.get('/api/v1/productivity/settings'))
    expect(again.dailyGoal).toBe(7)
    expect(again.karmaEnabled).toBe(false)
  })

  it('PATCH accepts a days-off array', async () => {
    const t = await make()
    const res = await t.patch('/api/v1/productivity/settings', {
      daysOff: [1, 2, 3],
      vacationMode: true,
    })
    expect(res.status).toBe(200)
    const s = await json<ProductivitySettings>(res)
    expect(s.daysOff).toEqual([1, 2, 3])
    expect(s.vacationMode).toBe(true)
  })

  it('PATCH rejects an out-of-range dailyGoal with a 400 problem', async () => {
    const t = await make()
    const res = await t.patch('/api/v1/productivity/settings', { dailyGoal: 0 })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    const body = await json<{ title: string }>(res)
    expect(body.title).toBe('validation failed')
    // nothing was written
    const s = await json<ProductivitySettings>(await t.get('/api/v1/productivity/settings'))
    expect(s.dailyGoal).toBe(5)
  })

  it('PATCH rejects an invalid weekday in daysOff', async () => {
    const t = await make()
    const res = await t.patch('/api/v1/productivity/settings', { daysOff: [8] })
    expect(res.status).toBe(400)
  })
})
