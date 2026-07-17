/**
 * Backup restore (phase 9 Task D). Replaces the live database (and, when the backup carries them,
 * attachments) with the contents of an uploaded backup zip, under the app-level maintenance lock so
 * no request touches the database mid-swap. A pre-restore safety snapshot is taken first, and any
 * failure after the swap begins rolls the originals back into place.
 *
 * AS-BUILT ADAPTATION: this codebase is deps-injected (no global db/config), so `restoreFromZip`
 * takes `BackupDeps` — the same structural deps the engine uses — instead of the plan's zero-arg
 * shape. Behaviour matches the plan Task D Step 2 exactly.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { HTTPException } from 'hono/http-exception'
import StreamZip from 'node-stream-zip'
import { closeDatabase, reopenDatabase } from '../db/db'
import { newId } from '../lib/ids'
import type { BackupDeps } from './engine'
import { createBackup } from './engine'
import { withMaintenanceLock } from './lock'

/** Open the extracted db read-only and prove it is a healthy OpenDoist database. Throws 400. */
function verifyRestoreDb(dbFile: string): void {
  let db: InstanceType<typeof Database> | undefined
  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true })
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
      throw new HTTPException(400, {
        message: 'backup verification failed: integrity_check did not return ok',
      })
    }
    const tasksTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .get()
    if (tasksTable === undefined) {
      throw new HTTPException(400, {
        message: 'backup verification failed: no tasks table (not an OpenDoist backup)',
      })
    }
  } catch (err) {
    if (err instanceof HTTPException) throw err
    throw new HTTPException(400, {
      message: `backup verification failed: ${(err as Error).message}`,
    })
  } finally {
    db?.close()
  }
}

/**
 * Restore the database (and attachments, if present) from the backup zip at `zipPath`. Returns the
 * filename of the pre-restore safety snapshot. Throws an HTTPException: 400 for an invalid/unverified
 * zip (live data untouched), 409 if a restore is already running, 500 if the swap failed and was
 * rolled back.
 */
export async function restoreFromZip(
  deps: BackupDeps,
  zipPath: string,
): Promise<{ preRestoreBackup: string }> {
  const dataDir = deps.config.dataDir
  const workDir = join(dataDir, 'tmp', `restore-${newId()}`)
  mkdirSync(workDir, { recursive: true })

  try {
    // Phase 1 (pre-lock): extract + verify. Any failure here is a client error — live data is
    // never touched, so everything surfaces as 400.
    let hasAttachments = false
    try {
      const zip = new StreamZip.async({ file: zipPath })
      try {
        const entries = await zip.entries()
        if (entries['opendoist.db'] === undefined) {
          throw new HTTPException(400, { message: 'backup zip is missing opendoist.db' })
        }
        hasAttachments = Object.keys(entries).some(
          (name) => name.startsWith('attachments/') && !name.endsWith('/'),
        )
        await zip.extract('opendoist.db', join(workDir, 'opendoist.db'))
        if (hasAttachments) {
          mkdirSync(join(workDir, 'attachments'), { recursive: true })
          await zip.extract('attachments/', join(workDir, 'attachments'))
        }
      } finally {
        await zip.close()
      }
      verifyRestoreDb(join(workDir, 'opendoist.db'))
    } catch (err) {
      if (err instanceof HTTPException) throw err
      throw new HTTPException(400, { message: `invalid backup zip: ${(err as Error).message}` })
    }

    // Phase 2 (under the maintenance lock): snapshot, then swap files atomically with rollback.
    return await withMaintenanceLock(async () => {
      const pre = await createBackup(deps, { kind: 'pre_restore' })

      const liveDb = join(dataDir, 'opendoist.db')
      const liveAttachments = join(dataDir, 'attachments')
      /** LIFO undo steps, run in reverse if the swap fails after it began. */
      const undo: Array<() => void> = []

      closeDatabase(deps.sqlite)
      try {
        // Move the live db (and any WAL/SHM sidecars) aside.
        for (const suffix of ['', '-wal', '-shm']) {
          const src = liveDb + suffix
          if (existsSync(src)) {
            const aside = join(workDir, `live-opendoist.db${suffix}`)
            renameSync(src, aside)
            undo.push(() => {
              if (existsSync(src)) rmSync(src, { force: true })
              renameSync(aside, src)
            })
          }
        }
        // Put the verified db in place.
        renameSync(join(workDir, 'opendoist.db'), liveDb)
        undo.push(() => {
          if (existsSync(liveDb)) rmSync(liveDb, { force: true })
        })

        // Swap attachments only when the backup carried them.
        if (hasAttachments) {
          if (existsSync(liveAttachments)) {
            const aside = join(workDir, 'live-attachments')
            renameSync(liveAttachments, aside)
            undo.push(() => {
              if (existsSync(liveAttachments))
                rmSync(liveAttachments, { recursive: true, force: true })
              renameSync(aside, liveAttachments)
            })
          }
          renameSync(join(workDir, 'attachments'), liveAttachments)
          undo.push(() => {
            if (existsSync(liveAttachments))
              rmSync(liveAttachments, { recursive: true, force: true })
          })
        }

        // Reopen against the new file — migrate() upgrades an older backup's schema.
        reopenDatabase(deps.sqlite)
        return { preRestoreBackup: pre.filename }
      } catch (err) {
        for (const step of undo.reverse()) {
          try {
            step()
          } catch (rollbackErr) {
            deps.logger.error({ err: rollbackErr }, 'restore rollback step failed')
          }
        }
        try {
          reopenDatabase(deps.sqlite)
        } catch (reopenErr) {
          deps.logger.error({ err: reopenErr }, 'reopen after restore rollback failed')
        }
        deps.logger.error(
          { err },
          'restore failed after swap began; rolled back to pre-restore state',
        )
        if (err instanceof HTTPException) throw err
        throw new HTTPException(500, { message: 'restore failed and was rolled back' })
      }
    })
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
