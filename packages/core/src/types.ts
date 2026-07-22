import { z } from 'zod'

/** Priority: 1 = p1 (highest) … 4 = p4 (default). Todoist's API inverts this; our importer maps. */
export const PrioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
export type Priority = z.infer<typeof PrioritySchema>

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
export const HmTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm')

/** ISO weekday: 1 = Monday … 7 = Sunday */
export const WeekdaySchema = z.number().int().min(1).max(7)
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const RecurrenceSpecSchema = z.object({
  /** 'schedule' = every (advance from previous due) · 'completion' = every! (advance from completion) */
  anchor: z.enum(['schedule', 'completion']),
  freq: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1),
  /** e.g. every mon, fri · 'workday' = Mon–Fri */
  weekdays: z.array(z.union([WeekdaySchema, z.literal('workday')])).default([]),
  /** day-of-month list: every 2, 15, 27 · 'last' = last day */
  monthDays: z.array(z.union([z.number().int().min(1).max(31), z.literal('last')])).default([]),
  /** positional: every 3rd friday / every last workday / every 15th day */
  ordinal: z
    .object({
      nth: z.union([z.number().int().min(1).max(31), z.literal('last')]),
      unit: z.enum(['weekday', 'workday', 'day']),
      /** set when unit === 'weekday' */
      weekday: WeekdaySchema.nullable(),
    })
    .nullable()
    .default(null),
  /** positional forms beyond the single `ordinal` (dossier §1.3): ordinal lists
   *  ('every 15th workday, first workday, last workday' → freq 'monthly', month null) and
   *  month-anchored positionals ('every 1st wed jan, 3rd thu jul' → freq 'yearly', month set) */
  ordinals: z
    .array(
      z.object({
        nth: z.union([z.number().int().min(1).max(31), z.literal('last')]),
        unit: z.enum(['weekday', 'workday', 'day']),
        /** set when unit === 'weekday' */
        weekday: WeekdaySchema.nullable(),
        /** restricts the entry to one month (yearly cadence); null = every month */
        month: z.number().int().min(1).max(12).nullable(),
      }),
    )
    .default([]),
  /** fixed dates: every 14 jan, 14 apr, 15 jun */
  dates: z
    .array(
      z.object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }),
    )
    .default([]),
  /** wall-clock times, e.g. at 20:00 (applies to every occurrence) */
  times: z.array(HmTimeSchema).default([]),
  starting: IsoDateSchema.nullable().default(null),
  /** inclusive */
  until: IsoDateSchema.nullable().default(null),
})
export type RecurrenceSpec = z.infer<typeof RecurrenceSpecSchema>

export const DueSchema = z.object({
  /** the (next) occurrence's calendar date in the user's timezone */
  date: IsoDateSchema,
  /** wall-clock time; null = all-day */
  time: HmTimeSchema.nullable(),
  /** canonical natural-language string this due was parsed from (re-parseable) */
  string: z.string(),
  recurrence: RecurrenceSpecSchema.nullable(),
})
export type Due = z.infer<typeof DueSchema>

export const TokenKindSchema = z.enum([
  'due',
  'duration',
  'deadline',
  'reminder',
  'project',
  'section',
  'label',
  'priority',
  'description',
  'uncompletable',
])
export type TokenKind = z.infer<typeof TokenKindSchema>

/** start/end are UTF-16 code-unit offsets into the ORIGINAL input (for highlighting) */
export const QuickAddTokenSchema = z.object({
  kind: TokenKindSchema,
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  text: z.string(),
})
export type QuickAddToken = z.infer<typeof QuickAddTokenSchema>

export const ReminderDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('relative'), minutesBefore: z.number().int().min(0) }),
  z.object({ kind: z.literal('absolute'), date: IsoDateSchema, time: HmTimeSchema }),
  z.object({ kind: z.literal('recurring'), due: DueSchema }),
])
export type ReminderDraft = z.infer<typeof ReminderDraftSchema>

/** Hard-cutoff deadline: `{natural date}` with an OPTIONAL wall-clock time (`{next friday 5pm}`).
 *  Date + time is a deliberate divergence from Todoist's date-only deadlines (owner decision
 *  2026-07-18). `time` never creates reminders and never affects Today/Upcoming placement;
 *  `deadline:` filter operators stay date-granular. */
export const DeadlineSchema = z.object({
  date: IsoDateSchema,
  /** wall-clock time; null = date-only */
  time: HmTimeSchema.nullable(),
})
export type Deadline = z.infer<typeof DeadlineSchema>

export const ParsedQuickAddSchema = z.object({
  /** input with consumed tokens removed, whitespace collapsed, trimmed */
  title: z.string(),
  tokens: z.array(QuickAddTokenSchema),
  due: DueSchema.nullable(),
  /** false only when `due` exists and its DATE was implied by a standalone time ("4:18pm" →
   *  today/tomorrow) rather than written; composers may substitute a view-context date then */
  dueDateCertain: z.boolean().default(true),
  durationMin: z.number().int().min(1).max(1440).nullable(),
  deadline: DeadlineSchema.nullable(),
  priority: PrioritySchema,
  labels: z.array(z.string()),
  project: z.string().nullable(),
  section: z.string().nullable(),
  reminders: z.array(ReminderDraftSchema),
  description: z.string().nullable(),
  uncompletable: z.boolean(),
})
export type ParsedQuickAdd = z.infer<typeof ParsedQuickAddSchema>

export interface ParseContext {
  /** current instant, ISO-8601 UTC, e.g. '2026-07-15T21:00:00Z' */
  now: string
  /** IANA zone, e.g. 'America/New_York' */
  timezone: string
  /** ISO weekday the user's week starts on (default 1) */
  weekStart: Weekday
  /** what 'next week' resolves to (default 1 = next Monday) */
  nextWeekDay: Weekday
  /** what 'weekend' resolves to (default 6 = Saturday) */
  weekendDay: Weekday
  /** when false, parseQuickAdd emits no due/deadline/reminder tokens from bare text */
  smartDate: boolean
}
export const DEFAULT_PARSE_CONTEXT_SETTINGS = {
  weekStart: 1,
  nextWeekDay: 1,
  weekendDay: 6,
  smartDate: true,
} as const

/* ---------- filter engine ---------- */

export type FilterPredicate =
  | { t: 'today' }
  | { t: 'tomorrow' }
  | { t: 'yesterday' }
  | { t: 'overdue' }
  | { t: 'noDate' }
  | { t: 'noTime' }
  | { t: 'recurring' }
  | { t: 'noDeadline' }
  | { t: 'noLabels' }
  | { t: 'noPriority' }
  | { t: 'subtask' }
  | { t: 'uncompletable' }
  | { t: 'viewAll' }
  | { t: 'noSection' }
  | { t: 'dateOn'; ref: string }
  | { t: 'dateBefore'; ref: string }
  | { t: 'dateAfter'; ref: string }
  | { t: 'dateWithin'; days: number }
  | { t: 'deadlineOn'; ref: string }
  | { t: 'deadlineBefore'; ref: string }
  | { t: 'deadlineAfter'; ref: string }
  | { t: 'createdOn'; ref: string }
  | { t: 'createdBefore'; ref: string }
  | { t: 'createdAfter'; ref: string }
  | { t: 'priority'; value: Priority }
  | { t: 'label'; name: string; wildcard: boolean }
  | { t: 'project'; name: string; withDescendants: boolean }
  | { t: 'section'; name: string; anyProject: boolean }
  | { t: 'search'; text: string }

export type FilterExpr =
  | { t: 'and'; children: FilterExpr[] }
  | { t: 'or'; children: FilterExpr[] }
  | { t: 'not'; child: FilterExpr }
  | FilterPredicate

/** one query can contain comma-separated panes rendered as separate lists */
export interface FilterQuery {
  panes: FilterExpr[]
}

export interface FilterTaskView {
  id: string
  content: string
  description: string
  dueDate: string | null
  dueTime: string | null
  isRecurring: boolean
  deadline: string | null
  priority: Priority
  labels: string[]
  projectId: string
  projectName: string
  sectionName: string | null
  parentId: string | null
  /** ISO instant */
  createdAt: string
  uncompletable: boolean
}

export interface FilterContext {
  now: string
  timezone: string
  weekStart: Weekday
  nextWeekDay: Weekday
  weekendDay: Weekday
  /** project id → node, for ##Project descendant matching */
  projects: ReadonlyMap<string, { name: string; parentId: string | null }>
}

export class FilterSyntaxError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message)
    this.name = 'FilterSyntaxError'
  }
}
