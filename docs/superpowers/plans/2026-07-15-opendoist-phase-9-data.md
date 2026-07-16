# OpenDoist Phase 9: Backups/Restore, Todoist Importer, Productivity/Karma, What's New + Update Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via a Workflow: Task A first (sequential), Tasks B–P in parallel (disjoint file sets, no commits, no `pnpm install`), Task Q integrates.** Commits happen at integration checkpoints, not per-task, because tasks run concurrently in one working tree. Implementation agents run as Opus; integration/review agents as Fable.

**Goal:** Working nightly + on-demand backups with verified restore, a two-mode Todoist importer (backup-ZIP CSV and live API) surfaced in `/api/v1/info.available_importers` with a full import UI, canonical JSON + Todoist-compatible CSV export, karma/productivity (pure rules in core, day_stats rollup + reconcile job, popover + goal charts), a What's New dialog driven by the bundled CHANGELOG, and a daily GitHub-releases update check with banner.

**Architecture:** All product math (karma points/levels/streaks) lives in `packages/core` (pure, zero-IO). Server features land as self-contained directories — `apps/server/src/backups/`, `apps/server/src/import/`, `apps/server/src/productivity/`, `apps/server/src/export/`, plus `apps/server/src/jobs/update-check.ts` — registered against the phase-3 Hono app and phase-6 croner scheduler. Both importers produce one normalized `ImportPlan`; a single `applyImportPlan` writes it transactionally. Restore runs under an app-level maintenance lock with a pre-restore safety snapshot. Task A freezes every contract (zod schemas, Drizzle tables, route paths, function signatures) and does ALL shared-file wiring; parallel tasks fill in feature modules and never touch shared files.

**Tech Stack (additions this phase):** `archiver` ^7 (zip create, streaming), `node-stream-zip` ^1.15 (zip read, streaming), `csv-parse` ^5.6 (RFC-4180 CSV). Everything else (Drizzle + better-sqlite3, croner, Hono + zod-openapi, TanStack Query, native `fetch`) already exists from phases 3–8. Charts and goal rings are hand-rolled SVG — no chart library.

**Reference documents (read before your task):**
- Spec: `docs/superpowers/specs/2026-07-15-opendoist-design.md` (§2.5, §2.6, §3.2 scheduler/backups, §3.5 env/ops, §5 in-app release surfaces)
- Dossier: `docs/superpowers/research/2026-07-15-opendoist-research.md` (§1.8 karma/backups, §1.9 Todoist API v1, §3.2 VACUUM INTO, §4.5 update-check patterns, §4.11 importer table stakes)
- Frozen core contract: `packages/core/src/types.ts` — authoritative; import, never edit.

## Global Constraints

- Priorities stored **1 = highest (p1) … 4 = default**. Todoist's API/CSV use the inverse (4 = urgent); importers/exporters map with `ours = 5 - theirs`.
- Server listens on port **7968**; all config env vars use the **`OPENDOIST_`** prefix; API tokens use the **`od_`** prefix (scopes `read` / `read_write`).
- Dates: calendar dates `YYYY-MM-DD`, wall-clock `HH:mm`, instants ISO-8601 UTC; ISO weekdays 1=Mon…7=Sun (core `dates.ts` helpers only — no ad-hoc `Date` math).
- UI: radii **5px/10px only**; Kale accent `#4c7a45` (hover `#3e6737`); focus ring always blue `#1f60c2`; Lucide icons only; tokens from `apps/web/src/styles/tokens.css`.
- TypeScript `strict`, no `any` (Biome `noExplicitAny: error`); Biome formatting (`pnpm lint` must pass); tests colocated `src/**/*.test.ts(x)`, Vitest.
- RFC 9457 problem-JSON for API errors; cursor pagination shape `{results, next_cursor}`; opaque nanoid ids.
- **Parallel-execution rules: builders touch ONLY their listed files; never run `pnpm install` (Task A declares all deps and installs once); never `git commit`.** If a pinned version fails to resolve, use the latest published version (`pnpm view <pkg> version`) and record it in your result notes.
- **AS-BUILT CHECK** bullets mark places where phases 3–8 output may differ from this plan's assumptions. At execution time, READ the named repo files first and adapt integration points (paths, helper names, register patterns) — the frozen contracts of this plan (schemas, route paths, signatures, behavior) do NOT change. This plan assumes workspace filter names `@opendoist/server` and `@opendoist/web`; confirm via their `package.json` and substitute in verify commands if different.

---

### Task A: Contracts, schema, deps, and shared wiring (SEQUENTIAL — everything depends on this)

**Files:**
- Edit: `pnpm-workspace.yaml` (catalog), `apps/server/package.json`, `apps/web/package.json` (deps only)
- Edit (shared wiring, see Step 6): server app composition file(s), env/config module, jobs registry, `/api/v1/info` handler, `apps/web/vite.config.ts`
- Create: `packages/core/src/karma/index.ts` (+ edit `packages/core/src/index.ts` barrel: add `export * from './karma'`)
- Create: `apps/server/src/backups/types.ts`, `apps/server/src/backups/lock.ts`, `apps/server/src/backups/engine.ts` (stub)
- Create: `apps/server/src/import/types.ts`, `apps/server/src/import/todoist-csv.ts` (stub), `apps/server/src/import/todoist-api.ts` (stub), `apps/server/src/import/apply.ts` (stub)
- Create: `apps/server/src/productivity/types.ts`, `apps/server/src/productivity/settings.ts`, `apps/server/src/productivity/rollup.ts` (stub)
- Create: `apps/server/src/jobs/update-check.ts` (stub)
- Create: Drizzle schema additions + generated migration (see Step 3)
- Create if missing: `CHANGELOG.md` (repo root)

**AS-BUILT CHECK (do these reads FIRST, adapt wiring accordingly):**
- Open `apps/server/src/` and identify: the Drizzle schema file(s), the migrations folder + how custom migrations are generated (phase 3 used `drizzle-kit generate`), the Hono app composition (where routers are mounted under `/api/v1`), the auth middleware + how scopes are enforced, the env/config module (phase 3), the croner jobs registry (phase 6), the SSE event-bus publish helper (phase 3), and the multipart-upload handling pattern (phase 3 comments/attachments).
- Inspect the as-built `day_stats` and `activity_log` tables from phase 3. Required by this phase: `day_stats(user_id TEXT, date TEXT, completed_count INT, goal_met INT)` with phase 3's COMPOSITE PK `(user_id, date)` — phase 3's close/reopen routes already upsert by `(userId, date)`, so every rollup read/write in this phase must carry the userId. If `is_day_off` / `is_vacation` integer columns are missing, add them in this phase's migration (`ALTER TABLE day_stats ADD COLUMN … NOT NULL DEFAULT 0`). If `day_stats` does not exist at all, create it in this migration with all six columns (composite PK included).
- Inspect phase-5 settings storage. If productivity fields (daily goal / weekly goal / days off / vacation mode / karma toggle) already exist, implement `productivity/settings.ts` on top of them; otherwise create the `productivity_settings` table below.
- Confirm how the server learns its own version for `/api/v1/info` (phase 3: env/build-arg). Reuse it in `update-check.ts`.

- [ ] **Step 1: Dependencies.** Add to the root `pnpm-workspace.yaml` catalog: `archiver: ^7.0.1`, `'@types/archiver': ^6.0.3`, `node-stream-zip: ^1.15.0`, `csv-parse: ^5.6.0`. Add `"archiver": "catalog:"`, `"node-stream-zip": "catalog:"`, `"csv-parse": "catalog:"` to `apps/server/package.json` dependencies and `"@types/archiver": "catalog:"` to its devDependencies. If `apps/web` has no Vitest setup (check for a `test` script running vitest), add `vitest: catalog:` to its devDependencies, a minimal `apps/web/vitest.config.ts` (`environment: 'node'`, include `src/**/*.test.ts`), and set its `test` script to `vitest run` (keep any existing Playwright script under another name).

- [ ] **Step 2: `packages/core/src/karma/index.ts` — constants + frozen signatures.** Write the constants REAL, the functions as typed stubs (`throw new Error('implemented by Task B')`); Task B replaces the file wholesale keeping these exports byte-compatible:

```ts
import type { Weekday } from '../types'

/** Spec §2.5: karma point values. */
export const KARMA_POINTS = {
  completion: 5,
  onTimeBonus: 3,
  dailyGoal: 10,
  weeklyGoal: 25,
  overduePenalty: -10,
} as const

/** Todoist level thresholds (dossier §1.8). */
export const KARMA_LEVELS = [
  { name: 'Beginner', floor: 0 },
  { name: 'Novice', floor: 500 },
  { name: 'Intermediate', floor: 2500 },
  { name: 'Professional', floor: 5000 },
  { name: 'Expert', floor: 7500 },
  { name: 'Master', floor: 10000 },
  { name: 'Grand Master', floor: 20000 },
  { name: 'Enlightened', floor: 50000 },
] as const

export interface KarmaLevelInfo {
  name: string
  floor: number
  /** null at Enlightened */
  nextFloor: number | null
  /** 0..1 progress from floor to nextFloor (1 at Enlightened) */
  progress: number
}
export function karmaLevel(total: number): KarmaLevelInfo

/** Points earned by completing a task whose (date-only) due is `dueDate` on `completedDate` (both user-tz calendar dates).
 *  No due → {points: 5, onTime: false, overdueDays: 0}. completed ≤ due → 5+3 onTime. 1–3 days late → 5.
 *  ≥4 days late → 5 + (−10) = −5, overdueDays = diff. */
export function completionDelta(a: { completedDate: string; dueDate: string | null }): {
  points: number
  onTime: boolean
  overdueDays: number
}

/** −10 when deleting a task ≥4 days overdue, else 0. */
export function deletionPenalty(a: { deletedDate: string; dueDate: string | null }): number

export interface StreakDay {
  date: string
  completed: number
  goalMet: boolean
  dayOff: boolean
  vacation: boolean
}
/** Walk back from `today`. A day EXTENDS the streak when goalMet; is SKIPPED (neither extends nor
 *  breaks) when dayOff || vacation || (date === today && !goalMet); otherwise BREAKS it.
 *  `days` may be sparse (missing date = completed 0, not off, not vacation → breaks). */
export function computeDailyStreak(days: StreakDay[], today: string): { current: number; longest: number }
/** Weeks bucketed by o.weekStart. A week EXTENDS when Σcompleted ≥ weeklyGoal; SKIPPED when every
 *  non-day-off day is vacation or the week contains `today` and is not yet met; else BREAKS. */
export function computeWeeklyStreak(
  days: StreakDay[],
  o: { today: string; weeklyGoal: number; weekStart: Weekday },
): { current: number; longest: number }

/** Sum of the last 7 entries vs 0 → 'up' | 'down' | 'flat'. Input: per-day karma deltas, oldest first. */
export function karmaTrend(dailyDeltas: number[]): 'up' | 'down' | 'flat'
```

- [ ] **Step 3: Drizzle schema additions + migration.** Add to the as-built schema file(s), following existing column-naming conventions exactly:

```ts
export const backupsMeta = sqliteTable('backups_meta', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull().unique(),
  kind: text('kind', { enum: ['scheduled', 'manual', 'pre_restore'] }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  includesAttachments: integer('includes_attachments', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
})

export const backupSettings = sqliteTable('backup_settings', {
  id: integer('id').primaryKey(), // singleton row id=1; null field = fall back to env/default
  retentionDays: integer('retention_days'),
  includeAttachments: integer('include_attachments', { mode: 'boolean' }),
})

export const karmaLedger = sqliteTable(
  'karma_ledger',
  {
    id: text('id').primaryKey(),
    /** owner — keys rows against phase 3's (user_id, date) day_stats composite PK */
    userId: text('user_id').notNull(),
    at: text('at').notNull(), // ISO instant
    /** user-tz calendar date the points count toward; weekly_goal rows use the week-start date */
    date: text('date').notNull(),
    reason: text('reason', {
      enum: ['completion', 'on_time_bonus', 'daily_goal', 'weekly_goal', 'overdue_penalty', 'reversal', 'reconcile'],
    }).notNull(),
    taskId: text('task_id'),
    delta: integer('delta').notNull(),
  },
  (t) => [
    index('karma_ledger_user_date').on(t.userId, t.date),
    uniqueIndex('karma_ledger_goal_once').on(t.userId, t.date, t.reason)
      .where(sql`reason IN ('daily_goal','weekly_goal')`),
  ],
)

export const importJobs = sqliteTable('import_jobs', {
  id: text('id').primaryKey(),
  source: text('source', { enum: ['todoist-csv', 'todoist-api'] }).notNull(),
  mode: text('mode', { enum: ['dry-run', 'apply'] }).notNull(),
  status: text('status', { enum: ['running', 'done', 'error'] }).notNull(),
  progress: text('progress').notNull(), // JSON ImportProgress
  report: text('report'), // JSON ImportReport when done
  error: text('error'),
  createdAt: text('created_at').notNull(),
  finishedAt: text('finished_at'),
})

export const productivitySettings = sqliteTable('productivity_settings', {
  id: integer('id').primaryKey(), // singleton row id=1
  dailyGoal: integer('daily_goal').notNull().default(5),
  weeklyGoal: integer('weekly_goal').notNull().default(25),
  daysOff: text('days_off').notNull().default('[6,7]'), // JSON array of ISO weekdays
  vacationMode: integer('vacation_mode', { mode: 'boolean' }).notNull().default(false),
  karmaEnabled: integer('karma_enabled', { mode: 'boolean' }).notNull().default(true),
})
```

Skip `productivitySettings` if phase 5 already persisted equivalent fields (see AS-BUILT CHECK; adapt `productivity/settings.ts` instead). Add the `day_stats` columns if missing. Generate the migration the as-built way (e.g. `pnpm --filter @opendoist/server exec drizzle-kit generate --name phase9_data`) and confirm boot-time `migrate()` picks it up.

- [ ] **Step 4: Frozen server types.**

`apps/server/src/backups/types.ts`:
```ts
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
export const RestoreResponseSchema = z.object({ restored: z.literal(true), preRestoreBackup: z.string() })

/** valid on-disk backup names — also the download-route guard (path-traversal defense) */
export const BACKUP_FILENAME_RE = /^opendoist-(backup|prerestore)-\d{4}-\d{2}-\d{2}(-\d{6})?\.zip$/
```

`apps/server/src/import/types.ts`:
```ts
import { IsoDateSchema, HmTimeSchema, PrioritySchema } from '@opendoist/core'
import { z } from 'zod'

export const ImportSkipSchema = z.object({ entity: z.string(), ref: z.string(), reason: z.string() })
export const ImportCommentSchema = z.object({ content: z.string(), postedAt: z.string().nullable() })
export const ImportTaskSchema = z.object({
  key: z.string(),
  projectKey: z.string(),
  sectionKey: z.string().nullable(),
  parentKey: z.string().nullable(),
  content: z.string().min(1), // keeps a leading '* ' (uncompletable) if present
  description: z.string().default(''),
  priority: PrioritySchema, // ALWAYS OpenDoist convention (1 = highest) inside a plan
  dueString: z.string().nullable().default(null), // natural language, re-parsed at apply time
  dueDate: IsoDateSchema.nullable().default(null), // concrete fallback (live API due.date)
  dueTime: HmTimeSchema.nullable().default(null),
  deadline: IsoDateSchema.nullable().default(null),
  durationMin: z.number().int().min(1).max(1440).nullable().default(null),
  labels: z.array(z.string()).default([]),
  childOrder: z.number().int().default(0),
  comments: z.array(ImportCommentSchema).default([]),
})
export const ImportPlanSchema = z.object({
  source: z.enum(['todoist-csv', 'todoist-api']),
  projects: z.array(z.object({
    key: z.string(), name: z.string().min(1),
    color: z.string().nullable(), parentKey: z.string().nullable(),
    isInbox: z.boolean().default(false), // merged into the existing Inbox, never created
  })),
  sections: z.array(z.object({
    key: z.string(), projectKey: z.string(), name: z.string().min(1), order: z.number().int(),
  })),
  labels: z.array(z.object({ key: z.string(), name: z.string().min(1), color: z.string().nullable() })),
  tasks: z.array(ImportTaskSchema),
  skips: z.array(ImportSkipSchema),
})
export type ImportPlan = z.infer<typeof ImportPlanSchema>

export const ImportCountsSchema = z.object({
  projects: z.number().int(), sections: z.number().int(), labels: z.number().int(),
  tasks: z.number().int(), comments: z.number().int(), skips: z.number().int(),
})
export type ImportCounts = z.infer<typeof ImportCountsSchema>
export const ImportReportSchema = z.object({
  mode: z.enum(['dry-run', 'apply']),
  counts: ImportCountsSchema, // found in source
  created: ImportCountsSchema, // written (dry-run: would-write; labels reused ≠ created)
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
  id: z.string(), source: z.enum(['todoist-csv', 'todoist-api']), mode: z.enum(['dry-run', 'apply']),
  status: z.enum(['running', 'done', 'error']),
  progress: ImportProgressSchema, report: ImportReportSchema.nullable(), error: z.string().nullable(),
  createdAt: z.string(), finishedAt: z.string().nullable(),
})

export function planCounts(plan: ImportPlan): ImportCounts // implement inline here (trivial reduce)
```

`apps/server/src/productivity/types.ts`:
```ts
import { z } from 'zod'
export const WeekdayNumSchema = z.number().int().min(1).max(7)
export const ProductivitySettingsSchema = z.object({
  dailyGoal: z.number().int().min(1).max(100),
  weeklyGoal: z.number().int().min(1).max(1000),
  daysOff: z.array(WeekdayNumSchema),
  vacationMode: z.boolean(),
  karmaEnabled: z.boolean(),
})
export type ProductivitySettings = z.infer<typeof ProductivitySettingsSchema>
export const DayStatDtoSchema = z.object({
  date: z.string(), completed: z.number().int(), goalMet: z.boolean(),
  dayOff: z.boolean(), vacation: z.boolean(),
})
export const ProductivityDtoSchema = z.object({
  karmaEnabled: z.boolean(),
  karma: z.object({
    total: z.number().int(),
    level: z.object({ name: z.string(), floor: z.number(), nextFloor: z.number().nullable(), progress: z.number() }),
    trend: z.enum(['up', 'down', 'flat']),
  }),
  goals: ProductivitySettingsSchema.omit({ karmaEnabled: true }),
  today: z.object({ date: z.string(), completed: z.number().int(), goalMet: z.boolean() }),
  week: z.object({ start: z.string(), completed: z.number().int(), goalMet: z.boolean() }),
  streaks: z.object({
    daily: z.object({ current: z.number().int(), longest: z.number().int() }),
    weekly: z.object({ current: z.number().int(), longest: z.number().int() }),
  }),
  days: z.array(DayStatDtoSchema), // last 28, oldest first
  weeks: z.array(z.object({ start: z.string(), completed: z.number().int(), goalMet: z.boolean() })), // last 12
  karmaHistory: z.array(z.object({ date: z.string(), delta: z.number().int(), runningTotal: z.number().int() })), // last 90 days
})
```

- [ ] **Step 5: Stubs + small real modules.** Create typed stubs (each function `throw new Error('implemented by Task <X>')`) with EXACTLY these signatures:
  - `backups/engine.ts` (→ Task C): `createBackup(opts: { kind: BackupInfo['kind'] }): Promise<BackupInfo>` · `listBackups(): Promise<BackupInfo[]>` · `pruneBackups(): Promise<string[]>` · `backupFilePath(filename: string): string` · `effectiveBackupSettings(): { retentionDays: number; includeAttachments: boolean }` · `runNightlyBackup(): Promise<void>`
  - `import/todoist-csv.ts` (→ Task E): `parseTodoistBackupZip(zipPath: string): Promise<ImportPlan>` · `parseTodoistProjectCsv(projectName: string, csvText: string): Pick<ImportPlan, 'sections' | 'tasks' | 'skips'> & { labels: string[] }`
  - `import/apply.ts` (→ Task E): `applyImportPlan(plan: ImportPlan): ImportReport` · `dryRunReport(plan: ImportPlan): ImportReport`
  - `import/todoist-api.ts` (→ Task F): `fetchTodoistExport(token: string, opts?: { baseUrl?: string; fetchImpl?: typeof fetch; onProgress?: (p: ImportProgress) => void }): Promise<ImportPlan>`
  - `productivity/rollup.ts` (→ Task J): `recordCompletion(a: { userId: string; taskId: string; dueDate: string | null; completedAt: string }): void` · `recordUncompletion(a: { userId: string; taskId: string; previousCompletedAt: string }): void` · `recordDeletion(a: { userId: string; taskId: string; dueDate: string | null; deletedAt: string }): void` · `reconcileDayStats(userId: string, days?: number): void` — every signature is user-scoped: writes key against phase 3's `(user_id, date)` day_stats composite PK and the `karma_ledger.user_id` column (callers pass the mutating task's owner)
  - `jobs/update-check.ts` (→ Task O): `interface UpdateState { latestVersion: string; url: string; updateAvailable: boolean; checkedAt: string }` · `getUpdateState(): UpdateState | null` · `checkForUpdate(fetchImpl?: typeof fetch): Promise<UpdateState | null>` · `compareSemver(a: string, b: string): -1 | 0 | 1`

  Implement fully (they are tiny):
  - `backups/lock.ts`: module-scoped boolean; `isMaintenanceLocked(): boolean`; `withMaintenanceLock<T>(fn: () => Promise<T>): Promise<T>` (throws problem-style 409 error if already locked; always unlocks in `finally`); `maintenanceGuard` Hono middleware → when locked, respond `503` problem-JSON `{title: 'Maintenance in progress', detail: 'A backup restore is running; retry shortly.'}` for every path except `/api/health`.
  - `productivity/settings.ts`: `getProductivitySettings(): ProductivitySettings` and `updateProductivitySettings(patch: Partial<ProductivitySettings>): ProductivitySettings` over the as-built storage (or the new singleton table; insert row id=1 with defaults on first read). Parse/serialize `daysOff` JSON.

- [ ] **Step 6: Shared wiring (the ONLY task allowed to touch these files).**
  - Env module: REUSE the existing phase 3 config keys — `loadConfig` already parses all four: `OPENDOIST_BACKUP_RETENTION` (`backupRetention`, default 14), `OPENDOIST_BACKUP_INCLUDE_ATTACHMENTS` (`backupIncludeAttachments`, default true), `OPENDOIST_BACKUP_CRON` (`backupCron`, default `0 3 * * *` — phase 3's frozen default; do NOT change it to another schedule), `OPENDOIST_DISABLE_UPDATE_CHECK` (`disableUpdateCheck`, default false). Do NOT re-declare or re-parse them; import from the as-built config module.
  - App composition: mount `maintenanceGuard` before auth/routes; register routers `backupsRouter` (Task D), `importRouter` (Task G), `productivityRouter` (Task K), `exportRouter` (Task P) under `/api/v1` — create four one-line stub routers next to the feature stubs so the app boots (each an empty as-built-style router; owning tasks replace them; keep the stub file paths exactly `backups/routes.ts`, `import/routes.ts`, `productivity/routes.ts`, `export/routes.ts`).
  - Jobs registry (croner, phase 6 pattern): register `backup.nightly` (cron = `config.backupCron`) → `runNightlyBackup()`; `productivity.reconcile` (`0 3 * * *`) → `reconcileDayStats(userId, 30)` for every id in the `user` table (single-user instances: one iteration); `update.check` (`0 4 * * *` + one run ~10 s after boot) → `checkForUpdate()`, NOT registered when `config.disableUpdateCheck`. Wrap each in try/catch + pino error log so stubs throwing never crash boot (keep the guard after implementation).
  - `/api/v1/info`: add `available_importers: ['todoist-csv', 'todoist-api']` and `update` = (`const s = getUpdateState()`) → `s ? { available: s.updateAvailable, latestVersion: s.latestVersion, url: s.url } : null`.
  - `apps/web/vite.config.ts`: allow the repo-root raw import for Task N — add `server: { fs: { allow: ['../..'] } }` (merge with existing config).
  - Repo root: if `CHANGELOG.md` does not exist, create it with exactly:
```md
# Changelog

All notable changes to OpenDoist.

## [Unreleased]

### Features

- Initial development preview: tasks, projects, filters, reminders, Ramble, CLI, backups, Todoist import.
```

- [ ] **Step 7: Install & gate.** `cd /Users/pranav/developer/opendoist && pnpm install`, then `pnpm lint && pnpm typecheck` clean and `pnpm --filter @opendoist/server test` green (existing suites; stubs compile but are not yet exercised). Boot the server briefly (as-built dev command) and confirm: migration applies, `/api/v1/info` shows `available_importers`, and boot survives stub jobs. Do NOT commit.

---

### Task B: Core karma rules module (pure)

**Files:**
- Replace: `packages/core/src/karma/index.ts`
- Test: `packages/core/src/karma/karma.test.ts`

**Interfaces:** consumes `types.ts` (Weekday), `dates.ts` (`addDaysIso`, `diffDays`, `isoWeekday`); produces exactly the Task A Step 2 exports (keep signatures byte-compatible).

- [ ] **Step 1: Tests first** (`test.each` tables):
  - `karmaLevel`: 0→Beginner (nextFloor 500, progress 0) · 499→Beginner · 500→Novice · 2499→Novice · 2500→Intermediate · 4999→Intermediate · 5000→Professional · 7500→Expert · 10000→Master · 20000→Grand Master · 49999→Grand Master · 50000→Enlightened (nextFloor null, progress 1) · 1500→Novice progress 0.5 · negative total clamps to Beginner progress 0.
  - `completionDelta`: no due → {5, false, 0} · completed 2026-07-15 due 2026-07-15 → {8, true, 0} · completed before due → {8, true, 0} · 1 day late → {5, false, 1} · 3 days late → {5, false, 3} · 4 days late → {-5, false, 4} · 30 days late → {-5, false, 30}.
  - `deletionPenalty`: no due → 0 · 3 days overdue → 0 · 4 days overdue → −10 · due in future → 0.
  - `computeDailyStreak` (today 2026-07-15): 5 consecutive goalMet days ending today → current 5 · goalMet yesterday+before but today not met → today skipped, current counts from yesterday · a dayOff gap does not break · a vacation gap does not break · a plain missed day breaks (current 0 when yesterday missed and today unmet) · longest tracks the best historical run across a break · sparse input (missing dates) breaks.
  - `computeWeeklyStreak` (weekStart 1, weeklyGoal 25): 3 past weeks ≥25 + current week at 10 → current 3 (current week pending-skip) · current week already ≥25 → 4 · a past week of all-vacation days is skipped · a past week at 24 breaks.
  - `karmaTrend`: [+5,…] positives → 'up' · negatives → 'down' · zeros/empty → 'flat'.
- [ ] **Step 2:** Implement (pure calendar math on ISO strings via `dates.ts`; no `Date` in public paths). **Step 3:** `pnpm --filter @opendoist/core test` green; `pnpm typecheck && pnpm lint` clean.

---

### Task C: Backups engine + nightly job + docs

**Files:**
- Replace: `apps/server/src/backups/engine.ts`
- Test: `apps/server/src/backups/engine.test.ts`
- Create: `docs/backups.md`

**Interfaces:** consumes db handle + `DATA_DIR` from as-built config, `backupsMeta`/`backupSettings` tables, `archiver`, `nanoid`; produces the Task A Step 5 engine signatures. **AS-BUILT CHECK:** how phase 3 exposes the better-sqlite3 handle and `DATA_DIR`; how server tests construct a temp-dir/temp-DB app (reuse that harness).

- [ ] **Step 1: Behavior (write tests first against a temp `DATA_DIR`):**
  - `createBackup({kind:'manual'})`: runs `VACUUM INTO '<DATA_DIR>/backups/.tmp-<nanoid>.db'` (better-sqlite3 `db.exec`, single-quotes in path doubled), zips to `.tmp-<name>.zip` via archiver (zip root: `opendoist.db`, `meta.json` = `{app:'opendoist', version, createdAt, includesAttachments, schema:'v1'}`, plus `attachments/**` when `effectiveBackupSettings().includeAttachments`), renames atomically to the final name, deletes the temp db, inserts a `backups_meta` row, returns `BackupInfo`. Filename: `opendoist-backup-YYYY-MM-DD.zip` (UTC date); on collision append `-HHMMSS` UTC; `pre_restore` kind uses `opendoist-prerestore-YYYY-MM-DD-HHMMSS.zip`.
  - `effectiveBackupSettings()`: `backup_settings` row 1 field ?? env ?? default (14 / true).
  - `pruneBackups()`: keep the newest `retentionDays` files of kind scheduled+manual (count-based retention — one nightly backup/day ⇒ ≈N days) and the newest 3 `pre_restore`; delete older files AND their meta rows; return deleted filenames.
  - `listBackups()`: reconcile meta ↔ disk (drop rows whose file vanished; adopt orphan files matching `BACKUP_FILENAME_RE` with kind inferred from name, size/mtime from disk), newest first.
  - `backupFilePath(name)`: reject anything failing `BACKUP_FILENAME_RE` (throw), return `path.join(DATA_DIR, 'backups', name)`.
  - `runNightlyBackup()`: `createBackup({kind:'scheduled'})` then `pruneBackups()`; errors logged, never thrown to the scheduler.
  - Tests: zip contains `opendoist.db` that opens with better-sqlite3 and passes `PRAGMA integrity_check` (extract via `node-stream-zip`); attachments included/excluded per setting; collision suffix; prune keeps exactly N + 3 pre_restore; list reconciliation.
- [ ] **Step 2:** Implement; `pnpm --filter @opendoist/server test -- backups` green.
- [ ] **Step 3:** `docs/backups.md`: nightly job + `OPENDOIST_BACKUP_*` envs table, filename scheme, retention semantics, restore flow + maintenance lock, manual `docker exec` restore fallback, and an optional Litestream 0.5.x S3 sidecar compose snippet (dossier §3.2) with the "0.5.x cannot restore pre-0.5 backups" caveat.

---

### Task D: Backups API + restore + maintenance lock integration

**Files:**
- Replace: `apps/server/src/backups/routes.ts`
- Create: `apps/server/src/backups/restore.ts`
- Edit: the as-built db module — add `closeDatabase(): void` and `reopenDatabase(): void` (close handle / open + PRAGMAs + `migrate()`; keep the exported handle a stable indirection so existing imports still work)
- Test: `apps/server/src/backups/routes.test.ts`, `apps/server/src/backups/restore.test.ts`

**Interfaces:** consumes engine signatures (Task C — mock via `vi.mock('./engine', …)` in route tests), `lock.ts`, `types.ts`, as-built auth middleware + multipart pattern. **AS-BUILT CHECK:** phase-3 db module shape before adding close/reopen; the zod-openapi route registration pattern (copy an existing router); multipart handling from the attachments/uploads route; problem-JSON helper.

- [ ] **Step 1: Routes (all require session or `read_write` token; register full OpenAPI metadata):**
  - `GET /api/v1/backups` → `{results: BackupInfo[], next_cursor: null}`.
  - `POST /api/v1/backups` → `createBackup({kind:'manual'})` → 201 BackupInfo.
  - `GET /api/v1/backups/settings` → BackupSettingsDto; `PATCH` with BackupSettingsPatch → upsert row 1 → updated dto.
  - `GET /api/v1/backups/:filename/download` → validate via `backupFilePath` (404 on invalid/missing), stream file, `Content-Type: application/zip`, `Content-Disposition: attachment; filename="<name>"`.
  - `POST /api/v1/backups/restore` → multipart field `file`; per-route body cap 2 GiB (do NOT apply the attachments `OPENDOIST_UPLOAD_MAX_MB` cap); 200 RestoreResponse or problem-JSON (400 invalid zip/failed verify, 409 already locked).
- [ ] **Step 2: `restore.ts` — `restoreFromZip(zipPath: string): Promise<{preRestoreBackup: string}>`:**
  1. Open with `node-stream-zip`; require entry `opendoist.db` (else 400). Extract db to `<DATA_DIR>/tmp/restore-<nanoid>/opendoist.db`.
  2. Verify: open extracted db read-only with better-sqlite3 → `PRAGMA integrity_check` returns `ok` AND `SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'` non-empty; close. Else 400 problem (`detail` states which check failed).
  3. `withMaintenanceLock`: `createBackup({kind:'pre_restore'})` → `closeDatabase()` → move live `opendoist.db` (+ `-wal`/`-shm` if present) into the tmp dir → copy verified db into place → if the zip has `attachments/`: move live `attachments/` aside and extract the zip's → `reopenDatabase()` (runs `migrate()`, so older backups upgrade) → cleanup tmp.
  4. On any post-swap failure: move originals back, `reopenDatabase()`, rethrow (500). Lock always released.
- [ ] **Step 3: Tests.** Route tests with mocked engine/restore: auth required; list shape; download rejects `../evil.zip` (404) and streams a real temp file; restore returns 409 when lock already held; `maintenanceGuard` returns 503 on `/api/v1/tasks` while a slow (test-controlled) restore holds the lock, `/api/health` still 200. `restore.test.ts`: build a real mini-backup zip from a seeded temp DB → restore into a second temp `DATA_DIR` app → task rows present after; corrupted zip (truncate bytes) → 400 and live db untouched. Verify: `pnpm --filter @opendoist/server test -- backups` green.

---

### Task E: Todoist backup-ZIP CSV importer + shared apply

**Files:**
- Replace: `apps/server/src/import/todoist-csv.ts`, `apps/server/src/import/apply.ts`
- Create: `apps/server/src/import/fixtures/Work [220474322].csv` (verbatim below), `apps/server/src/import/fixtures/Inbox.csv` (2 simple tasks)
- Test: `apps/server/src/import/todoist-csv.test.ts`, `apps/server/src/import/apply.test.ts`

**Interfaces:** consumes `types.ts`, `csv-parse/sync`, `node-stream-zip`, core (`resolveNaturalDate`, `parseRecurrenceText`, `PrioritySchema`), as-built db + id helper. Produces the Task A Step 5 signatures. **AS-BUILT CHECK:** table/column names for projects/sections/tasks/labels/task_labels/comments from the phase-3 schema; how the Inbox project row is identified (flag column vs settings); confirm FTS5 sync is trigger-based (plain inserts index automatically) — if app-level, call the as-built indexing helper after apply; the 20-color palette name list from phase 3 (`berry_red`…`taupe` — same names as Todoist).

Fixture `Work [220474322].csv` (write verbatim; final row of real exports is a separator):
```csv
TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG
section,Planning,,,,,,,,,,,,
task,Draft Q3 roadmap @work,Outline the big rocks,4,1,Pranav (1234567),,every friday,en,,45,minute,2026-08-01,en
note,Remember to include the hiring plan,,,,Pranav (1234567),,2026-07-10T14:03:22Z,,,,,,
task,* Reference material,,1,2,Pranav (1234567),,,,,,,,
task,Book flights @travel @work,,3,1,Pranav (1234567),Someone (7654321),Jul 22,en,US/Eastern,,,,
,,,,,,,,,,,,,
section,Later,,,,,,,,,,,,
task,Water plants,,1,1,Pranav (1234567),,every! 3 days,en,,,,,
```

- [ ] **Step 1: CSV parse tests first.** `parseTodoistProjectCsv('Work', fixtureText)` →
  - sections `Planning` (order 0), `Later` (order 1); separator + header rows ignored; tolerate missing DURATION/DEADLINE columns (old exports) and a UTF-8 BOM.
  - 4 tasks: “Draft Q3 roadmap” — labels `['work']` stripped from content, priority **1** (CSV 4 inverted), dueString `every friday`, durationMin 45 (unit `day` ⇒ ×1440 capped at 1440 + skip note), deadline `2026-08-01`, 1 comment (postedAt from the note row's DATE, content preserved); “* Reference material” — INDENT 2 ⇒ `parentKey` = roadmap task, priority 4, keeps `* ` prefix; “Book flights” — labels `['travel','work']`, priority 2, dueString `Jul 22`, RESPONSIBLE non-empty ⇒ skip note `assignee dropped`; “Water plants” — sectionKey `Later`, dueString `every! 3 days`.
  - Label extraction: `/(^|\s)@([\p{L}\p{N}_-]+)/gu` matches removed from content (deduped, first-spelling); note rows containing `[[file …]]` markers: marker stripped + skip note `attachment dropped`.
  - `parseTodoistBackupZip`: zip of both fixtures → project keys from filenames (strip `.csv`, strip trailing ` [digits]`); `Inbox.csv` ⇒ project entry `isInbox: true`; indent >1 with no eligible ancestor ⇒ top-level + skip note.
- [ ] **Step 2: Apply tests.** `applyImportPlan` on a seeded temp DB: creates projects (color name mapped; unknown → `charcoal` + skip note; `isInbox` merges into the existing Inbox — no new project row), sections, labels (existing label with same name case-insensitively → reused, counted in `counts` not `created`), tasks (parent remap two-pass, `child_order` from plan, content keeps `* ` prefix; **due resolution:** `parseRecurrenceText(dueString)` → recurring Due{date: task.dueDate ?? firstDate, string: dueString, recurrence} · else `resolveNaturalDate(dueString)` → dated Due · else dueDate fallback · else no due + skip note `due dropped`; deadline + duration columns copied), comments with `postedAt` when the comments table has a settable timestamp (AS-BUILT — else now). Single better-sqlite3 transaction — a forced mid-apply error leaves zero rows. Emits ONE `import.completed` SSE/activity event via the as-built bus, not per-task. `dryRunReport` writes nothing and returns identical `created` counts.
- [ ] **Step 3:** Implement both modules; `pnpm --filter @opendoist/server test -- import` green (todoist-api tests belong to Task F).

---

### Task F: Todoist live-API importer

**Files:**
- Replace: `apps/server/src/import/todoist-api.ts`
- Test: `apps/server/src/import/todoist-api.test.ts` (stub `fetchImpl`; no network)

**Interfaces:** consumes `types.ts`; produces `fetchTodoistExport` (Task A Step 5). Base URL default `https://api.todoist.com/api/v1` (dossier §1.9), header `Authorization: Bearer <token>`.

- [ ] **Step 1: Tests first** with a fake `fetchImpl` serving canned pages:
  - Cursor pagination: `GET {base}/projects?limit=200` → `{results:[…], next_cursor:'abc'}` then `?cursor=abc` → `{results:[…], next_cursor:null}`; same loop for `/sections`, `/labels`, `/tasks`. Comments fetched per task: `GET {base}/comments?task_id=<id>` (paginated). Fixture set: 2 projects (one `inbox_project: true` → `isInbox`), 2 sections, 2 labels (`color:'lime_green'`), 4 tasks, 2 comments.
  - Mapping: priority `4→1, 3→2, 2→3, 1→4`; `due {date, string, is_recurring}` → `dueString = due.string`, `dueDate`/`dueTime` split from `due.date` (RFC3339 with time → date + HH:mm; date-only → date, null); `deadline.date` → deadline; `duration {amount, unit}` → minutes (`day` ⇒ ×1440 cap 1440); `labels` names kept; `parent_id`/`section_id`/`project_id` → keys; `child_order` kept.
  - Drops + skips: task with `responsible_uid` set → imported but skip note `assignee dropped`; comment `file_attachment` → text kept + skip note `attachment dropped`; project `shared: true` → skip note `collaborators dropped`; filters/reminders NOT fetched (out of scope) — no calls made.
  - Errors: 401 → throw problem-style error `invalid Todoist token`; 429 with `Retry-After` → single retry after (fake) delay; `onProgress` called with `phase:'fetching'` + growing `fetched` counts.
- [ ] **Step 2:** Implement (plain `fetchImpl ?? fetch` loops, no SDK). Verify: `pnpm --filter @opendoist/server test -- todoist-api` green.

---

### Task G: Import API + job runner

**Files:**
- Replace: `apps/server/src/import/routes.ts`
- Create: `apps/server/src/import/jobs.ts`
- Test: `apps/server/src/import/routes.test.ts`

**Interfaces:** consumes `types.ts`, `import_jobs` table, and the frozen signatures of `todoist-csv.ts` / `todoist-api.ts` / `apply.ts` (mock all three with `vi.mock` — this task must be green before E/F land). **AS-BUILT CHECK:** multipart pattern + tmp-file location (`<DATA_DIR>/tmp/`), zod-openapi router pattern, auth middleware.

- [ ] **Step 1: `jobs.ts`.** `startImportJob(input: { source; mode; zipPath?: string; token?: string }): string` — inserts a `running` row (progress `{phase:'parsing'|'fetching', detail:''}`), runs async (fire-and-forget promise): parse/fetch → plan → `mode === 'apply' ? applyImportPlan : dryRunReport` → update row `done` + report JSON + finishedAt; on throw → `error` status + message; `onProgress` persists progress JSON (throttle ≥250 ms between writes). `getImportJob(id): ImportJobDto | null`. Only one `running` import job at a time → second start returns 409.
- [ ] **Step 2: Routes** (session or `read_write`): `POST /api/v1/import/todoist-csv` — multipart `file` (zip, cap 256 MiB) + text field `mode` (`dry-run`|`apply`, default `dry-run`) → save to tmp → 202 `{jobId}`; `POST /api/v1/import/todoist-api` — JSON `{token: string, mode, baseUrl?: string}` → 202 `{jobId}` (never log/echo the token; `baseUrl` accepted for tests/self-hosted mirrors); `GET /api/v1/import/jobs/:id` → ImportJobDto (404 unknown).
- [ ] **Step 3: Tests.** Mocked parse/fetch/apply: dry-run job reaches `done` with report + zero apply calls; apply mode calls apply once; failing parse → `error` status with message; second concurrent start → 409; job dto zod-validates. Verify: `pnpm --filter @opendoist/server test -- import/routes` green.

---

### Task H: Import UI (settings page)

**Files:**
- Create: `apps/web/src/settings/ImportPage.tsx` (+ colocated `import-format.test.ts` for any pure helpers)
- Edit: the as-built settings navigation/registry file to add the “Import” entry + route `/settings/import`

**AS-BUILT CHECK:** phase-5 settings page conventions (layout wrapper, form components, route registration, API client + TanStack Query patterns, toast helper). No other phase-9 task edits the settings nav file.

- [ ] **Step 1:** Page with two source cards (radio/tab): **“Todoist backup file (.zip)”** — file input (accept `.zip`) + short help text (“Todoist → Settings → Backups → Download”); **“Todoist API token”** — password-type input + help link text (Todoist → Settings → Integrations → Developer). Buttons: “Preview import” (mode dry-run) and “Import” (mode apply; confirm dialog: “Imports add to your existing data. Nothing is deleted. Continue?”).
- [ ] **Step 2:** Submit → POST (multipart or JSON) → poll `GET /api/v1/import/jobs/:id` every 750 ms while `running` (query key `['import-job', id]`): render phase + fetched counts. On `done`: report table — counts row (projects/sections/labels/tasks/comments), created row, and a collapsible skip list (`entity · ref · reason`). Dry-run report shows an “Import now” button that re-submits the SAME source with mode apply. On `error`: problem detail + retry. Availability: read `info.available_importers` (query `['info']`) and render only listed sources.
- [ ] **Step 3:** Tokens-only styling (5/10px radii, Kale accent, focus ring `#1f60c2`). Verify: `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build` clean; manual: page renders with API mocked via existing dev-server (as-built) or Playwright fixture if the suite exists.

---

### Task I: Backups settings page — real wiring (+ export card)

**Files:**
- Edit/Replace: the as-built Backups settings page component (phase 5 placeholder; e.g. `apps/web/src/settings/BackupsPage.tsx` — locate it)
- Create (if the page file doesn't exist yet): `apps/web/src/settings/BackupsPage.tsx` + its nav/route registration line

**AS-BUILT CHECK:** phase-5 Backups settings page location + any placeholder content; confirm the confirm-dialog and table components in use elsewhere.

- [ ] **Step 1: List + actions.** Query `['backups']` → table: filename, kind badge (`scheduled`/`manual`/`pre-restore`), size (human), created (relative). Row action: Download (`<a href="/api/v1/backups/<name>/download">`). Header: “Back up now” → POST `/api/v1/backups`, optimistic spinner, toast + list invalidate.
- [ ] **Step 2: Settings controls.** Query `['backup-settings']`: number input “Backups to keep” (1–365, placeholder shows `effective.retentionDays`, “Default” reset → PATCH null) + toggle “Include attachments” (tri-state: explicit on/off or Default) → PATCH; helper text: “Defaults come from OPENDOIST_BACKUP_RETENTION / OPENDOIST_BACKUP_INCLUDE_ATTACHMENTS”.
- [ ] **Step 3: Restore flow.** “Restore from backup…” → file input (.zip) → confirm dialog (type-to-confirm the word `restore`; copy: “This replaces ALL current data. A safety snapshot is taken first. The app pauses during restore.”) → POST multipart with upload progress → while awaiting, full-page blocking overlay “Restoring…” → on success dialog “Restore complete — safety snapshot <filename>” + `location.reload()`; on failure, problem detail. Handle 503s from other queries during the lock gracefully (they retry after reload).
- [ ] **Step 4: Export card.** “Export” section with two plain download links: “Full JSON export” → `/api/v1/export/json`; “CSV (Todoist-compatible) zip” → `/api/v1/export/csv`. (Endpoints from Task P; links are inert until integration.)
- [ ] Verify: `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build` clean.

---

### Task J: day_stats rollup, completion hooks, nightly reconcile

**Files:**
- Replace: `apps/server/src/productivity/rollup.ts`
- Edit: the as-built task mutation handlers (complete / uncomplete / soft-delete — likely one tasks routes/service file from phase 3) to call the three record hooks
- Test: `apps/server/src/productivity/rollup.test.ts`

**Interfaces:** consumes core karma (`completionDelta`, `deletionPenalty`, `KARMA_POINTS`), `dates.ts` (`dateInTz`), `karma_ledger` + `day_stats` tables, `productivity/settings.ts`, as-built user-timezone accessor. Every hook takes the mutating task's owner `userId` (Task A Step 5 signatures) and addresses `day_stats` by phase 3's `(user_id, date)` composite PK and `karma_ledger` by its `user_id` column — no unscoped reads/writes. **AS-BUILT CHECK:** locate the exact complete/uncomplete/delete code paths incl. recurring-task completion (which advances due — it still counts as a completion; pass the occurrence's due date); how to read the user's timezone server-side; `day_stats` column names.

- [ ] **Step 1: Tests first** (temp DB; fixed timezone `America/New_York`):
  - `recordCompletion` (due today, first of day, dailyGoal 2): +1 `day_stats.completed_count`, ledger rows `completion +5` and `on_time_bonus +3`; captures `is_day_off`/`is_vacation` from current settings for a NEW day row only. Second completion same day → `daily_goal +10` inserted exactly once (`INSERT OR IGNORE` against the partial unique index); crossing the weekly goal inserts `weekly_goal +25` dated the week-start Monday, once per week. 4-days-overdue completion → `completion +5` + `overdue_penalty −10`, no on-time row.
  - `karmaEnabled: false` → day_stats still updated, ledger untouched. `vacationMode: true` → day row has `is_vacation = 1`.
  - `recordUncompletion`: decrements the ORIGINAL completion date's count (derive date from `previousCompletedAt` in user tz), inserts one `reversal` row = −(that task's completion + on_time rows for that date); goal rows left for reconcile.
  - `recordDeletion`: 5-days-overdue task → `overdue_penalty −10`; not-overdue → no row.
  - `reconcileDayStats(userId, 30)`: recomputes `completed_count` per user-tz date from that user's tasks' `completed_at` (last 30 days), fixes `goal_met`, deletes `daily_goal`/`weekly_goal` ledger rows whose day/week no longer qualifies and inserts missing ones; NEVER rewrites `is_vacation`/`is_day_off` on existing rows (only sets them on rows it creates, from current settings); idempotent (second run = no row changes).
  - User isolation: seed a second user with completions on the same date → hooks and `reconcileDayStats` for user A never touch user B's `day_stats`/`karma_ledger` rows (composite-PK/user_id scoping).
- [ ] **Step 2:** Implement; then wire the three hooks into the as-built handlers, passing the task's `user_id` as `userId` (each hook call wrapped in try/catch + log — karma must never fail a task mutation; capture `previousCompletedAt` BEFORE clearing it on uncomplete). Verify: `pnpm --filter @opendoist/server test -- rollup` green + existing tasks-route tests still green.

---

### Task K: Productivity API

**Files:**
- Replace: `apps/server/src/productivity/routes.ts`
- Test: `apps/server/src/productivity/routes.test.ts`

**Interfaces:** consumes `types.ts` DTOs, core karma (`karmaLevel`, `computeDailyStreak`, `computeWeeklyStreak`, `karmaTrend`), `day_stats` + `karma_ledger`, `productivity/settings.ts`. **AS-BUILT CHECK:** router/auth patterns; user timezone + weekStart setting accessors (weekStart for weekly bucketing).

- [ ] **Step 1: Routes.** `GET /api/v1/productivity` (scope `read`) → ProductivityDto computed ONLY over the authed user's rows (`WHERE user_id = ?` on both `karma_ledger` and `day_stats` — phase 3's composite PK): `karma.total` = `SUM(delta)` over that user's ledger (0 when empty); level from core; trend from last-14-day ledger sums; `days` = last 28 day_stats padded with zero-days (oldest first); `weeks` = last 12 by weekStart; streaks via core over the last 400 days of day_stats; `karmaHistory` = last 90 days of per-day deltas + running total ending at `karma.total`. `GET /api/v1/productivity/settings` → ProductivitySettings; `PATCH` (zod-validated partial) → updated settings (this backs the phase-5 Productivity settings page if present — AS-BUILT: point that page's save at this route if it stubbed one).
- [ ] **Step 2: Tests.** Seeded day_stats/ledger fixture → exact DTO snapshot (dates pinned via injected “now”); empty DB → zeroed DTO, level Beginner, streaks 0; PATCH validates (`dailyGoal: 0` → 400 problem). Verify: `pnpm --filter @opendoist/server test -- productivity` green.

---

### Task L: Productivity popover (web)

**Files:**
- Create: `apps/web/src/productivity/ProductivityPopover.tsx`, `apps/web/src/productivity/GoalRing.tsx`
- Edit: the as-built top-bar/header component (mount trigger button) and, if phase 4 keeps a central hotkey map, add `o>p`

**AS-BUILT CHECK:** top-bar component path (phase 4); popover primitive in use (shadcn/Base UI); hotkey registration pattern (`react-hotkeys-hook` `'o>p'`); whether `O then P` was already mapped (then just point it here).

- [ ] **Step 1: `GoalRing`** — pure SVG: 40px circle, `strokeDasharray` progress, accent `var(--od-accent)` track `var(--od-border)`, centered `completed/goal` text (caption 12px); full ring + check state at ≥100%.
- [ ] **Step 2: Popover** (query `['productivity']`, fetch on open): daily + weekly rings side by side; streak lines “N-day streak · longest M” (flame icon `lucide:flame`, `text-secondary`); karma block (hidden entirely when `karmaEnabled` false): total, level name, mini progress bar to `nextFloor`, trend arrow (`trending-up`/`trending-down`/`minus` icon); vacation banner (“Vacation mode is on — streaks paused”) when set; footer link “Open Reporting →” (as-built reporting route). Trigger: ring-style icon button in the top bar (20px icon) + hotkey `o>p`.
- [ ] Verify: `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build` clean.

---

### Task M: Reporting goal charts (web)

**Files:**
- Create: `apps/web/src/reporting/GoalCharts.tsx`, `apps/web/src/reporting/chart-scale.ts`
- Test: `apps/web/src/reporting/chart-scale.test.ts`
- Edit: the as-built Reporting view to add a “Goals” tab/section rendering `<GoalCharts/>`

**AS-BUILT CHECK:** phase-5 Reporting view structure (tabs vs sections) — add alongside activity/completed without restyling them.

- [ ] **Step 1: `chart-scale.ts`** (pure, tested): `niceMax(values: number[], floor: number): number` (smallest of 5/10/25/50/100… ≥ max, ≥ floor) and `barLayout(n: number, width: number, gap: number): {x: number; w: number}[]`. Tests: exact outputs for representative inputs.
- [ ] **Step 2: `GoalCharts`** (query `['productivity']`): (a) “Daily” SVG bar chart — last 14 `days`, bar = completed (accent; `dayOff`/`vacation` days at 40% opacity), dashed horizontal goal line labeled `goal N`, weekday initial x-labels, today highlighted; (b) “Weekly” — 12 `weeks` bars + weekly-goal line, `MMM d` labels; (c) “Karma” — polyline sparkline of `karmaHistory.runningTotal` (90 d) + current level caption; hidden when karma disabled. Bars get `<title>` tooltips (`Jul 14 · 6 completed`). All colors from tokens; charts scroll horizontally inside `overflow-x:auto` if narrow.
- [ ] Verify: `pnpm --filter @opendoist/web test` (chart-scale) green; `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build` clean.

---

### Task N: What's New — changelog bundle, dialog, account-menu footer

**Files:**
- Create: `apps/web/src/whats-new/changelog.ts`, `apps/web/src/whats-new/WhatsNewDialog.tsx`
- Test: `apps/web/src/whats-new/changelog.test.ts`
- Edit: the as-built account-menu component (footer) and the About settings page — phase 5 Task A ALWAYS creates a minimal `AboutPage.tsx` (registry key `about`), so own it UNCONDITIONALLY from here: version line, update-status line reading `info.update`, “View changelog” button

**AS-BUILT CHECK:** account-menu component path (phase 4/5); dialog primitive in use; how the app already fetches `/api/v1/info` (reuse the `['info']` query).

- [ ] **Step 1: `changelog.ts`.** `import changelogRaw from '../../../../CHANGELOG.md?raw'` (repo root; vite `fs.allow` handled by Task A). `parseChangelog(md: string): ChangelogEntry[]` where `ChangelogEntry = { version: string /* 'Unreleased' or 'x.y.z' */, date: string | null, sections: { title: string, items: string[] }[] }` — parse `## [x.y.z] - YYYY-MM-DD` / `## [Unreleased]` headings, `### Title` sections, `- item` lines (strip markdown links to text). Tests: fixture string with Unreleased + two versions → exact structure; empty/malformed input → `[]`.
- [ ] **Step 2: `WhatsNewDialog`.** Props `{open, onClose, version}`: title “What's New in OpenDoist”, entry for `version` (fallback: newest entry incl. Unreleased), sections as headed lists, footer link to GitHub releases (`https://github.com/pranav-karra-3301/opendoist/releases`). Auto-show logic (mount once in the dialog's own provider component, exported and mounted from the account-menu file): read `info.version`; `localStorage['od-seen-version']` null → set silently (first run, no dialog); ≠ current → show dialog once, then set.
- [ ] **Step 3: Account-menu footer.** Bottom of the menu: `v{info.version} · Changelog` (caption 12px `text-tertiary`; “Changelog” is a button opening the dialog with the full entry list scrollable). Verify: `pnpm --filter @opendoist/web test` (changelog) green; typecheck + build clean.

---

### Task O: Update check — server job + banner

**Files:**
- Replace: `apps/server/src/jobs/update-check.ts`
- Test: `apps/server/src/jobs/update-check.test.ts`
- Create: `apps/web/src/update/UpdateBanner.tsx`
- Edit: `apps/web/src/main.tsx` (or the providers-root file — mount `<UpdateBanner/>` above the app; if that file is also the top bar Task L edits, mount from `main.tsx` specifically)

**AS-BUILT CHECK:** server version accessor (must match `/api/v1/info`); pino logger import; where the web app's providers root lives.

- [ ] **Step 1: Server.** `compareSemver`: numeric dot-segment compare, tolerant of `v` prefix and missing segments (`1.2 == 1.2.0`); ignore prerelease suffixes by comparing only the numeric triple. `checkForUpdate(fetchImpl?)`: GET `https://api.github.com/repos/pranav-karra-3301/opendoist/releases/latest` with headers `Accept: application/vnd.github+json`, `User-Agent: opendoist/<version>`; on 200 parse `{tag_name, html_url}` → state `{latestVersion: tag sans 'v', url: html_url, updateAvailable: compareSemver(latest, current) > 0, checkedAt}`; non-200/network error → log at `warn`, keep previous state, return it; store in module state served by `getUpdateState()`. Tests: stubbed fetch — newer tag → available true; equal/older → false; 500 → state unchanged; semver table (`0.2.0 > 0.1.9`, `1.0.0 > 0.9.9`, `v1.2 == 1.2.0`).
- [ ] **Step 2: Web.** `UpdateBanner`: reads `['info']`; renders only when `info.update?.available` and `localStorage['od-dismissed-update'] !== info.update.latestVersion`; slim top bar (accent-soft bg `var(--od-accent-soft)`, body 13px): “OpenDoist vX.Y.Z is available — Release notes” (external link) + dismiss X (stores the version). Verify: `pnpm --filter @opendoist/server test -- update-check` green; web typecheck + build clean.

---

### Task P: Export — canonical JSON + Todoist-compatible CSV zip

**Files:**
- Replace: `apps/server/src/export/routes.ts`
- Create: `apps/server/src/export/json-export.ts`, `apps/server/src/export/csv-export.ts`
- Test: `apps/server/src/export/export.test.ts`

**Interfaces:** consumes as-built schema tables + archiver; routes require session or `read_write`. **AS-BUILT CHECK:** exact table/column names; how due objects are stored (JSON column vs discrete columns) — export the canonical Due shape from core (`{date, time, string, recurrence}`).

- [ ] **Step 1: JSON.** `buildJsonExport(): OpendoistExport` → `{format: 'opendoist-export', version: 1, exportedAt, settings, projects, sections, labels, filters, tasks (incl. completed + soft-deleted excluded; due as core Due; labels as names), comments (attachment meta: filename/size/type only — no file bytes), reminders}`. Route `GET /api/v1/export/json` → `Content-Disposition: attachment; filename="opendoist-export-YYYY-MM-DD.json"`.
- [ ] **Step 2: CSV.** Per non-archived project, emit the exact Task-E column header and rows: sections as `section` rows in order; tasks depth-first with `INDENT` = depth+1, `CONTENT` = content with labels appended as ` @name`, `PRIORITY` = `5 - ours`, `DATE` = `due.string` (falling back to the date), `DURATION`/`DURATION_UNIT` (`minute`), `DEADLINE`; task comments as `note` rows (DATE = ISO instant) after their task; blank separator row between sections; RFC-4180 quoting via manual escape or `csv-parse`'s companion pattern (quote fields containing `," \n`). Zip all CSVs (`<Project name>.csv`, duplicate names suffixed ` (2)`) → `GET /api/v1/export/csv` → `opendoist-export-YYYY-MM-DD.zip`.
- [ ] **Step 3: Tests.** Seeded DB → JSON snapshot zod-parses and contains all seeded entities; CSV: exported text for a project with a section, a subtask, labels, a recurring due, and a note row matches an exact expected string; **round-trip:** feed the exported zip to `parseTodoistBackupZip` (import from Task E's module — if E hasn't landed in your worktree yet, write the test and mark `.skip` with comment `// un-skip at integration gate`) → counts match seeded data. Verify: `pnpm --filter @opendoist/server test -- export` green.

---

### Task Q: Integration gate (SEQUENTIAL — after B–P)

**Files:** may touch anything needed to make the gate pass (smallest possible diffs); removes every remaining stub; un-skips deferred tests (Task P round-trip, any others noted by builders).

- [ ] **Step 1:** `pnpm install` (only if manifests changed), then `pnpm verify` (lint + typecheck + test + build, all packages) — green. Grep for leftovers: `grep -rn "implemented by Task" apps packages` → zero hits.
- [ ] **Step 2: End-to-end script** (temp `DATA_DIR`, dev server on 7968, authenticated via a seeded `od_` token; adapt to as-built seed/login helpers):
  1. `POST /api/v1/backups` → 201; `GET /api/v1/backups` lists it; download the zip and `unzip -l` shows `opendoist.db` + `meta.json`.
  2. Create 2 tasks (one due today) → complete both → `GET /api/v1/productivity` shows `today.completed: 2`, ledger-backed `karma.total ≥ 16` (2×5 + on-time +3 …), `daily_goal` bonus iff goal ≤2; uncomplete one → total drops.
  3. Zip the two Task-E fixture CSVs → `POST /api/v1/import/todoist-csv` (dry-run) → poll job → report counts `{projects: 2, sections: 2, tasks: 6, comments: 1}`-shaped, `created.projects: 1` (Inbox merged); re-run with `mode=apply` → tasks visible via `GET /api/v1/tasks`; `GET /api/v1/info` lists both importers.
  4. `GET /api/v1/export/csv` → feed the zip back through the CSV importer dry-run → counts consistent.
  5. `POST /api/v1/backups/restore` with the step-1 zip → 200 with `preRestoreBackup`; imported tasks from step 3 are gone; a concurrent request during restore observed 503 (script races one `GET /api/v1/tasks`; accept pass-or-503).
  6. With `OPENDOIST_DISABLE_UPDATE_CHECK=true`, boot log shows the job skipped and `info.update` is null.
- [ ] **Step 3: Web smoke.** Build + serve; manually (or via the as-built Playwright suite if present, adding specs only if the harness already runs in CI): Backups page lists/downloads/back-up-now; Import page dry-run preview renders counts; productivity popover opens via click and `o` then `p`; Reporting → Goals renders three charts; account menu shows `vX.Y.Z · Changelog`, and clearing `od-seen-version` + reload shows the What's New dialog; with a stubbed newer release (point update-check at a local fixture via env/patched baseURL or temporarily seeded state), the banner renders and dismisses.
- [ ] **Step 4:** Record every fix in result notes. Do not commit — report ready-for-checkpoint.

## Self-Review (done)

- Scope coverage vs phase-9 charter: backups engine/API/settings UI → C/D/I (+A schema, envs); Todoist importer split exactly as required (CSV = E, live API = F) + import API/jobs (G) + UI (H) + `available_importers` (A); karma core (B), day_stats rollup + reconcile (J), streaks with days-off/vacation (B/J), popover + goal charts (L/M); What's New (N); update check (O). Spec §2.6 export (JSON + Todoist-shape CSV) included as P since no other phase owns it and it round-trips against E.
- Contract consistency: engine/import/rollup/update signatures identical in Task A stubs and owning tasks; ImportPlan priority is OpenDoist-convention everywhere; `BACKUP_FILENAME_RE` shared by engine + routes.
- Parallel safety: every task's file set is disjoint; all shared files (app composition, env, jobs registry, info, vite config, settings nav, top bar, account menu, reporting view, tasks handlers, db module) each have exactly one owning task; A owns all multi-consumer wiring.
- Drift control: AS-BUILT CHECK bullets on every phase-3/5/6 touchpoint (day_stats/activity_log schema, settings storage, jobs registry, router/auth/multipart patterns, web component paths, version accessor).
