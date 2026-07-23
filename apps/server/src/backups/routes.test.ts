import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HTTPException } from 'hono/http-exception'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, json, type TestApp } from '../test/helpers'
import type { BackupInfo } from './types'

// Engine + restore are owned by other tasks; mock them so these route tests are self-contained.
vi.mock('./engine', () => ({
  createBackup: vi.fn(),
  listBackups: vi.fn(),
  pruneBackups: vi.fn(),
  backupFilePath: vi.fn(),
  effectiveBackupSettings: vi.fn(() => ({ retentionDays: 14, includeAttachments: true })),
  runNightlyBackup: vi.fn(),
}))
vi.mock('./restore', () => ({ restoreFromZip: vi.fn() }))

import { backupFilePath, createBackup, effectiveBackupSettings, listBackups } from './engine'
import { withMaintenanceLock } from './lock'
import { restoreFromZip } from './restore'

const info = (over: Partial<BackupInfo> = {}): BackupInfo => ({
  id: 'b1',
  filename: 'opentask-backup-2026-07-17.zip',
  kind: 'manual',
  sizeBytes: 1234,
  includesAttachments: true,
  createdAt: '2026-07-17T03:00:00.000Z',
  ...over,
})

const apps: TestApp[] = []
async function make(): Promise<TestApp> {
  const t = await createTestApp()
  apps.push(t)
  return t
}

beforeEach(() => {
  vi.mocked(effectiveBackupSettings).mockReturnValue({
    retentionDays: 14,
    includeAttachments: true,
  })
  vi.mocked(listBackups).mockResolvedValue([])
})
afterEach(() => {
  for (const t of apps.splice(0)) t.close()
  vi.clearAllMocks()
})

describe('backups routes — auth', () => {
  it('requires authentication', async () => {
    const t = await make()
    expect((await t.request('/api/v1/backups')).status).toBe(401)
  })

  it('refuses a read-scope token even on GET (a backup is the whole database)', async () => {
    const t = await make()
    const ro = await t.deps.auth.api.createApiKey({
      body: { name: 'ro', userId: t.userId, permissions: { opentask: ['read'] } },
    })
    const res = await t.request('/api/v1/backups', {
      headers: { authorization: `Bearer ${ro.key}` },
    })
    expect(res.status).toBe(403)
    expect((await json<{ title: string }>(res)).title).toBe('insufficient scope')
  })
})

describe('backups routes — list & create', () => {
  it('lists backups in the cursor-pagination envelope', async () => {
    const t = await make()
    vi.mocked(listBackups).mockResolvedValue([info(), info({ id: 'b2', kind: 'scheduled' })])
    const res = await t.get('/api/v1/backups')
    expect(res.status).toBe(200)
    const body = await json<{ results: BackupInfo[]; next_cursor: null }>(res)
    expect(body.next_cursor).toBeNull()
    expect(body.results.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('creates a manual backup', async () => {
    const t = await make()
    vi.mocked(createBackup).mockResolvedValue(info({ id: 'made', kind: 'manual' }))
    const res = await t.post('/api/v1/backups')
    expect(res.status).toBe(201)
    expect((await json<BackupInfo>(res)).id).toBe('made')
    expect(vi.mocked(createBackup)).toHaveBeenCalledWith(expect.anything(), { kind: 'manual' })
  })
})

describe('backups routes — settings', () => {
  it('returns stored (null) + effective settings and patches only present fields', async () => {
    const t = await make()

    const dto0 = await json<{
      retentionDays: number | null
      includeAttachments: boolean | null
      effective: { retentionDays: number; includeAttachments: boolean }
    }>(await t.get('/api/v1/backups/settings'))
    expect(dto0.retentionDays).toBeNull()
    expect(dto0.includeAttachments).toBeNull()
    expect(dto0.effective).toEqual({ retentionDays: 14, includeAttachments: true })

    // Set retentionDays only.
    const dto1 = await json<{ retentionDays: number | null; includeAttachments: boolean | null }>(
      await t.patch('/api/v1/backups/settings', { retentionDays: 30 }),
    )
    expect(dto1.retentionDays).toBe(30)
    expect(dto1.includeAttachments).toBeNull()

    // Set includeAttachments only — retentionDays must be preserved.
    const dto2 = await json<{ retentionDays: number | null; includeAttachments: boolean | null }>(
      await t.patch('/api/v1/backups/settings', { includeAttachments: false }),
    )
    expect(dto2.retentionDays).toBe(30)
    expect(dto2.includeAttachments).toBe(false)

    // Clear retentionDays back to env default with an explicit null.
    const dto3 = await json<{ retentionDays: number | null }>(
      await t.patch('/api/v1/backups/settings', { retentionDays: null }),
    )
    expect(dto3.retentionDays).toBeNull()
  })

  it('rejects an out-of-range retention', async () => {
    const t = await make()
    expect((await t.patch('/api/v1/backups/settings', { retentionDays: 0 })).status).toBe(400)
    expect((await t.patch('/api/v1/backups/settings', { retentionDays: 999 })).status).toBe(400)
  })
})

describe('backups routes — download', () => {
  it('rejects an invalid or traversal filename with 404', async () => {
    const t = await make()
    expect((await t.get('/api/v1/backups/evil.zip/download')).status).toBe(404)
    expect(
      (await t.get(`/api/v1/backups/${encodeURIComponent('../evil.zip')}/download`)).status,
    ).toBe(404)
    // backupFilePath is never consulted for a filename that fails the boundary regex.
    expect(vi.mocked(backupFilePath)).not.toHaveBeenCalled()
  })

  it('streams a real backup file with zip headers', async () => {
    const t = await make()
    const dir = mkdtempSync(join(tmpdir(), 'od-dl-'))
    const file = join(dir, 'opentask-backup-2026-07-17.zip')
    writeFileSync(file, Buffer.from('PK pretend-zip-bytes'))
    vi.mocked(backupFilePath).mockReturnValue(file)
    try {
      const res = await t.get('/api/v1/backups/opentask-backup-2026-07-17.zip/download')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="opentask-backup-2026-07-17.zip"',
      )
      expect(await res.text()).toBe('PK pretend-zip-bytes')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('404s when the resolved file does not exist', async () => {
    const t = await make()
    vi.mocked(backupFilePath).mockReturnValue('/no/such/opentask-backup-2026-07-17.zip')
    expect((await t.get('/api/v1/backups/opentask-backup-2026-07-17.zip/download')).status).toBe(
      404,
    )
  })
})

describe('backups routes — restore', () => {
  const postZip = (t: TestApp) => {
    const fd = new FormData()
    fd.append('file', new File([Buffer.from('zip')], 'backup.zip', { type: 'application/zip' }))
    return t.request('/api/v1/backups/restore', {
      method: 'POST',
      headers: { cookie: t.cookie },
      body: fd,
    })
  }

  it('restores and returns the pre-restore snapshot filename', async () => {
    const t = await make()
    vi.mocked(restoreFromZip).mockResolvedValue({
      preRestoreBackup: 'opentask-prerestore-2026-07-17-030000.zip',
    })
    const res = await postZip(t)
    expect(res.status).toBe(200)
    expect(await json<{ restored: boolean; preRestoreBackup: string }>(res)).toEqual({
      restored: true,
      preRestoreBackup: 'opentask-prerestore-2026-07-17-030000.zip',
    })
    expect(vi.mocked(restoreFromZip)).toHaveBeenCalledOnce()
  })

  it('surfaces a 409 when a restore is already running', async () => {
    const t = await make()
    vi.mocked(restoreFromZip).mockRejectedValue(
      new HTTPException(409, { message: 'a restore is already in progress' }),
    )
    const res = await postZip(t)
    expect(res.status).toBe(409)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    expect((await json<{ title: string }>(res)).title).toBe('restore in progress')
  })

  it('surfaces a 400 for an invalid backup zip', async () => {
    const t = await make()
    vi.mocked(restoreFromZip).mockRejectedValue(
      new HTTPException(400, { message: 'backup zip is missing opentask.db' }),
    )
    const res = await postZip(t)
    expect(res.status).toBe(400)
    expect((await json<{ title: string }>(res)).title).toBe('invalid backup')
  })

  it('rejects a request with no file field', async () => {
    const t = await make()
    const res = await t.request('/api/v1/backups/restore', {
      method: 'POST',
      headers: { cookie: t.cookie },
      body: new FormData(),
    })
    expect(res.status).toBe(400)
  })
})

describe('maintenance guard', () => {
  it('503s the API while a restore holds the lock, but /api/health stays up', async () => {
    const t = await make()
    let release: () => void = () => {}
    const held = withMaintenanceLock(
      () =>
        new Promise<void>((r) => {
          release = r
        }),
    )
    try {
      expect((await t.get('/api/v1/tasks')).status).toBe(503)
      expect((await t.request('/api/health')).status).toBe(200)
    } finally {
      release()
      await held
    }
  })
})
