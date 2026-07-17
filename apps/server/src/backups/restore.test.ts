import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import archiver from 'archiver'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { user } from '../db/auth-schema'
import { projects, tasks } from '../db/schema'
import { newId, nowIso } from '../lib/ids'
import { createTestApp, type TestApp } from '../test/helpers'
import { withMaintenanceLock } from './lock'
import { restoreFromZip } from './restore'

// The engine is a stub during parallel work; restore only needs createBackup (the pre-restore
// snapshot), so mock it to return metadata without writing anything.
vi.mock('./engine', () => ({
  createBackup: vi.fn(async () => ({
    id: 'pre_restore_id',
    filename: 'opendoist-prerestore-2026-07-17-000000.zip',
    kind: 'pre_restore' as const,
    sizeBytes: 0,
    includesAttachments: false,
    createdAt: nowIso(),
  })),
}))

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

/** Seed a task owned by the app's user and return its id + the owner id. */
function seedTask(app: TestApp, content: string): { taskId: string; userId: string } {
  const inbox = app.deps.db.select().from(projects).where(eq(projects.userId, app.userId)).get()
  if (!inbox) throw new Error('expected an Inbox project for the seeded user')
  const taskId = newId()
  const now = nowIso()
  app.deps.db
    .insert(tasks)
    .values({
      id: taskId,
      userId: app.userId,
      projectId: inbox.id,
      content,
      childOrder: 0,
      priority: 4,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return { taskId, userId: app.userId }
}

/** VACUUM a consistent snapshot of `app`'s db into a zip (`opendoist.db` at root + meta.json). */
function makeBackupZip(
  app: TestApp,
  opts?: { attachment?: { name: string; body: string } },
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'od-backup-src-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const snapshot = join(dir, 'snapshot.db')
  app.deps.sqlite.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`)

  let attachmentsDir: string | undefined
  if (opts?.attachment) {
    attachmentsDir = join(dir, 'attachments')
    mkdirSync(attachmentsDir, { recursive: true })
    writeFileSync(join(attachmentsDir, opts.attachment.name), opts.attachment.body)
  }

  const zipPath = join(dir, 'backup.zip')
  return new Promise<string>((resolve, reject) => {
    const out = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 1 } })
    out.on('close', () => resolve(zipPath))
    archive.on('error', reject)
    archive.pipe(out)
    archive.file(snapshot, { name: 'opendoist.db' })
    archive.append(JSON.stringify({ app: 'opendoist', schema: 'v1' }), { name: 'meta.json' })
    if (attachmentsDir) archive.directory(attachmentsDir, 'attachments')
    void archive.finalize()
  })
}

describe('restoreFromZip', () => {
  it('replaces the live database with the backup contents', async () => {
    const source = await createTestApp()
    cleanups.push(() => source.close())
    const { taskId, userId: sourceUser } = seedTask(source, 'RESTORED FROM SOURCE')
    const zipPath = await makeBackupZip(source)

    const target = await createTestApp()
    cleanups.push(() => target.close())
    const targetUser = target.userId
    expect(targetUser).not.toBe(sourceUser)

    const result = await restoreFromZip(target.deps, zipPath)
    expect(result.preRestoreBackup).toMatch(/^opendoist-prerestore-/)

    // The restored task is visible through the SAME (proxied) handle the app already holds.
    const restored = target.deps.db.select().from(tasks).where(eq(tasks.id, taskId)).get()
    expect(restored?.content).toBe('RESTORED FROM SOURCE')
    // Target's own user is gone; the source's user is now present.
    expect(target.deps.db.select().from(user).where(eq(user.id, targetUser)).get()).toBeUndefined()
    expect(target.deps.db.select().from(user).where(eq(user.id, sourceUser)).get()).toBeDefined()
  })

  it('restores attachments carried in the backup', async () => {
    const source = await createTestApp()
    cleanups.push(() => source.close())
    seedTask(source, 'has attachment')
    const zipPath = await makeBackupZip(source, {
      attachment: { name: 'note.txt', body: 'hello-from-backup' },
    })

    const target = await createTestApp()
    cleanups.push(() => target.close())
    await restoreFromZip(target.deps, zipPath)

    const restoredFile = join(target.dataDir, 'attachments', 'note.txt')
    expect(existsSync(restoredFile)).toBe(true)
    expect(readFileSync(restoredFile, 'utf8')).toBe('hello-from-backup')
  })

  it('rejects a corrupted zip with 400 and leaves the live database untouched', async () => {
    const source = await createTestApp()
    cleanups.push(() => source.close())
    const { taskId } = seedTask(source, 'SHOULD NOT APPEAR')
    const validZip = await makeBackupZip(source)

    // Truncate the archive (drops the central directory) to corrupt it.
    const corruptZip = `${validZip}.corrupt.zip`
    const bytes = readFileSync(validZip)
    writeFileSync(corruptZip, bytes.subarray(0, Math.floor(bytes.length / 2)))
    cleanups.push(() => rmSync(corruptZip, { force: true }))

    const target = await createTestApp()
    cleanups.push(() => target.close())
    const targetUser = target.userId

    await expect(restoreFromZip(target.deps, corruptZip)).rejects.toMatchObject({ status: 400 })

    // Live db is intact: the target's own user survives and the source task never landed.
    expect(target.deps.db.select().from(user).where(eq(user.id, targetUser)).get()).toBeDefined()
    expect(target.deps.db.select().from(tasks).where(eq(tasks.id, taskId)).get()).toBeUndefined()
  })

  it('rejects a zip missing opendoist.db with 400', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'od-badzip-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const zipPath = join(dir, 'no-db.zip')
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(zipPath)
      const archive = archiver('zip')
      out.on('close', () => resolve())
      archive.on('error', reject)
      archive.pipe(out)
      archive.append('nope', { name: 'meta.json' })
      void archive.finalize()
    })

    const target = await createTestApp()
    cleanups.push(() => target.close())
    await expect(restoreFromZip(target.deps, zipPath)).rejects.toMatchObject({ status: 400 })
  })

  it('rejects with 409 when a restore is already running', async () => {
    const source = await createTestApp()
    cleanups.push(() => source.close())
    seedTask(source, 'x')
    const zipPath = await makeBackupZip(source)

    const target = await createTestApp()
    cleanups.push(() => target.close())

    // Hold the maintenance lock open, then attempt a restore.
    let release: () => void = () => {}
    const held = withMaintenanceLock(
      () =>
        new Promise<void>((r) => {
          release = r
        }),
    )
    try {
      await expect(restoreFromZip(target.deps, zipPath)).rejects.toMatchObject({ status: 409 })
    } finally {
      release()
      await held
    }
  })

  it('verifyRestoreDb rejection is an HTTPException (400)', async () => {
    // A zip whose opendoist.db is not a real sqlite database fails verification.
    const dir = mkdtempSync(join(tmpdir(), 'od-notdb-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const zipPath = join(dir, 'garbage.zip')
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(zipPath)
      const archive = archiver('zip')
      out.on('close', () => resolve())
      archive.on('error', reject)
      archive.pipe(out)
      archive.append('this is not a sqlite file', { name: 'opendoist.db' })
      void archive.finalize()
    })

    const target = await createTestApp()
    cleanups.push(() => target.close())
    const err = await restoreFromZip(target.deps, zipPath).catch((e) => e)
    expect(err).toBeInstanceOf(HTTPException)
    expect(err.status).toBe(400)
  })
})
