/**
 * Pure, framework-free helpers for the Backups settings page (phase 9, Task I). Kept in a
 * separate module (zero React / zero window access) so the colocated Vitest suite runs
 * under the repo's `environment: 'node'` config without a DOM.
 *
 * Backups ship in phase 9 (spec §2.6): a nightly `VACUUM INTO` snapshot into `/data/backups`
 * with count-based retention (`OPENTASK_BACKUP_RETENTION`), on-demand "back up now", verified
 * restore under a maintenance lock, and download links. The wire shapes below mirror the frozen
 * server contract in `apps/server/src/backups/types.ts` (Task A) — redeclared here because the
 * server package isn't importable from the web app, exactly as `@/api/schemas` redeclares the
 * phase-3 DTOs.
 */
import { z } from 'zod'

/** Backup provenance — mirrors `BackupKindSchema` (server Task A). */
export const BackupKindSchema = z.enum(['scheduled', 'manual', 'pre_restore'])
export type BackupKind = z.infer<typeof BackupKindSchema>

/** One row from `GET /api/v1/backups` — mirrors the server's `BackupInfoSchema`. */
export const BackupInfoSchema = z.object({
  id: z.string(),
  filename: z.string(),
  kind: BackupKindSchema,
  sizeBytes: z.number().int().min(0),
  includesAttachments: z.boolean(),
  createdAt: z.string(),
})
export type BackupInfo = z.infer<typeof BackupInfoSchema>

/** `GET /api/v1/backups/settings` — explicit overrides plus the resolved `effective` values. */
export const BackupSettingsDtoSchema = z.object({
  retentionDays: z.number().int().nullable(),
  includeAttachments: z.boolean().nullable(),
  effective: z.object({
    retentionDays: z.number().int(),
    includeAttachments: z.boolean(),
  }),
})
export type BackupSettingsDto = z.infer<typeof BackupSettingsDtoSchema>

/** Body accepted by `PATCH /api/v1/backups/settings`; `null` resets a field to its env/default. */
export interface BackupSettingsPatch {
  retentionDays?: number | null
  includeAttachments?: boolean | null
}

/** Retention bounds enforced by the server's `BackupSettingsPatchSchema`. */
export const RETENTION_MIN = 1
export const RETENTION_MAX = 365

/** The word a user must type to confirm a destructive restore. */
export const RESTORE_CONFIRM_WORD = 'restore'

/** View state the list renders, derived purely from the query result. */
export type BackupsView =
  | { kind: 'loading' }
  | { kind: 'empty' } // endpoint returned no snapshots yet
  | { kind: 'list'; backups: BackupInfo[] }
  | { kind: 'error'; message: string }

export interface BackupsQueryResult {
  isLoading: boolean
  isError: boolean
  data: BackupInfo[] | undefined
  errorMessage?: string
}

/** Map a TanStack query result to the page's list view state. */
export function resolveBackupsView(result: BackupsQueryResult): BackupsView {
  if (result.isError) {
    return { kind: 'error', message: result.errorMessage ?? 'Could not load backups.' }
  }
  if (result.isLoading || result.data === undefined) return { kind: 'loading' }
  if (result.data.length === 0) return { kind: 'empty' }
  return { kind: 'list', backups: result.data }
}

/** Human-readable byte size for the table's Size column; `—` when unknown/invalid. */
export function formatBackupSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exp
  const rounded = exp === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[exp]}`
}

/** Absolute localised timestamp (used as the Created cell's `title` tooltip); `—` when invalid. */
export function formatBackupTimestamp(iso: string): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ms),
  )
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
]

/** Relative label for the Created column ("2 hours ago", "yesterday"); `—` when invalid. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  const diffSeconds = Math.round((ms - now) / 1000)
  const abs = Math.abs(diffSeconds)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (abs >= seconds || unit === 'second') {
      return rtf.format(Math.round(diffSeconds / seconds), unit)
    }
  }
  return rtf.format(0, 'second')
}

/** Download target for a snapshot row (path-encoded filename). */
export function backupDownloadHref(filename: string): string {
  return `/api/v1/backups/${encodeURIComponent(filename)}/download`
}

/** Human label for the kind badge. */
export function backupKindLabel(kind: BackupKind): string {
  switch (kind) {
    case 'scheduled':
      return 'Scheduled'
    case 'manual':
      return 'Manual'
    case 'pre_restore':
      return 'Pre-restore'
  }
}

/**
 * Interpret the "Backups to keep" input on commit. An empty/blank draft resets to the
 * default (`value: null`); otherwise it must be a whole number within [RETENTION_MIN,
 * RETENTION_MAX]. Anything else is rejected so the caller can revert the draft.
 */
export function parseRetentionInput(
  draft: string,
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = draft.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (!/^\d+$/.test(trimmed)) return { ok: false }
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < RETENTION_MIN || value > RETENTION_MAX) {
    return { ok: false }
  }
  return { ok: true, value }
}

/** Type-to-confirm gate for the restore dialog (case-insensitive, trimmed). */
export function confirmMatchesRestore(typed: string): boolean {
  return typed.trim().toLowerCase() === RESTORE_CONFIRM_WORD
}
