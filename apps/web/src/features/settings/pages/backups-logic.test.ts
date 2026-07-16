import { describe, expect, it } from 'vitest'
import {
  BackupEntrySchema,
  backupDownloadHref,
  formatBackupDate,
  formatBackupSize,
  resolveBackupsView,
} from './backups-logic'

describe('resolveBackupsView', () => {
  it('renders the placeholder when GET /backups 404s (data mapped to null)', () => {
    // The query fn maps a 404 to `null`; that must resolve to the phase-9 placeholder.
    expect(resolveBackupsView({ isLoading: false, isError: false, data: null })).toEqual({
      kind: 'unavailable',
    })
  })

  it('reports loading before the first result settles', () => {
    expect(resolveBackupsView({ isLoading: true, isError: false, data: undefined })).toEqual({
      kind: 'loading',
    })
    // Settled but still without data is treated as loading, never a false empty state.
    expect(resolveBackupsView({ isLoading: false, isError: false, data: undefined })).toEqual({
      kind: 'loading',
    })
  })

  it('shows the empty state when the endpoint exists but returns no rows', () => {
    expect(resolveBackupsView({ isLoading: false, isError: false, data: [] })).toEqual({
      kind: 'empty',
    })
  })

  it('lists snapshot rows when present', () => {
    const backups = [BackupEntrySchema.parse({ name: 'opendoist-2026-07-15.db.zip' })]
    expect(resolveBackupsView({ isLoading: false, isError: false, data: backups })).toEqual({
      kind: 'list',
      backups,
    })
  })

  it('surfaces genuine (non-404) failures as an error', () => {
    expect(
      resolveBackupsView({
        isLoading: false,
        isError: true,
        data: undefined,
        errorMessage: 'boom',
      }),
    ).toEqual({ kind: 'error', message: 'boom' })
  })

  it('falls back to a default error message', () => {
    const view = resolveBackupsView({ isLoading: false, isError: true, data: undefined })
    expect(view.kind).toBe('error')
    if (view.kind === 'error') expect(view.message.length).toBeGreaterThan(0)
  })
})

describe('BackupEntrySchema', () => {
  it('defaults optional metadata and keeps unknown keys', () => {
    const parsed = BackupEntrySchema.parse({ name: 'snap.zip', kept: true })
    expect(parsed).toMatchObject({
      name: 'snap.zip',
      size: null,
      createdAt: '',
      downloadUrl: null,
      kept: true,
    })
  })

  it('accepts a fully specified row', () => {
    const parsed = BackupEntrySchema.parse({
      name: 'snap.zip',
      size: 2048,
      createdAt: '2026-07-15T09:30:00Z',
      downloadUrl: '/api/v1/backups/snap.zip/download',
    })
    expect(parsed.size).toBe(2048)
    expect(parsed.downloadUrl).toBe('/api/v1/backups/snap.zip/download')
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

describe('formatBackupDate', () => {
  it('returns an em dash for empty or invalid input', () => {
    expect(formatBackupDate('')).toBe('—')
    expect(formatBackupDate('not-a-date')).toBe('—')
  })

  it('renders a non-empty label for a valid ISO instant', () => {
    const label = formatBackupDate('2026-07-15T09:30:00Z')
    expect(label).not.toBe('—')
    expect(label.length).toBeGreaterThan(0)
  })
})

describe('backupDownloadHref', () => {
  it('prefers the server-provided URL', () => {
    expect(backupDownloadHref({ name: 'snap.zip', downloadUrl: '/dl/snap' })).toBe('/dl/snap')
  })

  it('derives an encoded path from the name when no URL is provided', () => {
    expect(backupDownloadHref({ name: 'jul 15.zip', downloadUrl: null })).toBe(
      '/api/v1/backups/jul%2015.zip/download',
    )
  })
})
