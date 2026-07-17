/**
 * Phase 9 background jobs registry (Task A shared wiring — only Task A edits this file).
 * Croner pattern per phase 6 (reminders/scheduler.ts): `protect: true` skips overlapping runs;
 * every job body is guarded so a throwing job (including the pre-implementation stubs) only
 * error-logs and can never crash boot or kill the cron. Keep the guards after implementation.
 */
import type { Database } from 'better-sqlite3'
import { Cron } from 'croner'
import type { Logger } from 'pino'
import { runNightlyBackup } from '../backups/engine'
import type { Config } from '../config'
import { user } from '../db/auth-schema'
import type { Db } from '../db/db'
import { reconcileDayStats } from '../productivity/rollup'
import { checkForUpdate } from './update-check'

/** Structurally identical to backups/engine.ts BackupDeps — index.ts passes one object for both. */
export interface JobDeps {
  db: Db
  sqlite: Database
  config: Config
  logger: Logger
}

export function startJobs(deps: JobDeps): { stop: () => void } {
  const { db, config, logger } = deps
  const crons: Cron[] = []
  const timers: NodeJS.Timeout[] = []
  const guarded = (job: string, fn: () => void | Promise<void>) => async () => {
    try {
      await fn()
    } catch (err) {
      logger.error({ err, job }, 'job failed')
    }
  }

  // backup.nightly — cron from OPENDOIST_BACKUP_CRON (default '0 3 * * *').
  crons.push(
    new Cron(
      config.backupCron,
      { protect: true },
      guarded('backup.nightly', () => runNightlyBackup(deps)),
    ),
  )

  // productivity.reconcile — nightly day_stats/karma repair, per user (single-user: one iteration).
  crons.push(
    new Cron(
      '0 3 * * *',
      { protect: true },
      guarded('productivity.reconcile', () => {
        for (const row of db.select({ id: user.id }).from(user).all()) {
          try {
            reconcileDayStats(db, row.id, 30)
          } catch (err) {
            logger.error({ err, job: 'productivity.reconcile', userId: row.id }, 'job failed')
          }
        }
      }),
    ),
  )

  // update.check — daily at 04:00 plus one run ~10 s after boot; never registered when disabled.
  if (!config.disableUpdateCheck) {
    const run = guarded('update.check', async () => {
      await checkForUpdate(config.version)
    })
    crons.push(new Cron('0 4 * * *', { protect: true }, run))
    const bootCheck = setTimeout(run, 10_000)
    bootCheck.unref()
    timers.push(bootCheck)
  }

  return {
    stop: () => {
      for (const c of crons) c.stop()
      for (const t of timers) clearTimeout(t)
    },
  }
}
