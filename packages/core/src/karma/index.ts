/**
 * Karma/productivity rules — phase 9 (plan Task B).
 * Pure calendar math on ISO strings via `dates.ts` — no IO, no `Date` in public paths.
 * Every export here is byte-compatible with the Task A Step 2 frozen contract.
 */
import { addDaysIso, compareIso, diffDays, isoWeekday } from '../dates'
import type { Weekday } from '../types'

/** Spec §2.5: karma point values. */
export const KARMA_POINTS = {
  completion: 5,
  onTimeBonus: 3,
  dailyGoal: 10,
  weeklyGoal: 25,
  overduePenalty: -10,
} as const

/** Todoist level thresholds (dossier §1.8). */
export const KARMA_LEVELS = [
  { name: 'Beginner', floor: 0 },
  { name: 'Novice', floor: 500 },
  { name: 'Intermediate', floor: 2500 },
  { name: 'Professional', floor: 5000 },
  { name: 'Expert', floor: 7500 },
  { name: 'Master', floor: 10000 },
  { name: 'Grand Master', floor: 20000 },
  { name: 'Enlightened', floor: 50000 },
] as const

export interface KarmaLevelInfo {
  name: string
  floor: number
  /** null at Enlightened */
  nextFloor: number | null
  /** 0..1 progress from floor to nextFloor (1 at Enlightened) */
  progress: number
}
export function karmaLevel(total: number): KarmaLevelInfo {
  // Negative totals stay at Beginner; the progress clamp below keeps them at 0.
  const anchor = Math.max(0, total)
  let name = KARMA_LEVELS[0].name as string
  let floor = KARMA_LEVELS[0].floor as number
  let nextFloor: number | null = null
  for (let i = 0; i < KARMA_LEVELS.length; i++) {
    const level = KARMA_LEVELS[i]
    if (level === undefined) continue
    if (anchor >= level.floor) {
      name = level.name
      floor = level.floor
      const next = KARMA_LEVELS[i + 1]
      nextFloor = next ? next.floor : null
    } else {
      break
    }
  }
  const progress = nextFloor === null ? 1 : clamp01((total - floor) / (nextFloor - floor))
  return { name, floor, nextFloor, progress }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** Points earned by completing a task whose (date-only) due is `dueDate` on `completedDate` (both user-tz calendar dates).
 *  No due → {points: 5, onTime: false, overdueDays: 0}. completed ≤ due → 5+3 onTime. 1–3 days late → 5.
 *  ≥4 days late → 5 + (−10) = −5, overdueDays = diff. */
export function completionDelta(a: { completedDate: string; dueDate: string | null }): {
  points: number
  onTime: boolean
  overdueDays: number
} {
  if (a.dueDate === null) {
    return { points: KARMA_POINTS.completion, onTime: false, overdueDays: 0 }
  }
  const lateDays = diffDays(a.dueDate, a.completedDate) // completedDate − dueDate
  if (lateDays <= 0) {
    return {
      points: KARMA_POINTS.completion + KARMA_POINTS.onTimeBonus,
      onTime: true,
      overdueDays: 0,
    }
  }
  if (lateDays >= 4) {
    return {
      points: KARMA_POINTS.completion + KARMA_POINTS.overduePenalty,
      onTime: false,
      overdueDays: lateDays,
    }
  }
  return { points: KARMA_POINTS.completion, onTime: false, overdueDays: lateDays }
}

/** −10 when deleting a task ≥4 days overdue, else 0. */
export function deletionPenalty(a: { deletedDate: string; dueDate: string | null }): number {
  if (a.dueDate === null) return 0
  const overdueDays = diffDays(a.dueDate, a.deletedDate) // deletedDate − dueDate
  return overdueDays >= 4 ? KARMA_POINTS.overduePenalty : 0
}

export interface StreakDay {
  date: string
  completed: number
  goalMet: boolean
  dayOff: boolean
  vacation: boolean
}

type DayVerdict = 'extend' | 'skip' | 'break'

/** Walk back from `today`. A day EXTENDS the streak when goalMet; is SKIPPED (neither extends nor
 *  breaks) when dayOff || vacation || (date === today && !goalMet); otherwise BREAKS it.
 *  `days` may be sparse (missing date = completed 0, not off, not vacation → breaks). */
export function computeDailyStreak(
  days: StreakDay[],
  today: string,
): { current: number; longest: number } {
  const byDate = new Map<string, StreakDay>()
  for (const d of days) {
    // only consider days on or before `today`
    if (diffDays(d.date, today) >= 0) byDate.set(d.date, d)
  }
  if (byDate.size === 0) return { current: 0, longest: 0 }

  let earliest = today
  for (const date of byDate.keys()) {
    if (compareIso(date, earliest) < 0) earliest = date
  }

  let running = 0
  let longest = 0
  let current = 0
  for (let date = earliest; compareIso(date, today) <= 0; date = addDaysIso(date, 1)) {
    const day = byDate.get(date)
    const isToday = compareIso(date, today) === 0
    const goalMet = day?.goalMet ?? false
    const dayOff = day?.dayOff ?? false
    const vacation = day?.vacation ?? false
    const verdict: DayVerdict = goalMet
      ? 'extend'
      : dayOff || vacation || isToday
        ? 'skip'
        : 'break'
    if (verdict === 'extend') {
      running += 1
      if (running > longest) longest = running
    } else if (verdict === 'break') {
      running = 0
    }
    if (isToday) current = running
  }
  return { current, longest }
}

/** The most recent `weekStart` weekday on or before `date` (the week's anchor date). */
function weekStartOf(date: string, weekStart: Weekday): string {
  const delta = (isoWeekday(date) - weekStart + 7) % 7
  return addDaysIso(date, -delta)
}

/** Weeks bucketed by o.weekStart. A week EXTENDS when Σcompleted ≥ weeklyGoal; SKIPPED when every
 *  non-day-off day is vacation or the week contains `today` and is not yet met; else BREAKS. */
export function computeWeeklyStreak(
  days: StreakDay[],
  o: { today: string; weeklyGoal: number; weekStart: Weekday },
): { current: number; longest: number } {
  const buckets = new Map<string, { sum: number; days: StreakDay[] }>()
  for (const d of days) {
    if (diffDays(d.date, o.today) < 0) continue // ignore days after today
    const key = weekStartOf(d.date, o.weekStart)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.sum += d.completed
      bucket.days.push(d)
    } else {
      buckets.set(key, { sum: d.completed, days: [d] })
    }
  }
  if (buckets.size === 0) return { current: 0, longest: 0 }

  const todayWeek = weekStartOf(o.today, o.weekStart)
  let earliest = todayWeek
  for (const key of buckets.keys()) {
    if (compareIso(key, earliest) < 0) earliest = key
  }

  let running = 0
  let longest = 0
  let current = 0
  for (let week = earliest; compareIso(week, todayWeek) <= 0; week = addDaysIso(week, 7)) {
    const bucket = buckets.get(week)
    const sum = bucket?.sum ?? 0
    const isCurrentWeek = compareIso(week, todayWeek) === 0
    const verdict: DayVerdict =
      sum >= o.weeklyGoal
        ? 'extend'
        : allVacation(bucket?.days ?? []) || isCurrentWeek
          ? 'skip'
          : 'break'
    if (verdict === 'extend') {
      running += 1
      if (running > longest) longest = running
    } else if (verdict === 'break') {
      running = 0
    }
    if (isCurrentWeek) current = running
  }
  return { current, longest }
}

/** True when the week has ≥1 non-day-off day and every such day is a vacation day. */
function allVacation(weekDays: StreakDay[]): boolean {
  const working = weekDays.filter((d) => !d.dayOff)
  return working.length > 0 && working.every((d) => d.vacation)
}

/** Sum of the last 7 entries vs 0 → 'up' | 'down' | 'flat'. Input: per-day karma deltas, oldest first. */
export function karmaTrend(dailyDeltas: number[]): 'up' | 'down' | 'flat' {
  const sum = dailyDeltas.slice(-7).reduce((acc, n) => acc + n, 0)
  if (sum > 0) return 'up'
  if (sum < 0) return 'down'
  return 'flat'
}
