import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import StreamZip from 'node-stream-zip'
import { afterEach, expect, it } from 'vitest'
import { backupSettings, backupsMeta } from '../db/schema'
import { newId } from '../lib/ids'
import { createTestApp, type TestApp } from '../test/helpers'
import {
  backupFilePath,
  createBackup,
  effectiveBackupSettings,
  listBackups,
  pruneBackups,
  runNightlyBackup,
} from './engine'
import type { BackupInfo } from './types'

let apps: TestApp[] = []
const tmpDirs: string[] = []
async function make(opts?: Parameters<typeof createTestApp>[0]): Promise<TestApp> {
  const t = await createTestApp(opts)
  apps.push(t)
  return t
}
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Open a produced backup zip; caller must `await zip.close()`. */
function openZip(t: TestApp, filename: string) {
  return new StreamZip.async({ file: backupFilePath(t.dataDir, filename) })
}

/** Seed a fake backup file + its meta row directly (for prune/list reconciliation tests). */
function seedBackup(t: TestApp, filename: string, kind: BackupInfo['kind'], createdAt: string) {
  writeFileSync(join(t.dataDir, 'backups', filename), 'x')
  t.deps.db
    .insert(backupsMeta)
    .values({ id: newId(), filename, kind, sizeBytes: 1, includesAttachments: false, createdAt })
    .run()
}

it('createBackup produces a zip whose opentask.db passes integrity_check', async () => {
  const t = await make()
  const info = await createBackup(t.deps, { kind: 'manual' })

  expect(info.kind).toBe('manual')
  expect(info.filename).toMatch(/^opentask-backup-\d{4}-\d{2}-\d{2}\.zip$/)
  expect(info.sizeBytes).toBeGreaterThan(0)
  expect(info.id).toBeTruthy()
  // meta row persisted.
  expect(t.deps.db.select().from(backupsMeta).all()).toHaveLength(1)

  const zip = openZip(t, info.filename)
  const meta = JSON.parse((await zip.entryData('meta.json')).toString()) as {
    app: string
    schema: string
    version: string
    includesAttachments: boolean
  }
  expect(meta.app).toBe('opentask')
  expect(meta.schema).toBe('v1')
  expect(typeof meta.version).toBe('string')
  expect(meta.includesAttachments).toBe(true)

  const out = mkdtempSync(join(tmpdir(), 'od-verify-'))
  tmpDirs.push(out)
  const dbOut = join(out, 'opentask.db')
  await zip.extract('opentask.db', dbOut)
  await zip.close()

  const restored = new Database(dbOut, { readonly: true })
  expect(restored.pragma('integrity_check', { simple: true })).toBe('ok')
  expect(
    restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get(),
  ).toBeTruthy()
  restored.close()
})

it('effectiveBackupSettings falls back row ?? env ?? default', async () => {
  const dflt = await make()
  expect(effectiveBackupSettings(dflt.deps)).toEqual({
    retentionDays: 14,
    includeAttachments: true,
  })

  const env = await make({
    env: { OPENTASK_BACKUP_RETENTION: '7', OPENTASK_BACKUP_INCLUDE_ATTACHMENTS: 'false' },
  })
  expect(effectiveBackupSettings(env.deps)).toEqual({ retentionDays: 7, includeAttachments: false })

  // Row overrides env/default; a null field falls through, `false` is honored (not treated absent).
  env.deps.db
    .insert(backupSettings)
    .values({ id: 1, retentionDays: null, includeAttachments: true })
    .run()
  expect(effectiveBackupSettings(env.deps)).toEqual({ retentionDays: 7, includeAttachments: true })
})

it('includes the attachments tree only when enabled', async () => {
  const t = await make()
  mkdirSync(join(t.dataDir, 'attachments', 'abc'), { recursive: true })
  writeFileSync(join(t.dataDir, 'attachments', 'abc', 'note.txt'), 'attachment bytes')

  const withAtt = await createBackup(t.deps, { kind: 'manual' })
  expect(withAtt.includesAttachments).toBe(true)
  const z1 = openZip(t, withAtt.filename)
  const keys1 = Object.keys(await z1.entries())
  await z1.close()
  expect(keys1).toContain('attachments/abc/note.txt')

  t.deps.db.insert(backupSettings).values({ id: 1, includeAttachments: false }).run()
  const noAtt = await createBackup(t.deps, { kind: 'manual' })
  expect(noAtt.includesAttachments).toBe(false)
  const z2 = openZip(t, noAtt.filename)
  const keys2 = Object.keys(await z2.entries())
  await z2.close()
  expect(keys2.some((k) => k.startsWith('attachments/'))).toBe(false)
})

it('appends a timestamped suffix on a same-day filename collision', async () => {
  const t = await make()
  const first = await createBackup(t.deps, { kind: 'manual' })
  const second = await createBackup(t.deps, { kind: 'manual' })

  expect(first.filename).toMatch(/^opentask-backup-\d{4}-\d{2}-\d{2}\.zip$/)
  expect(second.filename).toMatch(/^opentask-backup-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/)
  expect(second.filename).not.toBe(first.filename)
  const onDisk = readdirSync(join(t.dataDir, 'backups')).filter((f) => f.endsWith('.zip'))
  expect(onDisk).toContain(first.filename)
  expect(onDisk).toContain(second.filename)
})

it('pre_restore backups use the prerestore prefix and are always timestamped', async () => {
  const t = await make()
  const info = await createBackup(t.deps, { kind: 'pre_restore' })
  expect(info.filename).toMatch(/^opentask-prerestore-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/)
})

it('pruneBackups keeps the newest retentionDays regular + newest 3 pre_restore', async () => {
  const t = await make()
  for (const d of ['10', '11', '12', '13', '14']) {
    seedBackup(t, `opentask-backup-2026-07-${d}.zip`, 'scheduled', `2026-07-${d}T03:00:00.000Z`)
  }
  for (const s of ['00', '01', '02', '03']) {
    const name = `opentask-prerestore-2026-07-10-1200${s}.zip`
    seedBackup(t, name, 'pre_restore', `2026-07-10T12:00:${s}.000Z`)
  }
  t.deps.db.insert(backupSettings).values({ id: 1, retentionDays: 2 }).run()

  const deleted = await pruneBackups(t.deps)
  expect(deleted.sort()).toEqual(
    [
      'opentask-backup-2026-07-10.zip',
      'opentask-backup-2026-07-11.zip',
      'opentask-backup-2026-07-12.zip',
      'opentask-prerestore-2026-07-10-120000.zip',
    ].sort(),
  )

  const remaining = await listBackups(t.deps)
  expect(remaining.filter((b) => b.kind !== 'pre_restore')).toHaveLength(2)
  expect(remaining.filter((b) => b.kind === 'pre_restore')).toHaveLength(3)
  const files = readdirSync(join(t.dataDir, 'backups')).filter((f) => f.endsWith('.zip'))
  expect(files).toHaveLength(5)
})

it('listBackups drops vanished rows and adopts orphan files, newest first', async () => {
  const t = await make()
  const real = await createBackup(t.deps, { kind: 'manual' })
  // Delete the real file → its row must be dropped.
  rmSync(backupFilePath(t.dataDir, real.filename))
  // Drop an orphan file with no meta row → must be adopted.
  writeFileSync(join(t.dataDir, 'backups', 'opentask-backup-2026-06-01.zip'), 'orphan')
  writeFileSync(join(t.dataDir, 'backups', 'opentask-prerestore-2026-06-02-090000.zip'), 'orphan')

  const list = await listBackups(t.deps)
  const names = list.map((b) => b.filename)
  expect(names).not.toContain(real.filename)
  expect(names).toContain('opentask-backup-2026-06-01.zip')
  expect(names).toContain('opentask-prerestore-2026-06-02-090000.zip')
  // Adopted kinds inferred from name.
  expect(list.find((b) => b.filename === 'opentask-backup-2026-06-01.zip')?.kind).toBe('scheduled')
  expect(list.find((b) => b.filename === 'opentask-prerestore-2026-06-02-090000.zip')?.kind).toBe(
    'pre_restore',
  )
  // Newest first (2026-06-02 > 2026-06-01).
  expect(names[0]).toBe('opentask-prerestore-2026-06-02-090000.zip')
  // Reconciliation persisted: vanished row gone, orphans adopted.
  expect(t.deps.db.select().from(backupsMeta).all()).toHaveLength(2)
})

it('backupFilePath validates the filename against traversal', async () => {
  const t = await make()
  expect(backupFilePath(t.dataDir, 'opentask-backup-2026-07-17.zip')).toBe(
    join(t.dataDir, 'backups', 'opentask-backup-2026-07-17.zip'),
  )
  expect(backupFilePath(t.dataDir, 'opentask-prerestore-2026-07-17-120000.zip')).toBe(
    join(t.dataDir, 'backups', 'opentask-prerestore-2026-07-17-120000.zip'),
  )
  expect(() => backupFilePath(t.dataDir, '../evil.zip')).toThrow()
  expect(() => backupFilePath(t.dataDir, 'opentask-backup-2026-07-17.zip/../x')).toThrow()
})

it('runNightlyBackup creates a scheduled backup and never throws', async () => {
  const t = await make()
  await runNightlyBackup(t.deps)
  const list = await listBackups(t.deps)
  expect(list.some((b) => b.kind === 'scheduled')).toBe(true)

  // Break the sqlite handle → the job must swallow the error and resolve.
  const broken = await createTestApp()
  tmpDirs.push(broken.dataDir)
  broken.deps.sqlite.close()
  await expect(runNightlyBackup(broken.deps)).resolves.toBeUndefined()
})
