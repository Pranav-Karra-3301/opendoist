/**
 * Due-chip formatting (dossier §2.7 date colors). Pure string math on ISO dates —
 * no timezone conversions happen here; callers pass today's date in the user's zone.
 */

export type DueTone =
  | 'overdue'
  | 'missed'
  | 'today'
  | 'tomorrow'
  | 'week'
  | 'weekend'
  | 'nextweek'
  | 'future'

/** FROZEN tone → CSS var map. `week`/`future` reuse text-secondary (no own Todoist color);
 *  `missed` (same-day timed due whose time already passed) paints warning orange — softer than
 *  the hard next-day-overdue red (owner decision 2026-07-22). */
export const DUE_TONE_VAR: Record<DueTone, string> = {
  overdue: '--od-date-overdue',
  missed: '--od-warning',
  today: '--od-date-today',
  tomorrow: '--od-date-tomorrow',
  weekend: '--od-date-weekend',
  nextweek: '--od-date-next-week',
  week: '--od-text-secondary',
  future: '--od-text-secondary',
}

const MONTHS = [
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
const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

interface Ymd {
  y: number
  m: number
  d: number
}

function parseIso(iso: string): Ymd {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))
  return { y, m, d }
}

function epochDays({ y, m, d }: Ymd): number {
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
function isoWeekday(ymd: Ymd): number {
  const jsDay = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay() // 0 = Sun
  return ((jsDay + 6) % 7) + 1
}

/** `Jul 2` / `Jul 2, 2025` (year only when it differs from today's). */
function monthDayLabel(ymd: Ymd, todayYear: number): string {
  const base = `${MONTHS[ymd.m - 1]} ${ymd.d}`
  return ymd.y === todayYear ? base : `${base}, ${ymd.y}`
}

/** `16:00` → `4pm`, `09:30` → `9:30am`, `00:00` → `12am`. */
function timeLabel(time: string): string {
  const hours = Number(time.slice(0, 2))
  const minutes = Number(time.slice(3, 5))
  const suffix = hours < 12 ? 'am' : 'pm'
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  return minutes === 0 ? `${h12}${suffix}` : `${h12}:${String(minutes).padStart(2, '0')}${suffix}`
}

/**
 * Format a due date the Todoist way relative to `todayIso`:
 * past → overdue `Jul 2` · today/tomorrow words · next 7 days → weekday name
 * (weekend tone on Sat/Sun) · 8–14 days → `Mon, Jul 27` · beyond → `Jul 30`.
 * A non-null time appends ` 4pm`-style.
 *
 * `nowTime` (wall-clock `HH:mm` in the user's zone) upgrades a SAME-DAY timed due whose
 * time already passed to the `missed` tone; omit it (pickers, composers) to keep plain
 * date tones.
 */
export function formatDueChip(
  due: { date: string; time: string | null },
  todayIso: string,
  nowTime?: string,
): { label: string; tone: DueTone } {
  const target = parseIso(due.date)
  const today = parseIso(todayIso)
  const diff = epochDays(target) - epochDays(today)

  let label: string
  let tone: DueTone
  if (diff < 0) {
    tone = 'overdue'
    label = monthDayLabel(target, today.y)
  } else if (diff === 0) {
    tone = due.time !== null && nowTime !== undefined && due.time < nowTime ? 'missed' : 'today'
    label = 'Today'
  } else if (diff === 1) {
    tone = 'tomorrow'
    label = 'Tomorrow'
  } else if (diff <= 7) {
    const weekday = isoWeekday(target)
    tone = weekday >= 6 ? 'weekend' : 'week'
    label = WEEKDAYS[weekday - 1] as string
  } else if (diff <= 14) {
    tone = 'nextweek'
    const weekday = WEEKDAYS[isoWeekday(target) - 1] as string
    label = `${weekday.slice(0, 3)}, ${monthDayLabel(target, today.y)}`
  } else {
    tone = 'future'
    label = monthDayLabel(target, today.y)
  }

  return { label: due.time === null ? label : `${label} ${timeLabel(due.time)}`, tone }
}
