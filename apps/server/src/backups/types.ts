/** Backups — phase 9 FROZEN contract (plan Task A Step 4). Do not edit outside Task A. */
import { z } from 'zod'

export const BackupKindSchema = z.enum(['scheduled', 'manual', 'pre_restore'])
export const BackupInfoSchema = z.object({
  id: z.string(),
  filename: z.string(),
  kind: BackupKindSchema,
  sizeBytes: z.number().int().min(0),
  includesAttachments: z.boolean(),
  createdAt: z.string(),
})
export type BackupInfo = z.infer<typeof BackupInfoSchema>

export const BackupSettingsPatchSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).nullable().optional(),
  includeAttachments: z.boolean().nullable().optional(),
})
export const BackupSettingsDtoSchema = z.object({
  retentionDays: z.number().int().nullable(),
  includeAttachments: z.boolean().nullable(),
  effective: z.object({ retentionDays: z.number().int(), includeAttachments: z.boolean() }),
})
export const RestoreResponseSchema = z.object({
  restored: z.literal(true),
  preRestoreBackup: z.string(),
})

/** valid on-disk backup names — also the download-route guard (path-traversal defense) */
export const BACKUP_FILENAME_RE = /^opendoist-(backup|prerestore)-\d{4}-\d{2}-\d{2}(-\d{6})?\.zip$/
