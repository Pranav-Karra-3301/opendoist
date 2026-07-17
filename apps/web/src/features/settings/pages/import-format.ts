/**
 * Pure helpers + response schemas for the Import settings page (plan Task H). Kept free of
 * React/DOM so the colocated Vitest suite runs under the repo's node environment. The zod
 * schemas mirror the server's frozen `apps/server/src/import/types.ts` (the web package can't
 * import server code); the display helpers turn a job/report into presentational data.
 */
import { z } from 'zod'

export type ImportSource = 'todoist-csv' | 'todoist-api'
export type ImportMode = 'dry-run' | 'apply'

export const ImportCountsSchema = z.object({
  projects: z.number().int(),
  sections: z.number().int(),
  labels: z.number().int(),
  tasks: z.number().int(),
  comments: z.number().int(),
  skips: z.number().int(),
})
export type ImportCounts = z.infer<typeof ImportCountsSchema>

export const ImportSkipSchema = z.object({
  entity: z.string(),
  ref: z.string(),
  reason: z.string(),
})
export type ImportSkip = z.infer<typeof ImportSkipSchema>

export const ImportReportSchema = z.object({
  mode: z.enum(['dry-run', 'apply']),
  counts: ImportCountsSchema,
  created: ImportCountsSchema,
  skips: z.array(ImportSkipSchema),
})
export type ImportReport = z.infer<typeof ImportReportSchema>

export const ImportProgressSchema = z.object({
  phase: z.enum(['uploading', 'fetching', 'parsing', 'applying', 'done', 'error']),
  detail: z.string().default(''),
  fetched: ImportCountsSchema.partial().optional(),
})
export type ImportProgress = z.infer<typeof ImportProgressSchema>

export const ImportJobSchema = z.object({
  id: z.string(),
  source: z.enum(['todoist-csv', 'todoist-api']),
  mode: z.enum(['dry-run', 'apply']),
  status: z.enum(['running', 'done', 'error']),
  progress: ImportProgressSchema,
  report: ImportReportSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type ImportJob = z.infer<typeof ImportJobSchema>

/** POST /api/v1/import/todoist-{csv,api} → 202 { jobId }. */
export const ImportStartResponseSchema = z.object({ jobId: z.string() })

/** Which import sources this instance offers, from GET /api/v1/info `available_importers`. */
export function availableSources(importers: readonly string[] | undefined): {
  csv: boolean
  api: boolean
} {
  const set = new Set(importers ?? [])
  return { csv: set.has('todoist-csv'), api: set.has('todoist-api') }
}

/** Human label for a job progress phase. */
export function phaseLabel(phase: ImportProgress['phase']): string {
  switch (phase) {
    case 'uploading':
      return 'Uploading…'
    case 'fetching':
      return 'Fetching from Todoist…'
    case 'parsing':
      return 'Reading backup…'
    case 'applying':
      return 'Importing…'
    case 'done':
      return 'Done'
    case 'error':
      return 'Error'
  }
}

const COUNT_ENTITIES: readonly { key: keyof ImportCounts; label: string }[] = [
  { key: 'projects', label: 'Projects' },
  { key: 'sections', label: 'Sections' },
  { key: 'labels', label: 'Labels' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'comments', label: 'Comments' },
]

/** "2 projects, 4 tasks" from a partial fetched-counts object (skips zero/absent entries). */
export function fetchedSummary(fetched: Partial<ImportCounts> | undefined): string {
  if (!fetched) return ''
  const parts: string[] = []
  for (const { key, label } of COUNT_ENTITIES) {
    const n = fetched[key]
    if (typeof n === 'number' && n > 0) parts.push(`${n} ${label.toLowerCase()}`)
  }
  return parts.join(', ')
}

export interface ReportRow {
  key: keyof ImportCounts
  label: string
  found: number
  created: number
}

/** One row per entity pairing "found in source" (counts) with "written" (created). */
export function countRows(report: Pick<ImportReport, 'counts' | 'created'>): ReportRow[] {
  return COUNT_ENTITIES.map(({ key, label }) => ({
    key,
    label,
    found: report.counts[key],
    created: report.created[key],
  }))
}
