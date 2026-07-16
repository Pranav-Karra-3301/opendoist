/**
 * Pure, framework-free helpers for the Backups settings page (Task U). Kept in a
 * separate module (zero React / zero window access) so the colocated Vitest suite
 * runs under the repo's `environment: 'node'` config without a DOM.
 *
 * Backups themselves ship in phase 9 (spec §2.6): a nightly `VACUUM INTO` snapshot
 * into `/data/backups`, retention default 14 (`OPENDOIST_BACKUP_RETENTION`), with
 * download/restore/back-up-now in this UI and an optional Litestream sidecar. This
 * phase renders only the shell, so `GET /api/v1/backups` 404s today — that maps to
 * the "unavailable" placeholder rather than an error, and no rows are fabricated.
 */
import { z } from 'zod'

/** Default retention shown in the UI; overridable via `OPENDOIST_BACKUP_RETENTION`. */
export const DEFAULT_BACKUP_RETENTION = 14

/**
 * Tolerant shape for one backup snapshot row. `GET /api/v1/backups` ships in phase 9;
 * this schema is intentionally permissive (unknown keys pass through, optional
 * metadata defaults) so a future server shape renders without a client change.
 */
export const BackupEntrySchema = z
  .object({
    name: z.string(),
    /** snapshot size in bytes; null when the server omits it */
    size: z.number().nonnegative().nullable().default(null),
    /** ISO instant the snapshot was taken */
    createdAt: z.string().default(''),
    /** direct download URL/path; null → derive one from `name` */
    downloadUrl: z.string().nullable().default(null),
  })
  .passthrough()
export type BackupEntry = z.infer<typeof BackupEntrySchema>
export const BackupListSchema = z.array(BackupEntrySchema)

/** View state the page renders, derived purely from the query result. */
export type BackupsView =
  | { kind: 'loading' }
  | { kind: 'unavailable' } // GET /api/v1/backups → 404 (phase 9 not shipped)
  | { kind: 'empty' } // endpoint exists but no snapshots yet
  | { kind: 'list'; backups: BackupEntry[] }
  | { kind: 'error'; message: string }

export interface BackupsQueryResult {
  isLoading: boolean
  isError: boolean
  /** null = endpoint returned 404 (mapped in the query fn); array = snapshot rows */
  data: BackupEntry[] | null | undefined
  errorMessage?: string
}

/**
 * Map a TanStack query result to the page's view state. A 404 is mapped to `null`
 * upstream (not an error) so it lands on the phase-9 placeholder; genuine failures
 * (500/network/parse) surface the error card.
 */
export function resolveBackupsView(result: BackupsQueryResult): BackupsView {
  if (result.isError) {
    return { kind: 'error', message: result.errorMessage ?? 'Could not load backups.' }
  }
  if (result.isLoading || result.data === undefined) return { kind: 'loading' }
  if (result.data === null) return { kind: 'unavailable' }
  if (result.data.length === 0) return { kind: 'empty' }
  return { kind: 'list', backups: result.data }
}

/** Human-readable byte size for the table's Size column; `—` when unknown. */
export function formatBackupSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exp
  const rounded = exp === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[exp]}`
}

/** Localised date for the table's Date column; `—` for empty/invalid input. */
export function formatBackupDate(iso: string): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ms),
  )
}

/** Download target for a snapshot row: the server URL when provided, else derived. */
export function backupDownloadHref(backup: Pick<BackupEntry, 'name' | 'downloadUrl'>): string {
  if (backup.downloadUrl && backup.downloadUrl.length > 0) return backup.downloadUrl
  return `/api/v1/backups/${encodeURIComponent(backup.name)}/download`
}
