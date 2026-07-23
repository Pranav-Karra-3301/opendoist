/**
 * Phase 6 FROZEN contracts (plan Task A Step 5) — reminder/push/channel DTOs, the channel
 * adapter interface, scheduler + iCal constants, and shared pure helpers. Tasks B–M import
 * from here and may not redefine any of these shapes. DTO casing is snake_case, matching
 * the as-built phase-3 wire convention.
 */
import { DueSchema, HmTimeSchema, IsoDateSchema, PrioritySchema } from '@opentask/core'
import { z } from 'zod'

/* ---------- reminder DTOs ---------- */
export const ReminderTypeSchema = z.enum(['relative', 'absolute', 'recurring'])
export type ReminderType = z.infer<typeof ReminderTypeSchema>

export const ReminderDtoSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  type: ReminderTypeSchema,
  minute_offset: z.number().int().min(0).nullable(),
  due: DueSchema.nullable(),
  is_auto: z.boolean(),
  fire_at_utc: z.string().nullable(),
  fired_at: z.string().nullable(),
  created_at: z.string(),
})
export type ReminderDto = z.infer<typeof ReminderDtoSchema>

export const CreateReminderBodySchema = z
  .object({
    task_id: z.string(),
    type: ReminderTypeSchema,
    minute_offset: z.number().int().min(0).max(10_080).optional(),
    due: DueSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'relative' && v.minute_offset === undefined)
      ctx.addIssue({ code: 'custom', message: 'relative reminder requires minute_offset' })
    if (
      v.type === 'absolute' &&
      (v.due === undefined || v.due.time === null || v.due.recurrence !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'absolute reminder requires due with date+time and no recurrence',
      })
    if (v.type === 'recurring' && (v.due === undefined || v.due.recurrence === null))
      ctx.addIssue({ code: 'custom', message: 'recurring reminder requires due with recurrence' })
  })
export type CreateReminderBody = z.infer<typeof CreateReminderBodySchema>

export const UpdateReminderBodySchema = z.object({
  minute_offset: z.number().int().min(0).max(10_080).optional(),
  due: DueSchema.optional(),
})

export const TestFireResultSchema = z.object({
  push: z.object({ sent: z.number().int(), gone: z.number().int(), errors: z.number().int() }),
  channels: z.array(
    z.object({ id: z.string(), name: z.string(), outcome: z.enum(['delivered', 'gone', 'error']) }),
  ),
})
export type TestFireResult = z.infer<typeof TestFireResultSchema>

/* ---------- push subscriptions ---------- */
export const PushSubscriptionBodySchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  user_agent: z.string().max(512).optional(),
})
export const PushSubscriptionDtoSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
  user_agent: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
})

/* ---------- notification channels ---------- */
export const NtfyConfigSchema = z.object({
  server: z.string().url().default('https://ntfy.sh'),
  topic: z.string().min(1).max(256),
  token: z.string().max(256).optional(),
})
export const GotifyConfigSchema = z.object({
  server: z.string().url(),
  app_token: z.string().min(1).max(256),
})
export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(8).max(256),
})
export type NtfyConfig = z.infer<typeof NtfyConfigSchema>
export type GotifyConfig = z.infer<typeof GotifyConfigSchema>
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>

export const ChannelTypeSchema = z.enum(['ntfy', 'gotify', 'webhook'])
export type ChannelType = z.infer<typeof ChannelTypeSchema>
export interface ChannelConfigMap {
  ntfy: NtfyConfig
  gotify: GotifyConfig
  webhook: WebhookConfig
}

export const CreateChannelBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ntfy'), name: z.string().min(1).max(120), config: NtfyConfigSchema }),
  z.object({
    type: z.literal('gotify'),
    name: z.string().min(1).max(120),
    config: GotifyConfigSchema,
  }),
  z.object({
    type: z.literal('webhook'),
    name: z.string().min(1).max(120),
    config: WebhookConfigSchema,
  }),
])
export const UpdateChannelBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  config: z.union([NtfyConfigSchema, GotifyConfigSchema, WebhookConfigSchema]).optional(),
})
export const ChannelDtoSchema = z.object({
  id: z.string(),
  type: ChannelTypeSchema,
  name: z.string(),
  enabled: z.boolean(),
  config: z.union([NtfyConfigSchema, GotifyConfigSchema, WebhookConfigSchema]),
  consecutive_failures: z.number().int(),
  disabled_reason: z.string().nullable(),
  created_at: z.string(),
})
export type ChannelDto = z.infer<typeof ChannelDtoSchema>

/* ---------- delivery ---------- */
export const ReminderPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  url: z.string(),
  tag: z.string(),
  task_id: z.string(),
  reminder_id: z.string(),
  fired_at: z.string(),
  priority: PrioritySchema,
  due: z.object({ date: IsoDateSchema, time: HmTimeSchema.nullable() }).nullable(),
  test: z.boolean(),
})
export type ReminderPayload = z.infer<typeof ReminderPayloadSchema>

export type SendOutcome = 'delivered' | 'gone' | 'error'

export interface ChannelDeps {
  fetch: typeof globalThis.fetch
  sleep: (ms: number) => Promise<void>
  log: (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void
}

export interface ChannelAdapter<K extends ChannelType> {
  readonly type: K
  readonly configSchema: z.ZodType<ChannelConfigMap[K], unknown>
  send(
    payload: ReminderPayload,
    config: ChannelConfigMap[K],
    deps: ChannelDeps,
  ): Promise<SendOutcome>
}

/* ---------- scheduler constants ---------- */
export const SCHEDULER_TICK_SECONDS = 30
export const SCHEDULER_BATCH_LIMIT = 100
export const STALE_SUPPRESS_MS = 12 * 60 * 60 * 1000
export const WEBHOOK_AUTO_DISABLE_AFTER = 10

/* ---------- iCal constants ---------- */
export const ICAL_WINDOW = { backDays: 31, forwardDays: 186, maxEvents: 500 } as const

/* ---------- shared pure helpers (implemented here, tested in contracts.test.ts by Task B) ---------- */
/** Deep link into the SPA. Phase 4 Task A Step 9 registers `/task/:id` as the CANONICAL task
 *  deep-link route (it opens the app with the detail dialog); phase 8's `opentask open` uses the
 *  same URL. AS-BUILT (verified 2026-07-16): `/task/$taskId` exists in apps/web/src/router.tsx. */
export function taskDeepLink(publicUrl: string | null, taskId: string): string {
  const base = (publicUrl ?? 'http://localhost:7968').replace(/\/+$/, '')
  return `${base}/task/${taskId}`
}
/** Humanize a heads-up lead in minutes: 30 → "30 min", 90 → "1 hr 30 min", 2880 → "2 days". */
export function formatLead(minutes: number): string {
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d} day${d === 1 ? '' : 's'}`)
  if (h > 0) parts.push(`${h} hr`)
  // Once days are involved, minute precision is noise (Todoist-style rounding).
  if (m > 0 && d === 0) parts.push(`${m} min`)
  return parts.length > 0 ? parts.join(' ') : '0 min'
}

/**
 * Notification body copy. With a known lead against a TIMED due, the copy is lead-aware:
 * `Due now` when the reminder fires at the due instant (offset 0, and absolute/recurring
 * reminders — they fire at their own stated instant), `Due in 30 min (17:00)` for a
 * heads-up (the parenthetical keeps the actual time as context; the date is included only
 * when it isn't today). `leadMinutes: null` (unknown — e.g. test fires) and date-only dues
 * keep the legacy `Due today at 17:00` form.
 */
export function formatReminderBody(
  due: { date: string; time: string | null } | null,
  today: string,
  leadMinutes: number | null = null,
): string {
  if (due === null) return 'Reminder'
  if (leadMinutes !== null && due.time !== null) {
    if (leadMinutes <= 0) return 'Due now'
    const when = due.date === today ? due.time : `${due.date} ${due.time}`
    return `Due in ${formatLead(leadMinutes)} (${when})`
  }
  const day = due.date === today ? 'today' : due.date
  return due.time === null ? `Due ${day}` : `Due ${day} at ${due.time}`
}
