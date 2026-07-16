/**
 * Pure, framework-free helpers for the Productivity settings page (Task R). Kept in a
 * separate module (zero React / zero window access) so the colocated Vitest suite runs
 * under the repo's `environment: 'node'` config without a DOM — matching the
 * `account-logic.ts` pattern in this folder.
 */

/** ISO weekday number, 1 = Monday … 7 = Sunday (matches core `WeekdaySchema`). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * Toggle a weekday in the days-off set, returning a new ascending, de-duplicated array.
 * A day already present is removed; an absent day is added — so any day toggled twice
 * round-trips back to the original set. The sorted/unique shape mirrors how the server
 * persists `days_off`, keeping the optimistic PATCH byte-stable across re-renders.
 */
export function toggleDayOff(daysOff: readonly number[], day: number): number[] {
  const set = new Set(daysOff)
  if (set.has(day)) set.delete(day)
  else set.add(day)
  return [...set].sort((a, b) => a - b)
}

/** True when `day` is in the days-off set — drives a chip's selected/pressed state. */
export function isDayOff(daysOff: readonly number[], day: number): boolean {
  return daysOff.includes(day)
}

/**
 * Clamp a goal field to its allowed integer range. Empty / non-numeric input falls back
 * to `min` so a cleared field never PATCHes `NaN` (daily/weekly `min` is 0 = "disabled").
 * Fractional entries are truncated toward zero to keep goals whole.
 */
export function clampGoal(raw: number | string, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.trunc(n)))
}
