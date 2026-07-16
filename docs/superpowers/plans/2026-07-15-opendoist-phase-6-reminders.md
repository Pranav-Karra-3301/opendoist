# OpenDoist Phase 6: Reminders — Scheduler, Web Push, ntfy/Gotify/Webhook, iCal Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via a Workflow: Task A first (sequential), Tasks B–M in parallel (disjoint file sets, no commits, no `pnpm install`), Task N integrates.** Commits happen at integration checkpoints, not per-task, because tasks run concurrently in one working tree. Implementation agents run as Opus; integration/review agents as Fable.

**Goal:** Reminders that actually fire: a croner-driven scheduler scanning precomputed UTC fire instants; delivery through Web Push (PWA, VAPID), ntfy, Gotify, and generic HMAC-signed webhooks; auto-reminders from the user's default offset; the quick-add `!` token persisted end-to-end; real Reminders/Notifications/Integrations settings pages; and a capability-token iCal feed (`/ical/:token/tasks.ics`) with server-side recurrence expansion, ETag/304, and rotation.

**Architecture:** All new server logic lives under `apps/server/src/reminders/` (scheduler, materialization, dispatch, channel adapters) and `apps/server/src/ical/`. `packages/core` is **frozen** — reminders reuse its exported `nextOccurrence`, `instantFor`, `dateInTz`, `timeInTz`, and the `Due`/`RecurrenceSpec`/`ReminderDraft` schemas; do not assume engine internals beyond exported signatures. Task A freezes every new contract (Drizzle tables, zod DTOs, channel adapter interface, scheduler/materializer signatures, route table) and creates typed stubs + all shared-file wiring, so Tasks B–M never touch the same file twice. Web work hangs off the phase-4/5 app: a `src/push/` module (subscribe, pre-prompt, iOS screen, SW handlers) plus real settings pages.

**Tech Stack (added this phase):** croner 10 (30 s tick, `protect: true`), web-push 3.6 (VAPID keys auto-generated into `/data/secrets.json`), ical-generator 11 (VEVENT-only feed), node:crypto (HMAC-SHA256, token generation). Everything else (Hono 4 + @hono/zod-openapi, Drizzle + better-sqlite3, TanStack Query, Workbox SW) is as-built from phases 3–5.

**Reference documents (read before your task):**
- Spec: `docs/superpowers/specs/2026-07-15-opendoist-design.md` — §2.2 (due/deadline/reminder semantics), §3.2 (scheduler, channels, iCal), §3.6 (timezones)
- Dossier: `docs/superpowers/research/2026-07-15-opendoist-research.md` — §1.5 (Todoist reminder semantics), §5.1–5.6 (web-push flow, platform support, permission UX, scheduler pattern, ntfy/gotify/webhook, iCal feed)
- Frozen core contract: `packages/core/src/types.ts` (authoritative; `Due`, `RecurrenceSpec`, `ReminderDraft`, `ParseContext`, `Priority`)

## Global Constraints

- Priorities stored **1 = highest (p1) … 4 = default**.
- Server port **7968**; env vars prefixed `OPENDOIST_`; API tokens prefixed `od_`.
- Dates/instants: calendar dates `YYYY-MM-DD`, wall-clock times `HH:mm`, instants ISO-8601 UTC. **`fire_at_utc` is always written via `new Date(x).toISOString()`** (fixed-width `YYYY-MM-DDTHH:mm:ss.sssZ`) so lexicographic SQL comparison against `new Date().toISOString()` is correct.
- User timezone is a setting; timed dues are wall-clock + user tz; UTC instants come from core `instantFor(date, time, timezone)` (DST-safe).
- TypeScript `strict`, no `any` (Biome `noExplicitAny: error`), `verbatimModuleSyntax`. Biome formatting (single quotes, semicolons as-needed).
- Tests colocated `src/**/*.test.ts`, run by Vitest; every public function has tests.
- UI: radii **5px/10px only**, Kale `#4c7a45` default accent, focus ring always blue `#1f60c2`, Lucide icons only, tokens from `apps/web/src/styles/tokens.css`.
- RFC 9457 problem-JSON errors; cursor pagination shape `{results, next_cursor}`; opaque nanoid ids.
- Parallel-execution rules: builders touch ONLY their listed files; never run `pnpm install` (Task A declares all deps and installs once); never `git commit`.
- If a catalog version fails to resolve, set it to the latest published version (`pnpm view <pkg> version`) and record the change in your result notes.
- Tests that cannot pass until a sibling parallel task lands are written normally but marked `describe.skip` with a `// UNSKIP(phase6-integration)` comment; Task N un-skips them.

**AS-BUILT CHECK protocol:** This plan is written before phases 3–5 finish, so exact file names inside phase-3/4/5 code may drift. Every task lists `AS-BUILT CHECK:` bullets — at execution time, verify the named thing in the repo (grep commands given) and adapt *file placement and identifier names only*, never the frozen contracts (table columns, DTO shapes, route paths, behavior rules). Task A performs the master reconnaissance and records the resolved names in its result notes; parallel tasks re-verify anything they touch.

---

### Task A: Contracts, schema, deps, stubs, wiring (SEQUENTIAL — everything depends on this)

**Files:**
- Edit: `pnpm-workspace.yaml` (catalog additions), `apps/server/package.json` (new deps)
- Edit: the as-built Drizzle schema module (add 4 tables) + generate migration
- Edit: the as-built user-settings schema (verify `autoReminderMinutes` + constrain its allowed values — the field already exists), the as-built secrets module (expose a VAPID accessor over the EXISTING flat `vapidPublicKey`/`vapidPrivateKey` fields — do not add new keys), the as-built server boot/app file (register routes + start scheduler), the as-built SSE entity unions (server + web) + web invalidation map + settings nav
- Create: `apps/server/src/reminders/contracts.ts` (frozen), `apps/server/src/reminders/channels/index.ts` (final registry)
- Create typed stubs (each replaced wholesale by its owner task): `apps/server/src/reminders/materialize.ts` (B), `apps/server/src/reminders/routes.ts` (C), `apps/server/src/reminders/scheduler.ts` + `apps/server/src/reminders/dispatch.ts` (D), `apps/server/src/reminders/channels/webpush.ts` + `apps/server/src/reminders/push-routes.ts` (E), `apps/server/src/reminders/channels/ntfy.ts` (F), `apps/server/src/reminders/channels/gotify.ts` (G), `apps/server/src/reminders/channels/webhook.ts` (H), `apps/server/src/reminders/channel-routes.ts` (I), `apps/server/src/ical/routes.ts` (J)
- Create: `apps/server/src/reminders/test-helpers.ts`
- Create web stubs: `apps/web/src/push/types.ts` (final), `apps/web/src/push/index.ts` (K replaces); settings page stubs for L/M **only if phase 5 left none** (see Step 8)

- [ ] **Step 0: Reconnaissance (record all findings in result notes).** AS-BUILT CHECK — locate and note: (a) server package name (`grep '"name"' apps/server/package.json` — assumed `@opendoist/server`); (b) Drizzle schema file(s) (`grep -rl sqliteTable apps/server/src`); (c) migration workflow (`grep -A2 db: apps/server/package.json` — drizzle-kit generate script + migrations folder); (d) route-registration pattern and app entry (`grep -rn "route(" apps/server/src | head`); (e) auth middleware used by `/api/v1` routes; (f) SSE publish helper (`grep -rn publish apps/server/src`); (g) secrets module reading `/data/secrets.json`; (h) config module exposing `PUBLIC_URL`/`DATA_DIR`; (i) user-settings storage + PATCH endpoint; (j) how server tests bootstrap a temp DB (`grep -rln vitest apps/server`); (k) DTO casing convention (snake_case assumed below — if phase 3 chose camelCase, mechanically re-case the DTO schemas in `contracts.ts` NOW, before parallel tasks start, and note it); (l) web: the canonical single-task route (`/task/:id` — phase 4 Task A registers it), settings page directory + nav registry, SSE→query-invalidation map (and the `SseEventSchema` entity enum), service-worker presence (phases 4–5 ship NONE — see Task K), quick-add submit path (raw text to `/tasks/quick` vs structured).

- [ ] **Step 1: Catalog + manifest.** Append to `pnpm-workspace.yaml` catalog:
```yaml
  croner: ^10.0.1
  web-push: ^3.6.7
  '@types/web-push': ^3.6.4
  ical-generator: ^11.0.0
```
Add to `apps/server/package.json`: dependencies `croner`, `web-push`, `ical-generator` (all `catalog:`); devDependencies `@types/web-push` (`catalog:`).

- [ ] **Step 2: Drizzle tables (frozen contract — column set and semantics may not drift).** Add to the as-built schema module (new file `.../schema/reminders.ts` re-exported, or appended — follow repo convention). Match the as-built FK targets (`tasks.id`, users table) and timestamp storage convention for `createdAt`/`updatedAt`; `fireAtUtc`/`firedAt` are ISO-8601 text regardless.

```ts
export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    /** 'relative' | 'absolute' | 'recurring' */
    type: text('type', { enum: ['relative', 'absolute', 'recurring'] }).notNull(),
    /** relative only: minutes before due time (0 = at time) */
    minuteOffset: integer('minute_offset'),
    /** absolute/recurring: JSON of core Due ({date, time, string, recurrence}) */
    dueJson: text('due_json'),
    isAuto: integer('is_auto', { mode: 'boolean' }).notNull().default(false),
    /** next fire instant, ISO UTC (ms precision); null = currently unfireable */
    fireAtUtc: text('fire_at_utc'),
    /** set when dispatched (or suppressed); null = pending */
    firedAt: text('fired_at'),
    createdAt: text('created_at').notNull(), // AS-BUILT: swap to integer-epoch mode if that is the phase-3 convention
    updatedAt: text('updated_at').notNull(), // AS-BUILT: same
  },
  (t) => [index('idx_reminders_pending').on(t.firedAt, t.fireAtUtc), index('idx_reminders_task').on(t.taskId)],
)

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull(), // AS-BUILT: match convention
  lastUsedAt: text('last_used_at'),
})

export const notificationChannels = sqliteTable('notification_channels', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type', { enum: ['ntfy', 'gotify', 'webhook'] }).notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** zod-validated per type at the API boundary; stored as JSON text */
  configJson: text('config_json').notNull(),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  disabledReason: text('disabled_reason'),
  createdAt: /* convention */,
  updatedAt: /* convention */,
})

export const icalTokens = sqliteTable('ical_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique(),
  token: text('token').notNull().unique(),
  createdAt: /* convention */,
  lastAccessedAt: text('last_accessed_at'),
})
```
Run the as-built migration generate command (e.g. `pnpm --filter @opendoist/server db:generate`) so the SQL migration is committed alongside; verify `migrate()` applies cleanly on a scratch DB.

- [ ] **Step 3: Settings field.** `autoReminderMinutes: number | null` ALREADY EXISTS — phase 3's canonical `SettingsSchema` and phase 5's core `UserSettingsSchema` both define it (default 30, `null` = auto-reminders disabled, `0` = at task time). Do NOT re-add or re-default it. This step only: (a) verify the field round-trips through GET/PATCH `/api/v1/user/settings`; (b) constrain the allowed values at the PATCH boundary to exactly `null, 0, 5, 10, 15, 30, 45, 60, 120` (refine the existing schema or validate in the route — 400 problem-JSON otherwise). No new route.

- [ ] **Step 4: VAPID from secrets.** Phase 3's `src/secrets.ts` ALREADY persists flat `vapidPublicKey` / `vapidPrivateKey` (P-256, base64url raw — web-push-compatible) into `/data/secrets.json` at first boot, with the explicit note that this phase consumes them as-is. Do NOT call `webpush.generateVAPIDKeys()` and do NOT write a nested `vapid` block — minting a second key pair would orphan every existing subscription. Add to the as-built secrets module:
```ts
export interface VapidKeys { publicKey: string; privateKey: string; subject: string }
export function getOrCreateVapidKeys(): VapidKeys
```
Implementation: read the existing flat `vapidPublicKey`/`vapidPrivateKey` fields from phase 3's `SecretsSchema` (via `ensureDataDirAndSecrets`, which itself only generates when BOTH are absent — the sole generation path); compute `subject` at call time from config — `PUBLIC_URL` when it starts with `https://`, else `'mailto:admin@opendoist.local'` — never persisting it. **Never regenerate or rewrite the key fields** (subscriptions bind to the public key).

- [ ] **Step 5: `apps/server/src/reminders/contracts.ts` (FROZEN — verbatim; adjust only import specifiers and DTO casing per Step 0k):**

```ts
import { z } from 'zod'
import { DueSchema, HmTimeSchema, IsoDateSchema, PrioritySchema } from '@opendoist/core'

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
    if (v.type === 'absolute' && (v.due === undefined || v.due.time === null || v.due.recurrence !== null))
      ctx.addIssue({ code: 'custom', message: 'absolute reminder requires due with date+time and no recurrence' })
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
export interface ChannelConfigMap { ntfy: NtfyConfig; gotify: GotifyConfig; webhook: WebhookConfig }

export const CreateChannelBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ntfy'), name: z.string().min(1).max(120), config: NtfyConfigSchema }),
  z.object({ type: z.literal('gotify'), name: z.string().min(1).max(120), config: GotifyConfigSchema }),
  z.object({ type: z.literal('webhook'), name: z.string().min(1).max(120), config: WebhookConfigSchema }),
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
  send(payload: ReminderPayload, config: ChannelConfigMap[K], deps: ChannelDeps): Promise<SendOutcome>
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
 *  deep-link route (it opens the app with the detail dialog); phase 8's `opendoist open` uses the
 *  same URL. AS-BUILT: verify the route exists; adjust ONLY here if it drifted. */
export function taskDeepLink(publicUrl: string | null, taskId: string): string {
  const base = (publicUrl ?? 'http://localhost:7968').replace(/\/+$/, '')
  return `${base}/task/${taskId}`
}
export function formatReminderBody(due: { date: string; time: string | null } | null, today: string): string {
  if (due === null) return 'Reminder'
  const day = due.date === today ? 'today' : due.date
  return due.time === null ? `Due ${day}` : `Due ${day} at ${due.time}`
}
```

- [ ] **Step 6: Channel registry (FINAL — no other task edits this file).** `apps/server/src/reminders/channels/index.ts`:
```ts
import type { ChannelDeps, ChannelType, ReminderPayload, SendOutcome } from '../contracts'
import { gotifyAdapter } from './gotify'
import { ntfyAdapter } from './ntfy'
import { webhookAdapter } from './webhook'

export function defaultChannelDeps(log: ChannelDeps['log']): ChannelDeps {
  return { fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log }
}

/** Validate configJson with the adapter's schema, then send. Invalid config → 'error'. */
export async function sendToChannel(
  type: ChannelType,
  configJson: string,
  payload: ReminderPayload,
  deps: ChannelDeps,
): Promise<SendOutcome> {
  const adapter = type === 'ntfy' ? ntfyAdapter : type === 'gotify' ? gotifyAdapter : webhookAdapter
  const parsed = adapter.configSchema.safeParse(JSON.parse(configJson))
  if (!parsed.success) {
    deps.log('error', 'channel config invalid', { type })
    return 'error'
  }
  // each branch is fully typed; the ternary above keeps adapter/config pairs aligned
  return adapter.send(payload, parsed.data as never, deps)
}
```
(If `as never` trips lint, switch on `type` with three explicit branches — behavior identical.)

- [ ] **Step 7: Typed stubs.** Create each owner-task file compiling against the frozen signatures given in its task below; stub bodies `throw new Error('implemented by Task X')` for functions, `return 'error'` for adapter `send`, and route-registration functions register nothing. Every stub carries a header comment `// STUB — replaced wholesale by Task <X> (phase 6)`. Web stub `apps/web/src/push/index.ts` exports (frozen, K replaces): `initPushOnBoot(): void` (no-op), `getPushState(): Promise<PushState>` (returns `{ supported: false, permission: 'default', subscribed: false, ios: false, standalone: false }`), `subscribeToPush(): Promise<void>` (throws), `unsubscribeFromPush(): Promise<void>` (no-op), `maybeShowReminderPermissionPrompt(): void` (no-op), and React component `PushPrompts(): null`. `apps/web/src/push/types.ts` (final): `export interface PushState { supported: boolean; permission: NotificationPermission; subscribed: boolean; ios: boolean; standalone: boolean }`.

- [ ] **Step 8: Wiring (all shared-file edits happen HERE, once).**
  - Server app: register `remindersRoutes`, `pushRoutes`, `channelRoutes` under `/api/v1` (authed, following the as-built registration pattern) and the iCal feed route at app level (public, **before** the SPA fallback). Start the scheduler in boot: `if (!process.env.VITEST) { startReminderScheduler(db, defaultSchedulerDeps(db)) }` (stub until D lands); wire `stop()` into the as-built graceful-shutdown path if one exists.
  - SSE: widen BOTH frozen entity lists with `'reminders' | 'push_subscriptions' | 'notification_channels'` — (a) phase 3's `ServerEvent.entity` union in `apps/server/src/events/bus.ts`, AND (b) phase 4's `SseEventSchema` entity enum in `apps/web/src/api/schemas.ts` (the web client `safeParse`s every event and silently DROPS entities outside that enum — extending only the invalidation map is not enough). Then add web-side invalidation-map entries for those entities → TanStack Query keys `['reminders']`, `['push-subscriptions']`, `['channels']` (AS-BUILT: the phase-4 map file).
  - Web boot: call `initPushOnBoot()` and render `<PushPrompts />` once near the app root (AS-BUILT: root component).
  - Settings nav: AS-BUILT CHECK — if phase 5 already renders Reminders/Notifications settings pages (even placeholders), record their paths for L and do NOT create stubs; otherwise create `apps/web/src/features/settings/RemindersSettingsPage.tsx` + `NotificationsSettingsPage.tsx` stubs (render a "Coming in this phase" paragraph) and wire them into the as-built settings nav. Same for the Integrations page: mount `<CalendarFeedCard />` (create stub `apps/web/src/features/settings/CalendarFeedCard.tsx` rendering `null`; M replaces) inside the as-built Integrations settings page.

- [ ] **Step 9: Test helper.** `apps/server/src/reminders/test-helpers.ts` (frozen signatures; internals reuse/wrap the as-built phase-3 test bootstrap — do not invent a second migration path):
```ts
export async function makeTestDb(): Promise<{ db: /* as-built Drizzle db type */; close: () => void }>
export async function seedUser(db, over?: { timezone?: string; autoReminderMinutes?: number | null }): Promise<{ userId: string; timezone: string }>
export async function seedTask(db, userId: string, over?: Partial<{ content: string; dueDate: string | null; dueTime: string | null; dueString: string; recurrenceJson: string | null; priority: 1 | 2 | 3 | 4; completedAt: string | null; deletedAt: string | null }>): Promise<{ id: string }>
export async function seedReminder(db, over: Partial<ReminderRow> & { userId: string; taskId: string }): Promise<{ id: string }>
export function userParseContext(timezone: string, now: string): ParseContext  // DEFAULT_PARSE_CONTEXT_SETTINGS spread + { now, timezone }
```
`seedUser` defaults: timezone `America/New_York`, autoReminderMinutes 30. If phase-3 route tests expose an authed-app helper (e.g. `createTestApp()`), re-export it from here so C/E/I/J use one import.

- [ ] **Step 10: Install & gate.** `cd /Users/pranav/developer/opendoist && pnpm install`. Then `pnpm --filter @opendoist/server typecheck && pnpm --filter @opendoist/web typecheck && pnpm lint` → all clean; `pnpm --filter @opendoist/server test` → existing phase-3 suites still green. Do NOT commit.

---

### Task B: Fire-instant materialization + auto-reminders

**Files:**
- Replace: `apps/server/src/reminders/materialize.ts`
- Test: `apps/server/src/reminders/materialize.test.ts`, `apps/server/src/reminders/contracts.test.ts`

**Interfaces (frozen — C and D import these):**
```ts
/** fire instant for one reminder given its task's due; null = unfireable */
export function computeFireAt(
  r: { type: ReminderType; minuteOffset: number | null; due: Due | null },
  taskDue: { date: string; time: string | null } | null,
  timezone: string,
): string | null

/** Recompute/repair all reminders for a task. Call after ANY task write, complete,
 *  uncomplete, delete, or recurring-advance. Applies the auto-reminder rules. */
export async function syncTaskReminders(db, taskId: string): Promise<void>

/** Advance a recurring reminder after it fired: returns the updated {due, fireAtUtc}
 *  or null when the series is exhausted. Pure — DB write stays in the scheduler. */
export function advanceRecurringReminder(due: Due, timezone: string, now: string):
  { due: Due; fireAtUtc: string } | null
```

**Frozen behavior rules (each is a test):**
1. `computeFireAt` — relative: task due must have date+time → `new Date(Date.parse(instantFor(date, time, tz)) - minuteOffset * 60_000).toISOString()`; dateless/untimed task → null. absolute: `new Date(Date.parse(instantFor(due.date, due.time!, tz))).toISOString()`. recurring: time = `due.time ?? due.recurrence.times[0] ?? null`; null time → null; else instant of `due.date` + that time.
2. `syncTaskReminders` loads task + user settings, then for every reminder row of the task: recompute `fireAtUtc`; **if the value changed, reset `firedAt = null`** (rescheduling re-arms); if unchanged keep `firedAt`. Task completed (non-recurring) or soft-deleted → set `fireAtUtc = null` on relative/auto rows (absolute/recurring rows keep their instant; the dispatcher skips completed tasks at fire time — belt and suspenders).
3. Auto-reminder rule: when task is alive, due has a time, and `autoReminderMinutes !== null` → ensure exactly one `is_auto` row exists (`type: 'relative'`, `minuteOffset = autoReminderMinutes`), creating or updating offset in place — **unless a non-auto relative reminder with the identical offset exists** (skip to avoid duplicate fires). When any precondition fails → delete the auto row.
4. `advanceRecurringReminder`: `next = nextOccurrence(due.recurrence, { after: { date: due.date, time: due.time }, ctx: userParseContext(tz, now) })`; null → null (series done); else new due `{...due, date: next.date, time: next.time ?? due.time}` + recomputed instant.

**DST tests (required, tz America/New_York):** (a) absolute reminders at wall-clock 09:00 on 2026-03-07 → `2026-03-07T14:00:00.000Z` and on 2026-03-08 (spring forward) → `2026-03-08T13:00:00.000Z` — 23 h apart, both correct; (b) relative 30 min on task due 2026-11-01 09:00 (fall back) → `2026-11-01T13:30:00.000Z`; (c) task due in the skipped hour 2026-03-08 02:30 → `computeFireAt` returns a valid single instant (assert it round-trips `Date.parse` and falls between 06:30Z and 07:30Z).

**contracts.test.ts:** `taskDeepLink(null, 't1') === 'http://localhost:7968/task/t1'`; `taskDeepLink('https://x.dev/', 't1') === 'https://x.dev/task/t1'`; `formatReminderBody({date: '2026-07-16', time: '17:00'}, '2026-07-16') === 'Due today at 17:00'`; body for other-day/no-time/null variants; `CreateReminderBodySchema` rejects relative-without-offset, absolute-without-time, recurring-without-recurrence.

- [ ] Steps: write tests red (use `makeTestDb`/`seedUser`/`seedTask` from test-helpers) → implement → green. Verify: `pnpm --filter @opendoist/server exec vitest run src/reminders/materialize.test.ts src/reminders/contracts.test.ts` → all pass; `pnpm --filter @opendoist/server typecheck` clean.

---

### Task C: Reminder CRUD API + task-write hooks + quick-add end-to-end (server)

**Files:**
- Replace: `apps/server/src/reminders/routes.ts`
- Edit (sole owner this phase): the as-built task mutation handlers — create/update/complete/uncomplete/delete and `POST /tasks/quick` (AS-BUILT CHECK: `grep -rn "tasks/quick\|completeTask\|tasks.post" apps/server/src`)
- Test: `apps/server/src/reminders/routes.test.ts`

**Routes (frozen; zod-openapi typed with schemas from `contracts.ts`; auth = as-built middleware; every mutation publishes SSE `{entity: 'reminders'}`):**

| Route | Body → Response |
|---|---|
| `GET /api/v1/reminders?task_id=` | → 200 `{results: ReminderDto[], next_cursor: null}` (task_id optional; without it, all of the user's reminders) |
| `POST /api/v1/reminders` | `CreateReminderBody` → 201 `ReminderDto`; 400 problem-JSON `reminder_requires_timed_due` when relative and task due has no time; 404 unknown task |
| `PATCH /api/v1/reminders/:id` | `UpdateReminderBody` → 200 `ReminderDto` (recompute `fireAtUtc`, reset `firedAt` when it changes) |
| `DELETE /api/v1/reminders/:id` | → 204 (hard delete; deleting an auto row also flips a per-task marker? **No** — deleting the auto reminder while settings still call for one recreates it on next task write; document this in the route description) |
| `POST /api/v1/reminders/test` | `{}` → 200 `TestFireResult` — builds a test payload (`test: true`, title `'Test notification from OpenDoist'`, body `'Reminders are working.'`, url = `taskDeepLink(publicUrl, 'inbox')` → adjust to app root) and dispatches via Task D's `dispatchTestPayload` |

**Hooks:** after every successful task create/update/complete/uncomplete/delete and after recurring-advance-on-complete, call `await syncTaskReminders(db, taskId)`. In `POST /tasks/quick`: after task creation, persist `parsed.reminders` (`ReminderDraft[]` from core): `relative` → reminder row (400 only if the quick text also produced an untimed due — instead of failing the whole quick-add, **skip the reminder and continue**, recording nothing; Todoist behaves this way); `absolute` → due `{date, time, string: `${date} ${time}`, recurrence: null}`; `recurring` → the draft's `due` as-is. Then `syncTaskReminders` (auto-reminder materializes here too).

**Tests (route-level, real DB via test-helpers):** CRUD round-trip incl. validation failures; creating a timed-due task via the as-built quick endpoint text `"Pay rent tomorrow 5pm !45 min before"` yields **two** reminders (auto 30 + relative 45) with correct `fire_at_utc` ordering; `"… !30 min before"` yields **one** (dedupe with auto); completing the task nulls relative `fire_at_utc`; rescheduling re-arms (`fired_at` reset). Mark suites that need Task B's real logic `describe.skip` + `// UNSKIP(phase6-integration)` only if B's stub blocks them (they will — B and C run in parallel; write everything, skip the suite, N un-skips).

- [ ] Steps: tests (skipped suite) → routes → hooks → typecheck/lint clean. Verify: `pnpm --filter @opendoist/server typecheck && pnpm lint` clean; `pnpm --filter @opendoist/server exec vitest run src/reminders/routes.test.ts` reports the suite as skipped (not failing).

---

### Task D: Scheduler tick + dispatcher

**Files:**
- Replace: `apps/server/src/reminders/scheduler.ts`, `apps/server/src/reminders/dispatch.ts`
- Test: `apps/server/src/reminders/scheduler.test.ts`, `apps/server/src/reminders/dispatch.test.ts`

**Interfaces (frozen):**
```ts
// scheduler.ts
export interface SchedulerDeps {
  now: () => string                                   // ISO ms UTC
  dispatch: (reminderId: string) => Promise<void>     // injected for tests; default = dispatchReminder
  log: ChannelDeps['log']
}
export function defaultSchedulerDeps(db): SchedulerDeps
export async function runSchedulerTick(db, deps: SchedulerDeps):
  Promise<{ claimed: number; dispatched: number; suppressed: number; advanced: number }>
export function startReminderScheduler(db, deps: SchedulerDeps): { stop: () => void }

// dispatch.ts
export async function dispatchReminder(db, reminderId: string): Promise<void>
export async function dispatchTestPayload(db, userId: string, payload: ReminderPayload): Promise<TestFireResult>
export function buildReminderPayload(input: {
  task: { id: string; content: string; dueDate: string | null; dueTime: string | null; priority: 1 | 2 | 3 | 4 }
  reminderId: string; firedAt: string; publicUrl: string | null; timezone: string; test?: boolean
}): ReminderPayload
```

**Frozen tick algorithm (`runSchedulerTick`):**
1. `now = deps.now()`; select `WHERE fire_at_utc IS NOT NULL AND fire_at_utc <= now AND fired_at IS NULL ORDER BY fire_at_utc LIMIT SCHEDULER_BATCH_LIMIT`.
2. Per row, **claim first** (idempotency): `UPDATE reminders SET fired_at = now WHERE id = ? AND fired_at IS NULL` — better-sqlite3 `.changes === 0` → skip (already claimed).
3. Staleness: `Date.parse(now) - Date.parse(fire_at_utc) > STALE_SUPPRESS_MS` → `suppressed++`, `deps.log('warn', 'reminder stale-suppressed', …)`, **no dispatch** (row stays fired).
4. Else `await deps.dispatch(id)` inside try/catch (a channel explosion must not kill the tick); `dispatched++`.
5. Recurring reminders (fresh or stale): `advanceRecurringReminder(due, tz, now)` → non-null: write new `due_json` + `fire_at_utc`, reset `fired_at = NULL`, `advanced++`; null: leave fired (series complete).

`startReminderScheduler`: run one immediate `runSchedulerTick` on start (**catch-up on boot** — overdue-but-fresh rows fire, >12 h rows get suppressed exactly once), then `new Cron('*/30 * * * * *', { protect: true, catch: (e) => deps.log('error', 'scheduler tick failed', { error: String(e) }) }, () => runSchedulerTick(db, deps))`; `stop()` calls `cron.stop()`.

**Frozen dispatcher (`dispatchReminder`):** load reminder + task + user (+timezone, publicUrl from as-built config). Task missing/soft-deleted/completed (non-recurring) → log + return (already claimed, nothing sent). Build payload: `title = task.content`, `body = formatReminderBody(taskDue-or-reminderDue, dateInTz(now, tz))` (relative/auto use the task's due; absolute/recurring use their own), `url = taskDeepLink(publicUrl, task.id)`, `tag = 'reminder-' + reminderId`, `test: false`. Then: (a) every push subscription of the user → `sendWebPush(sub, payload)` (Task E); outcome `'gone'` → delete that subscription row, else update `last_used_at`; (b) every `enabled` notification channel → `sendToChannel(type, configJson, payload, defaultChannelDeps(log))`; outcome `'delivered'` → `consecutive_failures = 0`; `'error'` → increment, and **when type === 'webhook' and the count reaches WEBHOOK_AUTO_DISABLE_AFTER** → `enabled = false`, `disabled_reason = 'Disabled automatically after 10 consecutive delivery failures'`, publish SSE `{entity: 'notification_channels'}`. `dispatchTestPayload` = same fan-out with a caller-provided payload, returning `TestFireResult`.

**Tests (required by phase gate; use injected `deps` — no real timers, no real channels):**
- *Idempotency:* seed fired-nothing reminder 2 min past; run tick twice with a `vi.fn()` dispatch → dispatch called exactly once; `fired_at` set.
- *Catch-up:* fire_at 5 min ago → dispatched. *Staleness:* fire_at 13 h ago → suppressed, dispatch NOT called, `fired_at` set.
- *Batch:* 120 due rows → first tick claims 100, second claims 20.
- *Recurring advance:* recurring `every day` 17:00 reminder fires → new `fire_at_utc` is next day 17:00 wall-clock (America/New_York), `fired_at` null again; with `until` yesterday → stays fired. (Needs B's real `advanceRecurringReminder` — mark just this test `// UNSKIP(phase6-integration)` if the stub blocks it.)
- *Dispatch (dispatch.test.ts):* mock `sendWebPush`/`sendToChannel` via `vi.mock` — gone subscription deleted; webhook failures 9→10 flips enabled false with reason; delivered resets counter; completed-task reminder sends nothing.
- *DST fire time:* seed absolute reminder 2026-03-08 09:00 New York (fire_at from B's math, hardcode `2026-03-08T13:00:00.000Z`), tick with `now = 2026-03-08T13:00:05.000Z` → dispatched.

- [ ] Steps: scheduler tests red → implement scheduler → dispatch tests red → implement dispatcher → green. Verify: `pnpm --filter @opendoist/server exec vitest run src/reminders/scheduler.test.ts src/reminders/dispatch.test.ts` → pass (minus the one UNSKIP-marked test); typecheck/lint clean.

---

### Task E: Web Push channel + subscription API

**Files:**
- Replace: `apps/server/src/reminders/channels/webpush.ts`, `apps/server/src/reminders/push-routes.ts`
- Edit (sole owner): the as-built `/api/v1/info` handler — add `features.push: true`
- Test: `apps/server/src/reminders/channels/webpush.test.ts`, `apps/server/src/reminders/push-routes.test.ts`

**Frozen interface (`webpush.ts`):**
```ts
export interface PushSubscriptionRow { id: string; endpoint: string; p256dh: string; auth: string }
export async function sendWebPush(sub: PushSubscriptionRow, payload: ReminderPayload): Promise<SendOutcome>
```
Implementation: module-level lazy init `webpush.setVapidDetails(subject, publicKey, privateKey)` from `getOrCreateVapidKeys()`. Send `webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, body, { TTL: 3600, urgency: 'high', topic: payload.reminder_id.slice(0, 32) })` where body = `JSON.stringify({ title, body, url, tag })` **only** (4 KB push limit — never the full payload); truncate `title` to 120 chars, `body` to 512. Catch `WebPushError`: `statusCode` 404 or 410 → `'gone'`; anything else → `'error'` + log. Success → `'delivered'`.

**Routes (frozen; authed; SSE entity `push_subscriptions` on mutation):** `GET /api/v1/push-subscriptions` → `{results: PushSubscriptionDto[]}` · `POST /api/v1/push-subscriptions` (`PushSubscriptionBody`) → 201, **upsert on endpoint** (same endpoint re-posted updates keys/user_agent/last_used_at, returns the existing id) · `DELETE /api/v1/push-subscriptions/:id` → 204 · `GET /api/v1/push/vapid-public-key` → 200 `{public_key: string}`.

**Tests:** `vi.mock('web-push')` — assert `sendNotification` called with exact 4-field JSON body and `{TTL: 3600, urgency: 'high', topic}` options; construct a `WebPushError`-shaped rejection with `statusCode: 410` → `'gone'`; 500 → `'error'`. Routes: upsert semantics (two POSTs same endpoint → one row), list redacts nothing but truncates endpoint? No — return full endpoint (single-user). Delete → 204 and row gone. vapid-public-key returns the key persisted in the test secrets file (AS-BUILT: how secrets module is pointed at a temp dir in tests — reuse phase-3 pattern).

- [ ] Steps: TDD as above. Verify: `pnpm --filter @opendoist/server exec vitest run src/reminders/channels/webpush.test.ts src/reminders/push-routes.test.ts` → pass; typecheck/lint clean; `grep -n 'push' <as-built info handler>` shows the flag.

---

### Task F: ntfy channel adapter

**Files:**
- Replace: `apps/server/src/reminders/channels/ntfy.ts`
- Test: `apps/server/src/reminders/channels/ntfy.test.ts`

**Frozen:** `export const ntfyAdapter: ChannelAdapter<'ntfy'>`. Send = single `deps.fetch(config.server, { method: 'POST', headers, body })` (**server root**, JSON publish per dossier §5.5): body `JSON.stringify({ topic: config.topic, title: payload.title, message: payload.body, priority: NTFY_PRIORITY[payload.priority], click: payload.url, tags: ['bell'] })`; headers `content-type: application/json` + `authorization: Bearer ${config.token}` only when token set. **Priority map (frozen):** p1→5, p2→4, p3→3, p4→3. `AbortSignal.timeout(10_000)`. `res.ok` → `'delivered'`; non-ok or thrown → `'error'` (+ `deps.log('warn', …)`). No retries.

**Tests (inject `deps.fetch = vi.fn()`):** exact URL/headers/body assertion for a p1 payload with token; no auth header without token; 403 response → `'error'`; network reject → `'error'`; timeout signal present in init.

- [ ] Verify: `pnpm --filter @opendoist/server exec vitest run src/reminders/channels/ntfy.test.ts` → pass; typecheck/lint clean.

---

### Task G: Gotify channel adapter

**Files:**
- Replace: `apps/server/src/reminders/channels/gotify.ts`
- Test: `apps/server/src/reminders/channels/gotify.test.ts`

**Frozen:** `export const gotifyAdapter: ChannelAdapter<'gotify'>`. Send = single `deps.fetch(`${config.server.replace(/\/+$/, '')}/message`, …)` JSON body `{ title: payload.title, message: payload.body, priority: GOTIFY_PRIORITY[payload.priority], extras: { 'client::notification': { click: { url: payload.url } } } }`; header `x-gotify-key: config.app_token`. **Priority map (frozen):** p1→8, p2→6, p3→4, p4→2. Timeout 10 s; ok → `'delivered'`, else `'error'`; no retries.

**Tests:** exact request assertion (URL join with trailing-slash server, header, body incl. extras click), 401 → `'error'`, reject → `'error'`.

- [ ] Verify: `pnpm --filter @opendoist/server exec vitest run src/reminders/channels/gotify.test.ts` → pass; typecheck/lint clean.

---

### Task H: Generic webhook channel adapter (HMAC, retries, canonical body)

**Files:**
- Replace: `apps/server/src/reminders/channels/webhook.ts`
- Test: `apps/server/src/reminders/channels/webhook.test.ts`

**Frozen:** `export const webhookAdapter: ChannelAdapter<'webhook'>` plus exported helpers:
```ts
export function webhookBody(payload: ReminderPayload): string   // canonical JSON, key order below
export function signWebhookBody(body: string, secret: string): string  // hex HMAC-SHA256
```
Body is `JSON.stringify` of exactly this literal shape/order: `{ event: payload.test ? 'reminder.test' : 'reminder.due', task: { id, title: payload.title, due: payload.due, url: payload.url }, firedAt: payload.fired_at }`. Headers: `content-type: application/json`, `x-signature: sha256=${signWebhookBody(body, config.secret)}`, `user-agent: OpenDoist-Webhook`. **Retry policy (frozen):** attempts at 0 ms, then `deps.sleep(1000)`, then `deps.sleep(5000)` — 3 attempts max, each with `AbortSignal.timeout(10_000)`; any 2xx → `'delivered'` immediately; all failed → `'error'`. (Auto-disable bookkeeping lives in Task D's dispatcher, not here.)

**Golden HMAC vector (test must assert this exact literal):** body
`{"event":"reminder.due","task":{"id":"t1","title":"Renew passport","due":{"date":"2026-07-16","time":"17:00"},"url":"http://localhost:7968/task/t1"},"firedAt":"2026-07-16T20:30:00.000Z"}`
with secret `test-secret-123` → signature
`d857b874db1ac1d5100927ed749802850a73dedad3f5394d9b8e0c0d9542c50f`.

**Tests:** golden vector via `signWebhookBody` and via full `send` (capture the fetch init, recompute); 2 failures then success → `'delivered'`, fetch called 3×, sleeps `[1000, 5000]` (inject `sleep: vi.fn()`); 3 failures → `'error'`; `reminder.test` event name when `payload.test`.

- [ ] Verify: `pnpm --filter @opendoist/server exec vitest run src/reminders/channels/webhook.test.ts` → pass; typecheck/lint clean.

---

### Task I: Notification-channel CRUD API + test-fire

**Files:**
- Replace: `apps/server/src/reminders/channel-routes.ts`
- Test: `apps/server/src/reminders/channel-routes.test.ts`

**Routes (frozen; authed; SSE entity `notification_channels`):** `GET /api/v1/channels` → `{results: ChannelDto[]}` (config returned in full — single-user instance, owner-only) · `POST /api/v1/channels` (`CreateChannelBody`) → 201 `ChannelDto` · `PATCH /api/v1/channels/:id` (`UpdateChannelBody`; config is validated against the row's type schema — mismatched shape → 400; any config change or `enabled: true` **resets `consecutive_failures` to 0 and clears `disabled_reason`**) → 200 · `DELETE /api/v1/channels/:id` → 204 · `POST /api/v1/channels/:id/test` → 200 `{outcome: SendOutcome}` — builds the standard test payload (`test: true`, title `'Test notification from OpenDoist'`, body `'Your <name> channel works.'`) and calls `sendToChannel` directly with `defaultChannelDeps`.

**Tests:** CRUD round-trip per type incl. discriminated-union validation (gotify body with ntfy config → 400); re-enable resets failure counter; test endpoint with `vi.mock`ed `channels/index` `sendToChannel` → `{outcome: 'delivered'}` and passes `test: true` (mocking the registry keeps this task independent of F/G/H — do NOT skip).

- [ ] Verify: `pnpm --filter @opendoist/server exec vitest run src/reminders/channel-routes.test.ts` → pass; typecheck/lint clean.

---

### Task J: iCal feed + token API

**Files:**
- Replace: `apps/server/src/ical/routes.ts`
- Create: `apps/server/src/ical/feed.ts`
- Test: `apps/server/src/ical/feed.test.ts`, `apps/server/src/ical/routes.test.ts`

**Frozen interface (`feed.ts`):**
```ts
export interface IcalTaskRow {
  id: string; content: string; description: string
  dueDate: string; dueTime: string | null; durationMin: number | null
  recurrence: RecurrenceSpec | null; labels: string[]
}
/** Deterministic ICS text. Recurrences expanded via core nextOccurrence; no RRULE emitted. */
export function buildTasksCalendar(rows: IcalTaskRow[], opts: {
  publicUrl: string | null; timezone: string; now: string
}): string
export function feedEtag(body: string): string   // '"sha256-' + first 32 hex of sha256(body) + '"'
```

**Frozen generation rules:** window = `[today − ICAL_WINDOW.backDays, today + ICAL_WINDOW.forwardDays]` (today = `dateInTz(now, timezone)`). Include only live tasks (not completed, not deleted) with a due date. Non-recurring: one event if `dueDate` in window, UID `task-{id}@opendoist`. Recurring: current due plus successive `nextOccurrence(recurrence, { after: prev, ctx: userParseContext(timezone, now) })` while date ≤ window end; each occurrence UID `task-{id}-{yyyyMMdd}@opendoist` (stable across refreshes). All events sorted by start; hard cap `ICAL_WINDOW.maxEvents` (500) after sorting. Timed dues → start `new Date(instantFor(date, time, timezone))`, end = start + (`durationMin ?? 30`) minutes. Date-only → `allDay: true`. Per event: `summary` = content, `description` = description (omit when empty), `url` = `taskDeepLink(publicUrl, id)`, `categories` = labels, `stamp: new Date(opts.now)` (**determinism — snapshot tests depend on this**). Calendar: `ical({ name: 'OpenDoist — Tasks', prodId: '//opendoist//tasks//EN', ttl: 3600 })`.

**Routes:** `GET /api/v1/ical-token` (authed) → 200 `{token, url, webcal_url, created_at}` — creates the row on first call (`token = randomBytes(24).toString('base64url')`, 32 chars); `url` = `${publicUrl ?? 'http://localhost:7968'}/ical/${token}/tasks.ics`, `webcal_url` = same with scheme replaced by `webcal://`. `POST /api/v1/ical-token/rotate` (authed) → 200 same DTO with a fresh token (old immediately invalid). `GET /ical/:token/tasks.ics` (**public**, registered by Task A at app level): unknown token → 404 problem-JSON (never 401); else update `last_accessed_at`, build body, respond 200 `content-type: text/calendar; charset=utf-8`, `etag: feedEtag(body)`, `cache-control: private, max-age=300`; when `if-none-match` equals the ETag → **304** with the same ETag/Cache-Control headers and empty body. (Hono serves HEAD via the GET route automatically — verify with curl in tests or note.)

**Tests:** `feed.test.ts` — fixture: 3 non-recurring (in-window timed with 45 min duration, in-window all-day, out-of-window → excluded) + 1 recurring `every mon, fri at 09:00` + 1 completed (excluded), fixed `now = '2026-07-16T12:00:00.000Z'`, tz America/New_York → **full-string snapshot** (`expect(body).toMatchSnapshot()`) plus explicit asserts: `BEGIN:VEVENT` count, `DTSTART;VALUE=DATE:` for the all-day row, UID formats, recurring occurrences land only on Mon/Fri, ≤ window end; cap test: recurring `every day` with 400-day horizon clamps at window (and a 600-task variant clamps at 500 events). `routes.test.ts` — token auto-create + rotate invalidates old (200→404); feed 200 sets ETag + Cache-Control, re-request with `If-None-Match` → 304; bad token 404.

- [ ] Verify: `pnpm --filter @opendoist/server exec vitest run src/ical` → pass; typecheck/lint clean.

---

### Task K: Web push client — SW handlers, subscribe flow, pre-prompt, iOS screen

**Files:**
- Replace: `apps/web/src/push/index.ts`
- Create: `apps/web/src/push/PermissionPreprompt.tsx`, `apps/web/src/push/IosInstallScreen.tsx`
- Create or Edit (sole owner): the service-worker source (`apps/web/public/sw.js` — see AS-BUILT CHECK; phases 4–5 ship none) + its registration; the as-built quick-add submit handler (one call added)

**AS-BUILT CHECK:** locate any SW (`grep -rn "workbox\|serviceWorker" apps/web`). Phases 4 and 5 ship NO service worker or web manifest (full PWA/Workbox precaching is deferred to phase 10) — expect zero hits. When none exists, CREATE `apps/web/public/sw.js` (plain hand-rolled SW, no Workbox, containing ONLY the three push handlers below) and register it from the app root: `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')` — this task owns that one-line mount. Phase 10 Task C later migrates these handlers verbatim into its Workbox `src/sw.ts` and deletes this file. If a SW unexpectedly exists, append the handlers instead. Also locate the quick-add submit success path.

**SW handlers (from dossier §5.1, adapted verbatim):** `push` → `event.data?.json()`, `showNotification(title, { body, tag, icon: <as-built 192 icon path>, badge: <as-built badge or icon>, data: { url } })` inside `event.waitUntil` (**always** showNotification — `userVisibleOnly` contract). `notificationclick` → close, `clients.matchAll({type: 'window', includeUncontrolled: true})`, focus the first same-origin client and `navigate(url)`, else `clients.openWindow(url)`. `pushsubscriptionchange` → resubscribe with `event.oldSubscription?.options` and POST the new subscription to `/api/v1/push-subscriptions`.

**`push/index.ts` (replaces stub; exports frozen in Task A Step 7):**
- `getPushState()`: `supported` = `'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window`; `ios` = iPadOS/iOS UA check; `standalone` = `matchMedia('(display-mode: standalone)').matches`; `subscribed` via `pushManager.getSubscription()`.
- `subscribeToPush()`: `Notification.requestPermission()` (must run in the click handler's task — no awaits before it), fetch `/api/v1/push/vapid-public-key`, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })`, POST body per `PushSubscriptionBodySchema` with `user_agent: navigator.userAgent`. Export `urlBase64ToUint8Array` (standard base64url→Uint8Array).
- `unsubscribeFromPush()`: unsubscribe + DELETE the matching server row (list, match by endpoint).
- `initPushOnBoot()`: when permission already granted → re-sync current subscription to the server (dossier §5.1.6), fire-and-forget.
- `maybeShowReminderPermissionPrompt()`: no-op when `!supported`, permission `granted`/`denied`, already subscribed, or `localStorage['od-push-preprompt-snooze-until']` is in the future; iOS-not-standalone → open `IosInstallScreen`; else open `PermissionPreprompt`. `PushPrompts()` hosts both dialogs (Zustand or local state via a tiny event emitter — match as-built UI-state pattern).

**UI (tokens.css, radius 10px dialogs, Kale accent, focus ring `#1f60c2`, Lucide `Bell`/`Share`/`SquarePlus` icons):** `PermissionPreprompt` — "Get notified when reminders fire" copy, buttons **Enable notifications** (→ `subscribeToPush()`, then toast success/failure) and **Not now** (→ snooze 30 days: `Date.now() + 30*24*3600_000`). `IosInstallScreen` — full-screen sheet: install steps (Safari Share → Add to Home Screen → open from Home Screen), note that iOS requires an installed PWA for push (dossier §5.2), and "use ntfy as a fallback channel" pointer to Notifications settings.

**Quick-add hook:** after a successful quick-add save whose parse produced ≥1 reminder token, call `maybeShowReminderPermissionPrompt()` — the spec's "first-reminder moment".

- [ ] Verify: `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build` → clean (build must emit the SW with the three handlers — `grep -l notificationclick apps/web/dist -r` after build); `pnpm lint` clean.

---

### Task L: Settings — Reminders page + Notifications page (real wiring)

**Files:**
- Replace (or create per Task A Step 8 recon): `apps/web/src/features/settings/RemindersSettingsPage.tsx`, `apps/web/src/features/settings/NotificationsSettingsPage.tsx`
- Create: `apps/web/src/features/settings/notifications-api.ts` (TanStack Query hooks: reminders-test, subscriptions list/delete, channels CRUD/test — thin wrappers over the as-built API client; query keys `['push-subscriptions']`, `['channels']`)

**Reminders page (spec §2.5):** "Automatic reminders" select — options exactly: `No automatic reminder (null)`, `At time of task (0)`, `5/10/15/30/45/60/120 minutes before` — PATCHes the as-built settings endpoint field `autoReminderMinutes`; helper text "Applied to tasks that have a due time."; **Send test notification** button → `POST /api/v1/reminders/test` → toast summarizing `TestFireResult` ("Push: 2 sent · ntfy 'phone': delivered · webhook 'HA': error").

**Notifications page:** *Push section* — status from `getPushState()`: unsupported → explainer; iOS not installed → button opening `IosInstallScreen`; supported+unsubscribed → **Enable on this device** (→ `subscribeToPush()`); subscribed → confirmation + **Disable on this device**. Devices table from `GET /api/v1/push-subscriptions` (user_agent trimmed, created_at, last_used_at, revoke button → DELETE + invalidate). *Channels section* — card per channel: type icon + name + enabled Switch (PATCH), `consecutive_failures > 0` amber badge, `disabled_reason` red banner, **Test** (→ `POST /channels/:id/test`, toast outcome), **Delete** (confirm). **Add channel** — type picker then per-type form (ntfy: server default `https://ntfy.sh`, topic, optional token; gotify: server, app token; webhook: URL, secret ≥8 chars with a "generate" button using `crypto.randomUUID()`, plus a collapsible note documenting the `X-Signature: sha256=<hex HMAC of raw body>` scheme and the JSON body shape from Task H). All forms zod-validated client-side with the same config schemas (import from a small local copy or shared types — do NOT import server code into web; re-declare the three config field sets locally).

Styling: settings layout follows as-built phase-5 pages (AS-BUILT: copy an existing page's shell); 5px inputs/buttons, 10px cards, Kale accent, Lucide icons (`BellRing`, `Smartphone`, `Webhook`, `Radio`, `MessageSquare`).

- [ ] Verify: `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build && pnpm lint` → clean. Record in notes which as-built files you replaced vs created.

---

### Task M: Settings — Integrations calendar-feed card

**Files:**
- Replace: `apps/web/src/features/settings/CalendarFeedCard.tsx`

**Behavior:** on mount `GET /api/v1/ical-token` (query key `['ical-token']`). Card "Calendar feed" inside the as-built Integrations page (mounted by Task A): explainer ("Subscribe from Google Calendar, Apple Calendar, or Outlook — events for every task with a due date"), read-only input with the `https` URL + **Copy** button, second row with the `webcal://` URL + **Copy** (label "Opens Apple Calendar/Outlook directly"), muted note **"Google Calendar refreshes subscribed feeds roughly every 8–24 hours."** and **Rotate link** button → confirmation dialog ("Existing calendar subscriptions will stop working. Rotate?") → `POST /api/v1/ical-token/rotate` → invalidate `['ical-token']` + success toast. Copy uses `navigator.clipboard.writeText` with a checkmark flash. Tokens/radii/accent per global constraints.

- [ ] Verify: `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build && pnpm lint` → clean.

---

### Task N: Integration gate (SEQUENTIAL — after B–M)

**Files:** may touch anything needed to make the gate pass (smallest possible diffs); removes every remaining `STUB` header comment; un-skips all `// UNSKIP(phase6-integration)` suites/tests.

- [ ] **Step 1:** `grep -rn "UNSKIP(phase6-integration)" apps/` → un-skip each; `grep -rn "STUB — replaced wholesale" apps/` → must return nothing (a hit means a task failed to replace its stub — fix before proceeding).
- [ ] **Step 2:** `pnpm install` (only if manifests changed), then `pnpm verify` (lint + typecheck + test + build) → green. Fix failures with minimal diffs; record every fix in result notes.
- [ ] **Step 3: End-to-end script (temp instance).** Boot the server with a scratch data dir (`OPENDOIST_DATA_DIR=$(mktemp -d) node <as-built entry> &` or the as-built dev command), then via curl (create the first user through the as-built auth signup, then authenticate — cookie or `od_` token, per phase-3 as-built):
  1. `POST /api/v1/tasks/quick` text `"Pay rent tomorrow 5pm !45 min before"` → `GET /api/v1/reminders?task_id=…` returns **2** reminders (auto 30 + relative 45), both with `fire_at_utc` ISO-ms strings, relative-45 earlier than auto-30.
  2. Create an **absolute reminder 2 minutes in the past** on that task → within 35 s (`sleep 35`) `GET` shows `fired_at` set (scheduler live-fired; no channels configured — dispatch to zero sinks still marks fired).
  3. `POST /api/v1/channels` (webhook → `https://example.invalid/hook`, secret `test-secret-123`) → `POST /api/v1/channels/:id/test` → `{outcome: "error"}` and `GET /api/v1/channels` shows `consecutive_failures: 0` (test-fire must NOT touch counters — it bypasses the dispatcher).
  4. `GET /api/v1/ical-token` → fetch `/ical/<token>/tasks.ics` → 200, body contains `BEGIN:VCALENDAR` and a `SUMMARY:Pay rent` VEVENT; repeat with `If-None-Match: <etag>` → **304**; `/ical/WRONGTOKEN/tasks.ics` → 404; `POST /ical-token/rotate` → old token now 404, new token 200.
  5. `GET /api/v1/push/vapid-public-key` → 200 and the returned key EQUALS the flat `vapidPublicKey` field phase 3 wrote into `<data-dir>/secrets.json` at first boot (no nested `vapid` block exists); restart the server → same public key, byte-identical secrets.json (no regeneration).
  6. `GET /api/v1/info` → `features.push` true. Kill the server; clean up.
- [ ] **Step 4:** Confirm coverage: `pnpm --filter @opendoist/server exec vitest run src/reminders src/ical --reporter=verbose` — scheduler idempotency/staleness/catch-up, DST fire-time tests, all four channel-dispatch mock suites, ics snapshot + ETag tests all present and green.
- [ ] **Step 5:** Do not commit — report ready-for-checkpoint with the full e2e transcript in notes.

## Self-Review (done)

- **Scope coverage:** spec §3.2 scheduler (D), channels webpush/ntfy/gotify/webhook (E/F/G/H), iCal (J + M); §2.2 reminder semantics incl. auto-reminders + recurring reminders (B/C); quick-add `!` end-to-end (C server-side + K's prompt trigger; core parser already emits `ReminderDraft`s); permission pre-prompt + iOS screen (K); Reminders/Notifications settings (L); required vitest suites named explicitly in D/E–H/J and re-checked in N.
- **Disjointness:** every shared file is edited only by Task A (wiring) or by exactly one named owner (C: task routes; E: info handler; K: SW + quick-add; L/M: their settings files). Channel registry is final in A so F/G/H never collide.
- **Cross-task imports** compile against Task A stubs; the only runtime couplings are C→B and D→B, both fenced with the UNSKIP marker pattern from the phase-1-2 plan.
- **Core is untouched:** only exported symbols used (`nextOccurrence`, `instantFor`, `dateInTz`, `timeInTz`, `addDaysIso`, schemas, `DEFAULT_PARSE_CONTEXT_SETTINGS`); no engine internals assumed.
- **Placeholder scan:** stubs are explicitly temporary with a greppable header that Task N asserts is gone; no TBDs remain in frozen contracts.
