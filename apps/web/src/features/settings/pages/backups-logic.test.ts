import { describe, expect, it } from 'vitest'
import {
  BackupInfoSchema,
  BackupSettingsDtoSchema,
  backupDownloadHref,
  backupKindLabel,
  confirmMatchesRestore,
  formatBackupSize,
  formatBackupTimestamp,
  formatRelativeTime,
  parseRetentionInput,
  resolveBackupsView,
} from './backups-logic'

const sampleBackup = BackupInfoSchema.parse({
  id: 'bk_1',
  filename: 'opentask-backup-2026-07-15.zip',
  kind: 'scheduled',
  sizeBytes: 2048,
  includesAttachments: false,
  createdAt: '2026-07-15T03:00:00Z',
})

describe('BackupInfoSchema', () => {
  it('parses the frozen server shape', () => {
    expect(sampleBackup).toEqual({
      id: 'bk_1',
      filename: 'opentask-backup-2026-07-15.zip',
      kind: 'scheduled',
      sizeBytes: 2048,
      includesAttachments: false,
      createdAt: '2026-07-15T03:00:00Z',
    })
  })

  it('rejects an unknown kind', () => {
    expect(() => BackupInfoSchema.parse({ ...sampleBackup, kind: 'weekly' })).toThrow()
  })
})

describe('BackupSettingsDtoSchema', () => {
  it('accepts explicit overrides alongside resolved effective values', () => {
    const dto = BackupSettingsDtoSchema.parse({
      retentionDays: null,
      includeAttachments: true,
      effective: { retentionDays: 14, includeAttachments: true },
    })
    expect(dto.retentionDays).toBeNull()
    expect(dto.effective.retentionDays).toBe(14)
  })
})

describe('resolveBackupsView', () => {
  it('reports loading before the first result settles', () => {
    expect(resolveBackupsView({ isLoading: true, isError: false, data: undefined })).toEqual({
      kind: 'loading',
    })
    // Settled but still without data is treated as loading, never a false empty state.
    expect(resolveBackupsView({ isLoading: false, isError: false, data: undefined })).toEqual({
      kind: 'loading',
    })
  })

  it('shows the empty state when the endpoint returns no rows', () => {
    expect(resolveBackupsView({ isLoading: false, isError: false, data: [] })).toEqual({
      kind: 'empty',
    })
  })

  it('lists snapshot rows when present', () => {
    expect(resolveBackupsView({ isLoading: false, isError: false, data: [sampleBackup] })).toEqual({
      kind: 'list',
      backups: [sampleBackup],
    })
  })

  it('surfaces failures as an error with a fallback message', () => {
    expect(
      resolveBackupsView({
        isLoading: false,
        isError: true,
        data: undefined,
        errorMessage: 'boom',
      }),
    ).toEqual({ kind: 'error', message: 'boom' })
    const view = resolveBackupsView({ isLoading: false, isError: true, data: undefined })
    expect(view.kind).toBe('error')
    if (view.kind === 'error') expect(view.message.length).toBeGreaterThan(0)
  })
})

describe('formatBackupSize', () => {
  it('returns an em dash for unknown or invalid sizes', () => {
    expect(formatBackupSize(null)).toBe('—')
    expect(formatBackupSize(-1)).toBe('—')
    expect(formatBackupSize(Number.NaN)).toBe('—')
  })

  it('formats bytes across units', () => {
    expect(formatBackupSize(0)).toBe('0 B')
    expect(formatBackupSize(512)).toBe('512 B')
    expect(formatBackupSize(1024)).toBe('1 KB')
    expect(formatBackupSize(1536)).toBe('1.5 KB')
    expect(formatBackupSize(1024 * 1024)).toBe('1 MB')
    expect(formatBackupSize(3 * 1024 * 1024 * 1024)).toBe('3 GB')
  })
})

describe('formatBackupTimestamp', () => {
  it('returns an em dash for empty or invalid input', () => {
    expect(formatBackupTimestamp('')).toBe('—')
    expect(formatBackupTimestamp('not-a-date')).toBe('—')
  })

  it('renders a non-empty label for a valid ISO instant', () => {
    const label = formatBackupTimestamp('2026-07-15T09:30:00Z')
    expect(label).not.toBe('—')
    expect(label.length).toBeGreaterThan(0)
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-07-15T12:00:00Z')

  it('returns an em dash for empty or invalid input', () => {
    expect(formatRelativeTime('', now)).toBe('—')
    expect(formatRelativeTime('nope', now)).toBe('—')
  })

  it('renders a non-empty relative label for a valid instant', () => {
    const label = formatRelativeTime('2026-07-15T10:00:00Z', now)
    expect(label).not.toBe('—')
    expect(label.length).toBeGreaterThan(0)
  })

  it('distinguishes a recent instant from an old one', () => {
    const recent = formatRelativeTime('2026-07-15T11:59:30Z', now)
    const old = formatRelativeTime('2024-01-01T00:00:00Z', now)
    expect(recent).not.toBe(old)
  })
})

describe('backupDownloadHref', () => {
  it('builds an encoded download path from the filename', () => {
    expect(backupDownloadHref('opentask-backup-2026-07-15.zip')).toBe(
      '/api/v1/backups/opentask-backup-2026-07-15.zip/download',
    )
    expect(backupDownloadHref('jul 15.zip')).toBe('/api/v1/backups/jul%2015.zip/download')
  })
})

describe('backupKindLabel', () => {
  it('maps each kind to a human label', () => {
    expect(backupKindLabel('scheduled')).toBe('Scheduled')
    expect(backupKindLabel('manual')).toBe('Manual')
    expect(backupKindLabel('pre_restore')).toBe('Pre-restore')
  })
})

describe('parseRetentionInput', () => {
  it('treats an empty draft as a reset to default (null)', () => {
    expect(parseRetentionInput('')).toEqual({ ok: true, value: null })
    expect(parseRetentionInput('   ')).toEqual({ ok: true, value: null })
  })

  it('accepts whole numbers within [1, 365]', () => {
    expect(parseRetentionInput('1')).toEqual({ ok: true, value: 1 })
    expect(parseRetentionInput('30')).toEqual({ ok: true, value: 30 })
    expect(parseRetentionInput('365')).toEqual({ ok: true, value: 365 })
  })

  it('rejects out-of-range, fractional, or non-numeric drafts', () => {
    expect(parseRetentionInput('0')).toEqual({ ok: false })
    expect(parseRetentionInput('366')).toEqual({ ok: false })
    expect(parseRetentionInput('1.5')).toEqual({ ok: false })
    expect(parseRetentionInput('-5')).toEqual({ ok: false })
    expect(parseRetentionInput('lots')).toEqual({ ok: false })
  })
})

describe('confirmMatchesRestore', () => {
  it('accepts the confirm word case-insensitively and trimmed', () => {
    expect(confirmMatchesRestore('restore')).toBe(true)
    expect(confirmMatchesRestore('  RESTORE  ')).toBe(true)
    expect(confirmMatchesRestore('Restore')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(confirmMatchesRestore('')).toBe(false)
    expect(confirmMatchesRestore('restor')).toBe(false)
    expect(confirmMatchesRestore('delete')).toBe(false)
  })
})
