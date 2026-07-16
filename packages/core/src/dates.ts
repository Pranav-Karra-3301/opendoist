import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays } from 'date-fns'
import type { Weekday } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

/** calendar date of `instant` (ISO UTC string) in `timezone` */
export function dateInTz(instant: string, timezone: string): string {
  const d = new TZDate(instant, timezone)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** wall-clock HH:mm of `instant` in `timezone` */
export function timeInTz(instant: string, timezone: string): string {
  const d = new TZDate(instant, timezone)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO weekday 1..7 of a YYYY-MM-DD calendar date */
export function isoWeekday(date: string): Weekday {
  const d = new Date(`${date}T00:00:00Z`)
  return (((d.getUTCDay() + 6) % 7) + 1) as Weekday
}

export function addDaysIso(date: string, days: number): string {
  // UTC-pure: date-fns addDays does local-time setDate, which stalls across
  // spring-forward on hosts west of UTC (e.g. 2026-03-08 +1 → 2026-03-08 in New York)
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** days from `a` to `b` (b - a) as calendar dates */
export function diffDays(a: string, b: string): number {
  return differenceInCalendarDays(new Date(`${b}T00:00:00Z`), new Date(`${a}T00:00:00Z`))
}

/** next date (strictly after `date` unless `allowSame`) that falls on `weekday` */
export function nextWeekdayOnOrAfter(date: string, weekday: Weekday, allowSame = true): string {
  const current = isoWeekday(date)
  let delta = (weekday - current + 7) % 7
  if (delta === 0 && !allowSame) delta = 7
  return addDaysIso(date, delta)
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** UTC instant for a wall-clock date+time in `timezone` (DST-safe via TZDate) */
export function instantFor(date: string, time: string, timezone: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const tz = new TZDate(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, timezone)
  // TZDate.toISOString() keeps the zone offset; the core contract wants UTC 'Z' instants
  return new Date(tz.getTime()).toISOString()
}

export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
