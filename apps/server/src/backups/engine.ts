/**
 * Backups engine — phase 9 Task C. Implements the FROZEN signatures declared by Task A Step 5
 * (see the stub git history); every export here stays byte-compatible with that contract.
 *
 * A backup is a single `.zip` under `<dataDir>/backups/` containing a `VACUUM INTO` snapshot of
 * the live SQLite database (`opendoist.db`, guaranteed consistent), a `meta.json` manifest, and —
 * when enabled — the `attachments/` tree. Writes are staged to `.tmp-*` paths and renamed into
 * place so a crash never leaves a half-written backup under a real name.
 *
 * AS-BUILT ADAPTATION (Task A): this codebase deps-injects everything, so each function takes a
 * `BackupDeps` first parameter (routes pass `c.get('deps')`, the jobs registry passes its own
 * pick); `backupFilePath` takes the `dataDir` string. Everything after that matches the plan.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import archiver from 'archiver'
import type { Database } from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { Config } from '../config'
import type { Db } from '../db/db'
import { backupSettings, backupsMeta } from '../db/schema'
import { newId } from '../lib/ids'
import { BACKUP_FILENAME_RE, type BackupInfo } from './types'

/** Structural subset of AppDeps — any object with these four keys works (AppDeps is assignable). */
export interface BackupDeps {
  db: Db
  sqlite: Database
  config: Config
  logger: Logger
}

const backupsDir = (deps: BackupDeps) => join(deps.config.dataDir, 'backups')
const attachmentsDir = (deps: BackupDeps) => join(deps.config.dataDir, 'attachments')

/** Meta rows and adopted disk files carry the same shape as BackupInfo — sort newest first. */
const byNewest = (a: BackupInfo, b: BackupInfo) =>
  b.createdAt.localeCompare(a.createdAt) || b.filename.localeCompare(a.filename)

/**
 * Orphan disk files carry only what the filename encodes: `prerestore` → pre_restore; a bare
 * per-day `backup` name → the nightly `scheduled` job; a timestamped `backup` name → `manual`.
 * (scheduled/manual share one retention pool, so the split is only cosmetic for the UI badge.)
 */
function inferKind(filename: string): BackupInfo['kind'] {
  if (filename.startsWith('opendoist-prerestore-')) return 'pre_restore'
  return /^opendoist-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(filename) ? 'scheduled' : 'manual'
}

/** `backup_settings` row 1 field ?? env (config.*) ?? Task-A default (14 / true). */
export function effectiveBackupSettings(deps: BackupDeps): {
  retentionDays: number
  includeAttachments: boolean
} {
  const row = deps.db.select().from(backupSettings).where(eq(backupSettings.id, 1)).get()
  return {
    retentionDays: row?.retentionDays ?? deps.config.backupRetention,
    includeAttachments: row?.includeAttachments ?? deps.config.backupIncludeAttachments,
  }
}

/** Validates `filename` against BACKUP_FILENAME_RE (throws on mismatch) and joins under `<dataDir>/backups`. */
export function backupFilePath(dataDir: string, filename: string): string {
  if (!BACKUP_FILENAME_RE.test(filename)) {
    throw new Error(`invalid backup filename: ${filename}`)
  }
  return join(dataDir, 'backups', filename)
}

/**
 * Free on-disk name for a new backup. scheduled/manual prefer the bare per-day name
 * (`opendoist-backup-YYYY-MM-DD.zip`) and fall back to a UTC-timestamped name on collision;
 * pre_restore is always timestamped (`opendoist-prerestore-YYYY-MM-DD-HHMMSS.zip`). The rare
 * exact-second collision advances a second at a time, always yielding a BACKUP_FILENAME_RE name.
 */
function nextBackupFilename(dir: string, kind: BackupInfo['kind'], now: Date): string {
  const prefix = kind === 'pre_restore' ? 'opendoist-prerestore' : 'opendoist-backup'
  if (kind !== 'pre_restore') {
    const bare = `${prefix}-${now.toISOString().slice(0, 10)}.zip`
    if (!existsSync(join(dir, bare))) return bare
  }
  const t = new Date(now.getTime())
  for (;;) {
    const iso = t.toISOString()
    const name = `${prefix}-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}.zip`
    if (!existsSync(join(dir, name))) return name
    t.setTime(t.getTime() + 1000)
  }
}

/** Streams `opendoist.db` + `meta.json` (+ optional `attachments/`) into a zip, resolving on flush. */
function writeZip(
  zipPath: string,
  dbPath: string,
  meta: unknown,
  attachRoot: string | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') return
      reject(err)
    })
    archive.pipe(output)
    archive.file(dbPath, { name: 'opendoist.db' })
    archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' })
    if (attachRoot && existsSync(attachRoot)) {
      archive.directory(attachRoot, 'attachments')
    }
    void archive.finalize()
  })
}

/** VACUUM INTO temp db → zip (opendoist.db + meta.json [+ attachments/**]) → rename → meta row. */
export async function createBackup(
  deps: BackupDeps,
  opts: { kind: BackupInfo['kind'] },
): Promise<BackupInfo> {
  const dir = backupsDir(deps)
  mkdirSync(dir, { recursive: true })
  const { includeAttachments } = effectiveBackupSettings(deps)
  const now = new Date()
  const createdAt = now.toISOString()
  const filename = nextBackupFilename(dir, opts.kind, now)
  const finalPath = join(dir, filename)
  const tmpDbPath = join(dir, `.tmp-${newId()}.db`)
  const tmpZipPath = join(dir, `.tmp-${newId()}.zip`)

  try {
    // Single-quotes in the destination path are doubled per SQLite string-literal quoting.
    deps.sqlite.exec(`VACUUM INTO '${tmpDbPath.replace(/'/g, "''")}'`)
    const meta = {
      app: 'opendoist',
      version: deps.config.version,
      createdAt,
      includesAttachments: includeAttachments,
      schema: 'v1',
    }
    await writeZip(tmpZipPath, tmpDbPath, meta, includeAttachments ? attachmentsDir(deps) : null)
    renameSync(tmpZipPath, finalPath)
  } finally {
    rmSync(tmpDbPath, { force: true })
    rmSync(tmpZipPath, { force: true })
  }

  const info: BackupInfo = {
    id: newId(),
    filename,
    kind: opts.kind,
    sizeBytes: statSync(finalPath).size,
    includesAttachments: includeAttachments,
    createdAt,
  }
  deps.db.insert(backupsMeta).values(info).run()
  return info
}

/**
 * Reconcile the `backups_meta` table against the on-disk directory: drop rows whose file vanished
 * and adopt (persist a meta row for) orphan files matching BACKUP_FILENAME_RE, taking size/mtime
 * from disk. Returns the reconciled set, newest first. Idempotent.
 */
function reconcile(deps: BackupDeps): BackupInfo[] {
  const dir = backupsDir(deps)
  mkdirSync(dir, { recursive: true })
  const files = new Set(readdirSync(dir).filter((f) => BACKUP_FILENAME_RE.test(f)))
  const seen = new Set<string>()

  for (const row of deps.db.select().from(backupsMeta).all()) {
    if (files.has(row.filename)) {
      seen.add(row.filename)
    } else {
      deps.db.delete(backupsMeta).where(eq(backupsMeta.id, row.id)).run()
    }
  }
  for (const filename of files) {
    if (seen.has(filename)) continue
    const st = statSync(join(dir, filename))
    deps.db
      .insert(backupsMeta)
      .values({
        id: newId(),
        filename,
        kind: inferKind(filename),
        sizeBytes: st.size,
        includesAttachments: false,
        createdAt: st.mtime.toISOString(),
      })
      .run()
  }
  return deps.db.select().from(backupsMeta).all().sort(byNewest)
}

/** Meta ↔ disk reconciliation (drop vanished rows, adopt orphan files), newest first. */
export async function listBackups(deps: BackupDeps): Promise<BackupInfo[]> {
  return reconcile(deps)
}

/**
 * Keep the newest `retentionDays` scheduled+manual backups and the newest 3 pre_restore backups
 * (count-based: one nightly/day ⇒ ≈ retentionDays days of history); delete older files AND their
 * meta rows. Returns the deleted filenames.
 */
export async function pruneBackups(deps: BackupDeps): Promise<string[]> {
  const infos = reconcile(deps)
  const { retentionDays } = effectiveBackupSettings(deps)
  const dir = backupsDir(deps)
  const regular = infos.filter((b) => b.kind !== 'pre_restore')
  const preRestore = infos.filter((b) => b.kind === 'pre_restore')
  const doomed = [...regular.slice(retentionDays), ...preRestore.slice(3)]

  const deleted: string[] = []
  for (const b of doomed) {
    rmSync(join(dir, b.filename), { force: true })
    deps.db.delete(backupsMeta).where(eq(backupsMeta.id, b.id)).run()
    deleted.push(b.filename)
  }
  return deleted
}

/** createBackup({kind:'scheduled'}) then pruneBackups(); errors logged, never thrown to the scheduler. */
export async function runNightlyBackup(deps: BackupDeps): Promise<void> {
  try {
    const info = await createBackup(deps, { kind: 'scheduled' })
    const pruned = await pruneBackups(deps)
    deps.logger.info(
      { backup: info.filename, sizeBytes: info.sizeBytes, pruned: pruned.length },
      'nightly backup complete',
    )
  } catch (err) {
    deps.logger.error({ err }, 'nightly backup failed')
  }
}
