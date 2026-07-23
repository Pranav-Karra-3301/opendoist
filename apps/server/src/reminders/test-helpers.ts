/**
 * Phase 6 test helpers (Task A Step 9 — frozen signatures). Wraps the phase-3 test
 * bootstrap: `makeTestDb` migrates through the same `openDb` path production uses
 * (no second migration path), and `createTestApp` is re-exported so route suites
 * (Tasks C/E/I/J) use one import.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PARSE_CONTEXT_SETTINGS,
  type ParseContext,
  UserSettingsSchema,
} from '@opentask/core'
import { eq } from 'drizzle-orm'
import { user } from '../db/auth-schema'
import { type Db, openDb } from '../db/db'
import { projects, reminders, tasks, userSettings } from '../db/schema'
import { newId, nowIso } from '../lib/ids'

export { createTestApp, json, type TestApp } from '../test/helpers'

export type ReminderRow = typeof reminders.$inferSelect

/** Real sqlite DB in a temp dir, fully migrated. Always call `close()` (also removes the dir). */
export async function makeTestDb(): Promise<{ db: Db; close: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'opentask-reminders-'))
  const { db, sqlite } = openDb(join(dir, 'test.db'))
  return {
    db,
    close: () => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Insert a user + settings row. Defaults: timezone America/New_York, autoReminderMinutes 30. */
export async function seedUser(
  db: Db,
  over?: { timezone?: string; autoReminderMinutes?: number | null },
): Promise<{ userId: string; timezone: string }> {
  const userId = newId()
  const timezone = over?.timezone ?? 'America/New_York'
  const autoReminderMinutes =
    over?.autoReminderMinutes === undefined ? 30 : over.autoReminderMinutes
  db.insert(user)
    .values({ id: userId, name: 'Test', email: `${userId}@example.com` })
    .run()
  const settings = UserSettingsSchema.parse({ timezone, autoReminderMinutes })
  db.insert(userSettings)
    .values({ userId, settings: JSON.stringify(settings), updatedAt: nowIso() })
    .run()
  return { userId, timezone }
}

/** Insert a task (creating the user's Inbox project on first use). Defaults: dateless, p4, alive. */
export async function seedTask(
  db: Db,
  userId: string,
  over?: Partial<{
    content: string
    dueDate: string | null
    dueTime: string | null
    dueString: string
    recurrenceJson: string | null
    priority: 1 | 2 | 3 | 4
    completedAt: string | null
    deletedAt: string | null
  }>,
): Promise<{ id: string }> {
  const existing = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId))
    .get()
  let projectId: string
  if (existing === undefined) {
    projectId = newId()
    db.insert(projects).values({ id: projectId, userId, name: 'Inbox', isInbox: true }).run()
  } else {
    projectId = existing.id
  }
  const id = newId()
  db.insert(tasks)
    .values({
      id,
      userId,
      projectId,
      content: over?.content ?? 'Test task',
      priority: over?.priority ?? 4,
      dueDate: over?.dueDate ?? null,
      dueTime: over?.dueTime ?? null,
      dueString: over?.dueString ?? null,
      recurrence: over?.recurrenceJson ?? null,
      completedAt: over?.completedAt ?? null,
      deletedAt: over?.deletedAt ?? null,
    })
    .run()
  return { id }
}

/** Insert a reminder row. Defaults: relative 30 min, not auto, unfired, no fire instant. */
export async function seedReminder(
  db: Db,
  over: Partial<ReminderRow> & { userId: string; taskId: string },
): Promise<{ id: string }> {
  const id = over.id ?? newId()
  db.insert(reminders)
    .values({ type: 'relative', minuteOffset: 30, ...over, id })
    .run()
  return { id }
}

/** Core ParseContext with the default week/smart-date settings and the given clock/zone. */
export function userParseContext(timezone: string, now: string): ParseContext {
  return { ...DEFAULT_PARSE_CONTEXT_SETTINGS, now, timezone }
}
