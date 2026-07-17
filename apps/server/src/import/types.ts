/** Todoist importer — phase 9 FROZEN contract (plan Task A Step 4). Do not edit outside Task A. */
import { HmTimeSchema, IsoDateSchema, PrioritySchema } from '@opendoist/core'
import { z } from 'zod'

export const ImportSkipSchema = z.object({
  entity: z.string(),
  ref: z.string(),
  reason: z.string(),
})
export const ImportCommentSchema = z.object({
  content: z.string(),
  postedAt: z.string().nullable(),
})
export const ImportTaskSchema = z.object({
  key: z.string(),
  projectKey: z.string(),
  sectionKey: z.string().nullable(),
  parentKey: z.string().nullable(),
  /** keeps a leading '* ' (uncompletable) if present */
  content: z.string().min(1),
  description: z.string().default(''),
  /** ALWAYS OpenDoist convention (1 = highest) inside a plan */
  priority: PrioritySchema,
  /** natural language, re-parsed at apply time */
  dueString: z.string().nullable().default(null),
  /** concrete fallback (live API due.date) */
  dueDate: IsoDateSchema.nullable().default(null),
  dueTime: HmTimeSchema.nullable().default(null),
  deadline: IsoDateSchema.nullable().default(null),
  durationMin: z.number().int().min(1).max(1440).nullable().default(null),
  labels: z.array(z.string()).default([]),
  childOrder: z.number().int().default(0),
  comments: z.array(ImportCommentSchema).default([]),
})
export const ImportPlanSchema = z.object({
  source: z.enum(['todoist-csv', 'todoist-api']),
  projects: z.array(
    z.object({
      key: z.string(),
      name: z.string().min(1),
      color: z.string().nullable(),
      parentKey: z.string().nullable(),
      /** merged into the existing Inbox, never created */
      isInbox: z.boolean().default(false),
    }),
  ),
  sections: z.array(
    z.object({
      key: z.string(),
      projectKey: z.string(),
      name: z.string().min(1),
      order: z.number().int(),
    }),
  ),
  labels: z.array(
    z.object({ key: z.string(), name: z.string().min(1), color: z.string().nullable() }),
  ),
  tasks: z.array(ImportTaskSchema),
  skips: z.array(ImportSkipSchema),
})
export type ImportPlan = z.infer<typeof ImportPlanSchema>

export const ImportCountsSchema = z.object({
  projects: z.number().int(),
  sections: z.number().int(),
  labels: z.number().int(),
  tasks: z.number().int(),
  comments: z.number().int(),
  skips: z.number().int(),
})
export type ImportCounts = z.infer<typeof ImportCountsSchema>
export const ImportReportSchema = z.object({
  mode: z.enum(['dry-run', 'apply']),
  /** found in source */
  counts: ImportCountsSchema,
  /** written (dry-run: would-write; labels reused ≠ created) */
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
export const ImportJobDtoSchema = z.object({
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

/** Entity totals present in a plan (comments live on tasks; labels/skips counted as listed). */
export function planCounts(plan: ImportPlan): ImportCounts {
  return {
    projects: plan.projects.length,
    sections: plan.sections.length,
    labels: plan.labels.length,
    tasks: plan.tasks.length,
    comments: plan.tasks.reduce((n, t) => n + t.comments.length, 0),
    skips: plan.skips.length,
  }
}
