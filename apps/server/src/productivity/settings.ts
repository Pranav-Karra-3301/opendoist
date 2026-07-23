/**
 * Productivity settings accessors (phase 9 Task A — REAL, not a stub).
 *
 * AS-BUILT: phase 5 already persists dailyGoal/weeklyGoal/daysOff/vacationMode/karmaEnabled inside
 * the per-user settings document (core UserSettingsSchema, stored as JSON in `user_settings`), so
 * the plan's `productivity_settings` singleton table is intentionally NOT created — these wrappers
 * read/write the settings document instead. Per-user storage also means both functions take
 * `(db, userId)` (the plan's zero-arg signatures assumed a single-row table and a global db).
 *
 * NOTE for Task K: this module does not publish `settings.updated` on the bus (no bus in scope) —
 * the PATCH route should publish it after calling updateProductivitySettings, mirroring
 * api/routes/user.ts.
 */
import { UserSettingsSchema } from '@opentask/core'
import type { Db } from '../db/db'
import { userSettings } from '../db/schema'
import { nowIso } from '../lib/ids'
import { getSettings } from '../services/task-write'
import { type ProductivitySettings, ProductivitySettingsSchema } from './types'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Read the five productivity fields from the user's settings document (defaults applied).
 *  Legacy phase-5 values outside the productivity bounds (e.g. dailyGoal 0) clamp into range. */
export function getProductivitySettings(db: Db, userId: string): ProductivitySettings {
  const s = getSettings(db, userId)
  return ProductivitySettingsSchema.parse({
    dailyGoal: clamp(s.dailyGoal, 1, 100),
    weeklyGoal: clamp(s.weeklyGoal, 1, 700),
    daysOff: s.daysOff,
    vacationMode: s.vacationMode,
    karmaEnabled: s.karmaEnabled,
  })
}

/**
 * Validate `patch` (partial ProductivitySettings), merge it into the stored settings document,
 * re-validate the whole document through core UserSettingsSchema, and upsert. Returns the updated
 * productivity view. weeklyGoal caps at 700 (core UserSettingsSchema bound; the DTO allows 1000).
 */
export function updateProductivitySettings(
  db: Db,
  userId: string,
  patch: Partial<ProductivitySettings>,
): ProductivitySettings {
  const validated = ProductivitySettingsSchema.partial().parse(patch)
  if (validated.weeklyGoal !== undefined) validated.weeklyGoal = clamp(validated.weeklyGoal, 1, 700)
  const merged = UserSettingsSchema.parse({ ...getSettings(db, userId), ...validated })
  const now = nowIso()
  db.insert(userSettings)
    .values({ userId, settings: JSON.stringify(merged), updatedAt: now })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { settings: JSON.stringify(merged), updatedAt: now },
    })
    .run()
  return getProductivitySettings(db, userId)
}
