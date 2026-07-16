# OpenDoist Phase 5: Filters & Labels, Search, Settings, Reporting, Undo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via a Workflow: Task A first (sequential), Tasks B–W in parallel (disjoint file sets, no commits, no `pnpm install`), Task X integrates.** Commits happen at integration checkpoints, not per-task, because tasks run concurrently in one working tree. Implementation agents run as Opus; integration/review agents as Fable.

**Goal:** Full Filters & Labels experience (CRUD dialogs, drag order, favorites, live-validated query editor), filter views with comma-pane splitting, per-view Display menu persisted via user settings, FTS search in the ⌘K palette, the Reporting view (activity feed + completed tasks), all eleven Settings pages (including the About stub phase 9 completes) with search-within-settings, project/label CRUD dialogs with the 20-color palette, and undo coverage for delete-project/section, reschedule, and move.

**Architecture:** All new product logic that is pure (view grouping/sorting, settings schemas, DTOs) lands in `packages/core` (zero-IO, per spec §3.1). The server gains only thin routes over existing phase-3 tables (`activities`, `tasks/completed`, `tokens`, `search`, settings-key merge, restore endpoints). The web app renders filter views **client-side** with core `parseFilter`/`filterTasks` over the full active-task set (single-user scale); palette search is the only server-FTS surface. Every new contract is frozen in Task A; parallel tasks implement against stubs Task A creates.

**Tech Stack:** already installed by phases 1–4 — React 19 + Vite 8, TanStack Query 5, Zustand 5, Tailwind 4 tokens (`tokens.css`), shadcn/ui on Base UI, dnd-kit (sortable), cmdk, react-hotkeys-hook 5, Lucide; server Hono 4 + @hono/zod-openapi + Drizzle/better-sqlite3 + better-auth; core zod 4 + chrono-node + date-fns.

**Reference documents (already in repo, read before your task):**
- Spec: `docs/superpowers/specs/2026-07-15-opendoist-design.md` (§2.4–2.5 are this phase; §2.1 entities, §4 design system)
- Dossier: `docs/superpowers/research/2026-07-15-opendoist-research.md` (§1.7 filter language, §1.8 views & settings inventory, §2.5 theme table, §2.6 palette, §2.9 component rules)
- Frozen core contract: `packages/core/src/types.ts` — authoritative; do not assume engine internals beyond exported signatures (`parseFilter`, `evaluateFilter`, `filterTasks`, `FilterTaskView`, `FilterContext`, `FilterSyntaxError`, `ParseContext`).

## Global Constraints

- Priorities stored **1 = highest (p1) … 4 = default**.
- Server port **7968**; env vars use the **`OPENDOIST_`** prefix; API tokens use the **`od_`** prefix.
- Radii **5px and 10px only**; default accent **Kale `#4c7a45`**; focus ring **always blue `#1f60c2`** (never the accent); 20-color project palette via `--od-palette-*` tokens; Lucide icons only (16 inline / 18 row actions / 20 toolbar / 24 nav, strokeWidth 1.75 at 20–24).
- Biome formatting/linting (`pnpm lint`), TypeScript `strict`, **no `any`** (`noExplicitAny: error`), `verbatimModuleSyntax`.
- Tests colocated `src/**/*.test.ts(x)`, run by Vitest; every new pure function has tests.
- Component rules cheatsheet (dossier §2.9, mirrored in `CONTRIBUTING.md`) is law: button h32 r5, inputs r5 with grey focus border, menus/dialogs r10, task row ~42px, toast z 400 / tooltip z 1000.
- **Parallel-execution rules:** builders touch ONLY their listed files; never run `pnpm install` (Task A declares any new deps and installs once); never `git commit`. If a phase-4 file you must integrate with is claimed by another phase-5 task's Files list, do NOT edit it — expose your feature from your own files and record the one-line wiring needed in your result notes for Task X.
- **Web test harness rule:** AS-BUILT CHECK once per task — if `apps/web` has Vitest configured (a `vitest.config.ts` or `test` script running vitest), colocate `*.test.tsx` component/logic tests; otherwise put pure logic in `packages/core` or plain `.ts` helpers with tests where a harness exists, and add a Playwright spec under `apps/web/e2e/phase5/<task>.spec.ts` (do not run Playwright yourself; Task X runs it).
- **AS-BUILT CHECK discipline:** phases 3–4 were planned in parallel with this document. Wherever a bullet says "AS-BUILT CHECK", grep/read the repo at execution time and adapt names/paths — the frozen contracts in Task A are the invariant, not the guessed phase-3/4 file names.

---

### Task A: Phase-5 contract freeze + scaffolding (SEQUENTIAL — everything depends on this)

**Files:**
- Create: `packages/core/src/settings.ts`, `packages/core/src/dtos.ts`, `packages/core/src/view.ts` (typed stubs)
- Edit: `packages/core/src/index.ts` (add three `export * from` lines)
- Test: `packages/core/src/settings.test.ts`, `packages/core/src/dtos.test.ts`
- Create: `apps/web/src/lib/api/phase5.ts`
- Create: `apps/web/src/features/settings/registry.ts`, `apps/web/src/features/settings/ui.tsx`, `apps/web/src/features/settings/useSettings.ts`, `apps/web/src/features/settings/SettingsLayout.tsx` (stub), 10 stub pages `apps/web/src/features/settings/pages/{Account,General,Theme,Sidebar,QuickAdd,Productivity,Reminders,Notifications,Backups,Integrations}Page.tsx` + a minimal REAL `apps/web/src/features/settings/pages/AboutPage.tsx` (spec §2.5 lists About/What's New; phase 9 Task N owns it from here)
- Create: `apps/web/src/features/dialogs/store.ts`, `apps/web/src/features/dialogs/DialogHost.tsx`, `apps/web/src/features/dialogs/ColorPicker.tsx`, stubs `apps/web/src/features/dialogs/{ProjectDialog,ProjectConfirms,LabelDialog,FilterDialog}.tsx`
- Create: `apps/web/src/features/undo/store.ts`, stub `apps/web/src/features/undo/UndoHost.tsx`
- Create: `apps/web/src/features/display/useViewPrefs.ts`, stub `apps/web/src/features/display/DisplayMenu.tsx`
- Create stubs: `apps/web/src/features/filters-labels/FiltersLabelsPage.tsx`, `apps/web/src/features/filter-view/FilterViewPage.tsx`, `apps/web/src/features/filter-view/LabelViewPage.tsx`, `apps/web/src/features/reporting/ReportingPage.tsx`
- Edit: the phase-4 router file and app-root component (route + host mounts — see Step 5)

**Interfaces (produces — FROZEN for Tasks B–W):** everything below, verbatim.

- [ ] **Step 0: As-built survey (record findings in result notes; all later tasks read them)**
  - AS-BUILT CHECK: locate the phase-4 router (grep `createBrowserRouter|Routes|TanStackRouter|path:` in `apps/web/src`) and the app-root component that mounts providers.
  - AS-BUILT CHECK: locate phase-4's fetch/API helper (grep `credentials: 'include'|hc<` in `apps/web/src`) — `phase5.ts` must reuse it if present.
  - AS-BUILT CHECK: **settings API shape from the phase-3 user/settings router** — read `apps/server/src` (grep `user/settings|settings`) and confirm it serves the CANONICAL camelCase document defined by phase 3 Task A Step 10 (`SettingsSchema` in `apps/server/src/api/schemas.ts`); Step 1 below re-homes that exact schema in core. Record the storage mechanism and route paths; if the as-built server drifted from the canonical document, Task B reconciles the SERVER back to it (the core schema does not move).
  - AS-BUILT CHECK: confirm `apps/web/package.json` includes `@dnd-kit/core` + `@dnd-kit/sortable`, `cmdk`, `react-hotkeys-hook`, `zustand`, `@tanstack/react-query`, `lucide-react`. If any is missing, add it to the manifest via catalog and run `pnpm install` ONCE now (Task A only may install).
  - AS-BUILT CHECK: `apps/web/src/components/ui/` — ensure `switch`, `select`, `dialog`, `popover`, `tabs`, `dropdown-menu`, `tooltip`, `input`, `button` primitives exist (phase 4). Create minimal Base-UI-styled versions for any missing NOW; parallel tasks must never add files under `components/ui/`.

- [ ] **Step 1: `packages/core/src/settings.ts` (verbatim)** — `UserSettingsSchema` below is BYTE-COMPATIBLE with phase 3 Task A Step 10's canonical `SettingsSchema` (same keys, enums, defaults — camelCase, 8 themes + `autoDark`, `timeFormat` default `'12h'`, `dateFormat` `'MDY' | 'DMY'`). Phase 3's server already persists and serves this exact document; this step re-homes the schema in core so web + server share one definition (Task B switches the server to import it).

```ts
import { z } from 'zod'
import { PrioritySchema, WeekdaySchema } from './types'

export const THEME_NAMES = [
  'kale', 'todoist', 'dark', 'moonstone', 'tangerine', 'blueberry', 'lavender', 'raspberry',
] as const
export const ThemeNameSchema = z.enum(THEME_NAMES)
export type ThemeName = z.infer<typeof ThemeNameSchema>

export const ViewGroupBySchema = z.enum(['none', 'project', 'priority', 'label', 'date'])
export type ViewGroupBy = z.infer<typeof ViewGroupBySchema>
export const ViewSortBySchema = z.enum(['manual', 'date', 'added', 'priority', 'alphabetical'])
export type ViewSortBy = z.infer<typeof ViewSortBySchema>

export const ViewFilterBySchema = z.object({
  priority: PrioritySchema.nullable().default(null),
  /** label NAME (labels are unique by name) */
  label: z.string().nullable().default(null),
  due: z.enum(['has-date', 'no-date', 'overdue']).nullable().default(null),
})
export type ViewFilterBy = z.infer<typeof ViewFilterBySchema>

export const ViewPrefsSchema = z.object({
  groupBy: ViewGroupBySchema.default('none'),
  sortBy: ViewSortBySchema.default('manual'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  filterBy: ViewFilterBySchema.default({ priority: null, label: null, due: null }),
  showCompleted: z.boolean().default(false),
})
export type ViewPrefs = z.infer<typeof ViewPrefsSchema>
export const DEFAULT_VIEW_PREFS: ViewPrefs = ViewPrefsSchema.parse({})

export type ViewKind = 'inbox' | 'today' | 'upcoming' | 'project' | 'label' | 'filter'
/** canonical key into UserSettings.viewPrefs, e.g. 'today', 'project:abc123' */
export function viewKey(kind: ViewKind, id?: string): string {
  return id ? `${kind}:${id}` : kind
}

export const QUICK_ADD_CHIP_IDS = [
  'date', 'deadline', 'priority', 'reminders', 'labels', 'duration', 'description',
] as const
export const QuickAddChipIdSchema = z.enum(QUICK_ADD_CHIP_IDS)
export type QuickAddChipId = z.infer<typeof QuickAddChipIdSchema>
export const QuickAddPrefsSchema = z.object({
  /** full ordered list; hidden chips stay reachable via the composer's overflow menu */
  chips: z
    .array(z.object({ id: QuickAddChipIdSchema, visible: z.boolean() }))
    .default(QUICK_ADD_CHIP_IDS.map((id) => ({ id, visible: true }))),
  /** true = icon + text label, false = icons only */
  labeled: z.boolean().default(true),
})
export type QuickAddPrefs = z.infer<typeof QuickAddPrefsSchema>

export const SidebarPrefsSchema = z.object({
  showInbox: z.boolean().default(true),
  showToday: z.boolean().default(true),
  showUpcoming: z.boolean().default(true),
  showFiltersLabels: z.boolean().default(true),
  showReporting: z.boolean().default(true),
  showCounts: z.boolean().default(true),
})
export type SidebarPrefs = z.infer<typeof SidebarPrefsSchema>

export const NotificationTogglesSchema = z.object({
  push: z.boolean().default(true),
  ntfy: z.boolean().default(false),
  gotify: z.boolean().default(false),
  webhook: z.boolean().default(false),
})
export type NotificationToggles = z.infer<typeof NotificationTogglesSchema>

export const UserSettingsSchema = z.object({
  /** 'inbox' | 'today' | 'upcoming' | 'filters-labels' | 'project:<id>' | 'label:<id>' | 'filter:<id>' */
  homeView: z.string().default('today'),
  timezone: z.string().default('UTC'),
  dateFormat: z.enum(['MDY', 'DMY']).default('MDY'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
  weekStart: WeekdaySchema.default(1),
  nextWeekDay: WeekdaySchema.default(1),
  weekendDay: WeekdaySchema.default(6),
  smartDate: z.boolean().default(true),
  theme: ThemeNameSchema.default('kale'),
  autoDark: z.boolean().default(true),
  dailyGoal: z.number().int().min(0).max(100).default(5),
  weeklyGoal: z.number().int().min(0).max(700).default(25),
  daysOff: z.array(WeekdaySchema).default([6, 7]),
  vacationMode: z.boolean().default(false),
  karmaEnabled: z.boolean().default(true),
  /** minutes before a timed due for the automatic reminder; 0 = at due time; null = off */
  autoReminderMinutes: z.number().int().min(0).max(10080).nullable().default(30),
  notifications: NotificationTogglesSchema.default({ push: true, ntfy: false, gotify: false, webhook: false }),
  sidebar: SidebarPrefsSchema.default({
    showInbox: true, showToday: true, showUpcoming: true,
    showFiltersLabels: true, showReporting: true, showCounts: true,
  }),
  quickAdd: QuickAddPrefsSchema.default({
    chips: QUICK_ADD_CHIP_IDS.map((id) => ({ id, visible: true })), labeled: true,
  }),
  /** keyed by viewKey(); PATCH semantics: shallow merge at top level, per-key replace inside viewPrefs */
  viewPrefs: z.record(z.string(), ViewPrefsSchema).default({}),
})
export type UserSettings = z.infer<typeof UserSettingsSchema>
export const DEFAULT_USER_SETTINGS: UserSettings = UserSettingsSchema.parse({})
export const UserSettingsPatchSchema = UserSettingsSchema.partial()
export type UserSettingsPatch = z.infer<typeof UserSettingsPatchSchema>
```

- [ ] **Step 2: `packages/core/src/dtos.ts` (verbatim)**

```ts
import { z } from 'zod'
import { IsoDateSchema, PrioritySchema } from './types'

/** Known activity types (UI icons/labels); DTO tolerates unknown strings so server drift never breaks the feed. */
export const KNOWN_ACTIVITY_TYPES = [
  'task_added', 'task_updated', 'task_completed', 'task_uncompleted', 'task_deleted',
  'task_restored', 'task_moved', 'project_added', 'project_updated', 'project_archived',
  'project_unarchived', 'project_deleted', 'project_restored', 'section_added',
  'section_updated', 'section_deleted', 'section_restored', 'label_added', 'label_updated',
  'label_deleted', 'filter_added', 'filter_updated', 'filter_deleted', 'comment_added', 'comment_deleted',
] as const
export type KnownActivityType = (typeof KNOWN_ACTIVITY_TYPES)[number]

/** Wire shape = phase 3's ActivityDto (snake_case top level: event_type/entity_type/entity_id/project_id/at)
 *  EXTENDED by Task B with a read-time-denormalized `payload` object. Phase 3's stored event-specific
 *  payload lands in `payload.meta`; content/project_name are joined at read time. */
export const ActivityEventSchema = z.object({
  id: z.string(),
  event_type: z.string(), // tolerates unknown strings so server drift never breaks the feed
  entity_type: z.string().default(''),
  entity_id: z.string(),
  project_id: z.string().nullable().default(null),
  /** ISO instant */
  at: z.string(),
  payload: z.object({
    content: z.string().default(''),
    project_name: z.string().nullable().default(null),
    meta: z.record(z.string(), z.unknown()).default({}),
  }).default({ content: '', project_name: null, meta: {} }),
})
export type ActivityEvent = z.infer<typeof ActivityEventSchema>
export const ActivityPageSchema = z.object({
  results: z.array(ActivityEventSchema),
  next_cursor: z.string().nullable(),
})

/** Subset parse of phase 3's TaskDto rows served by GET /tasks/completed — the response contract
 *  stays phase 3's TaskDto page (zod strips the fields we don't need). Project names are joined
 *  client-side from the `['projects']` cache. */
export const CompletedTaskSchema = z.object({
  id: z.string(),
  content: z.string(),
  project_id: z.string(),
  priority: PrioritySchema.default(4),
  /** ISO instant */
  completed_at: z.string(),
})
export type CompletedTask = z.infer<typeof CompletedTaskSchema>
export const CompletedPageSchema = z.object({
  results: z.array(CompletedTaskSchema),
  next_cursor: z.string().nullable(),
})

/** One hit from GET /search — phase 3's `{task, matched_in}` wrapper (matched_in: 'task' | 'comment';
 *  phase 3's FTS cannot distinguish content vs description hits), EXTENDED by Task B with `snippet`. */
export const SearchResultSchema = z.object({
  task: z.object({
    id: z.string(),
    content: z.string(),
    project_id: z.string(),
    completed_at: z.string().nullable().default(null),
    due: z.object({ date: IsoDateSchema }).partial().nullable().default(null),
  }).passthrough(), // full TaskDto on the wire; parse only what the palette renders
  matched_in: z.enum(['task', 'comment']),
  /** FTS snippet with <b>…</b> marks around matches; '' when unavailable */
  snippet: z.string().default(''),
})
export type SearchResult = z.infer<typeof SearchResultSchema>
export const SearchPageSchema = z.object({
  results: z.array(SearchResultSchema),
  next_cursor: z.string().nullable().default(null),
})

export const ApiTokenScopeSchema = z.enum(['read', 'read_write'])
export const ApiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: ApiTokenScopeSchema,
  /** first 8 chars of the token for identification, e.g. 'od_3fa9…' */
  start: z.string().default('od_'),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable().default(null),
})
export type ApiToken = z.infer<typeof ApiTokenSchema>
/** returned ONLY from POST /tokens; `token` is shown once and never retrievable again */
export const CreatedApiTokenSchema = ApiTokenSchema.extend({ token: z.string().regex(/^od_/) })
export type CreatedApiToken = z.infer<typeof CreatedApiTokenSchema>
```

- [ ] **Step 3: `packages/core/src/view.ts` — typed stubs (replaced wholesale by Task C)**

```ts
// implemented by Task C — typed stubs so dependents typecheck meanwhile
import type { ViewFilterBy, ViewGroupBy, ViewSortBy } from './settings'
import type { FilterContext, FilterTaskView } from './types'

export interface TaskGroup {
  key: string
  label: string
  tasks: FilterTaskView[]
}
export function applyViewFilter(tasks: FilterTaskView[], _f: ViewFilterBy, _ctx: FilterContext): FilterTaskView[] {
  return tasks
}
export function sortTasks(tasks: FilterTaskView[], _s: ViewSortBy, _dir: 'asc' | 'desc', _ctx: FilterContext): FilterTaskView[] {
  return tasks
}
export function groupTasks(tasks: FilterTaskView[], _g: ViewGroupBy, _ctx: FilterContext): TaskGroup[] {
  return [{ key: 'all', label: '', tasks }]
}
/** split a raw filter query into per-pane source strings on TOP-LEVEL commas (respects \ escapes and parens) */
export function splitPanesRaw(query: string): string[] {
  return [query]
}
```

Append to `packages/core/src/index.ts`: `export * from './settings'`, `export * from './dtos'`, `export * from './view'`.
`settings.test.ts`: `DEFAULT_USER_SETTINGS` parses, theme default `'kale'`, dailyGoal 5, viewKey('project','x') === 'project:x', patch schema accepts `{ theme: 'dark' }` and rejects `{ theme: 'neon' }`. `dtos.test.ts`: ActivityEventSchema tolerates unknown `event_type` strings and defaults a missing `payload`; CompletedTaskSchema parses a full phase-3 TaskDto row (extra fields stripped); CreatedApiTokenSchema rejects tokens not starting `od_`.

- [ ] **Step 4: `apps/web/src/lib/api/phase5.ts` — typed client (frozen surface; adapt ONLY the transport line to phase 4's helper)**

```ts
import {
  ActivityPageSchema, ApiTokenSchema, CompletedPageSchema, CreatedApiTokenSchema,
  SearchPageSchema, UserSettingsSchema, type UserSettings, type UserSettingsPatch,
  type FilterTaskView,
} from '@opendoist/core'
import { z } from 'zod'

/** AS-BUILT CHECK: if phase 4 exports an authed fetch helper, delegate to it here — keep this signature. */
async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    ...init,
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  if (res.status === 204) return undefined as T // phase-3 reorder/delete routes return 204 No Content
  return schema.parse(await res.json())
}
const qs = (p: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString()

export const getUserSettings = () => api('/user/settings', UserSettingsSchema)
export const patchUserSettings = (patch: UserSettingsPatch) =>
  api('/user/settings', UserSettingsSchema, { method: 'PATCH', body: JSON.stringify(patch) })

export const listActivities = (p: { cursor?: string; types?: string; project_id?: string; since?: string; until?: string; limit?: number }) =>
  api(`/activities?${qs(p)}`, ActivityPageSchema)
export const listCompleted = (p: { cursor?: string; project_id?: string; since?: string; until?: string; limit?: number }) =>
  api(`/tasks/completed?${qs(p)}`, CompletedPageSchema)
export const searchServer = (q: string, limit = 20) => api(`/search?${qs({ q, limit })}`, SearchPageSchema)

export const listTokens = () => api('/tokens', z.array(ApiTokenSchema))
export const createToken = (b: { name: string; scope: 'read' | 'read_write' }) =>
  api('/tokens', CreatedApiTokenSchema, { method: 'POST', body: JSON.stringify(b) })
export const revokeToken = (id: string) =>
  api(`/tokens/${id}`, z.object({ ok: z.boolean() }), { method: 'DELETE' })

/** Phase 3's reorder contract: POST body {items: [{id, item_order}]} → 204 (mirrors tasks/projects
 *  {items: [{id, child_order}]}). Do NOT invent an {orderedIds} body — the routes already exist. */
export const reorderFilters = (orderedIds: string[]) =>
  api('/filters/reorder', z.void(), {
    method: 'POST',
    body: JSON.stringify({ items: orderedIds.map((id, i) => ({ id, item_order: i + 1 })) }),
  })
export const reorderLabels = (orderedIds: string[]) =>
  api('/labels/reorder', z.void(), {
    method: 'POST',
    body: JSON.stringify({ items: orderedIds.map((id, i) => ({ id, item_order: i + 1 })) }),
  })
export const restoreEntity = (kind: 'tasks' | 'projects' | 'sections', id: string) =>
  api(`/${kind}/${id}/restore`, z.object({ ok: z.boolean() }), { method: 'POST' })

/** Map a phase-3 task DTO to core FilterTaskView.
 *  AS-BUILT CHECK: reconcile field names with GET /api/v1/tasks response (grep the phase-3 task schema);
 *  the OUTPUT shape is frozen by core types — only the input mapping may change. */
export function toFilterTaskView(
  t: Record<string, unknown>,
  projects: ReadonlyMap<string, { name: string; parentId: string | null }>,
  sectionNames: ReadonlyMap<string, string>,
): FilterTaskView {
  const s = (v: unknown) => (typeof v === 'string' ? v : null)
  const due = (t.due ?? null) as { date?: string; time?: string | null; recurrence?: unknown } | null
  return {
    id: String(t.id), content: String(t.content ?? ''), description: String(t.description ?? ''),
    dueDate: due?.date ?? null, dueTime: due?.time ?? null, isRecurring: Boolean(due?.recurrence),
    deadline: s(t.deadlineDate ?? t.deadline_date), priority: (t.priority ?? 4) as FilterTaskView['priority'],
    labels: (t.labels ?? []) as string[], projectId: String(t.projectId ?? t.project_id ?? ''),
    projectName: projects.get(String(t.projectId ?? t.project_id ?? ''))?.name ?? '',
    sectionName: sectionNames.get(String(t.sectionId ?? t.section_id ?? '')) ?? null,
    parentId: s(t.parentId ?? t.parent_id), createdAt: String(t.createdAt ?? t.created_at ?? ''),
    uncompletable: Boolean(t.uncompletable),
  }
}
```

- [ ] **Step 5: web scaffolding (stubs + hosts + routes)**
  - `features/settings/registry.ts` (frozen):
```ts
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
export interface SettingsPageDef {
  key: string
  title: string
  keywords: string[]
  Component: LazyExoticComponent<ComponentType>
}
export const SETTINGS_PAGES: SettingsPageDef[] = [
  { key: 'account', title: 'Account', keywords: ['password', 'email', 'name', 'totp', '2fa', 'two-factor', 'oidc', 'sso', 'delete account', 'danger'], Component: lazy(() => import('./pages/AccountPage')) },
  { key: 'general', title: 'General', keywords: ['home view', 'timezone', 'date format', 'time format', 'week start', 'next week', 'weekend', 'smart date', 'language'], Component: lazy(() => import('./pages/GeneralPage')) },
  { key: 'theme', title: 'Theme', keywords: ['dark', 'appearance', 'color', 'kale', 'auto dark', 'sync theme'], Component: lazy(() => import('./pages/ThemePage')) },
  { key: 'sidebar', title: 'Sidebar', keywords: ['navigation', 'show', 'hide', 'counts', 'views'], Component: lazy(() => import('./pages/SidebarPage')) },
  { key: 'quick-add', title: 'Quick Add', keywords: ['chips', 'buttons', 'reorder', 'icons', 'labels'], Component: lazy(() => import('./pages/QuickAddPage')) },
  { key: 'productivity', title: 'Productivity', keywords: ['goal', 'daily', 'weekly', 'streak', 'days off', 'vacation', 'karma'], Component: lazy(() => import('./pages/ProductivityPage')) },
  { key: 'reminders', title: 'Reminders', keywords: ['automatic', 'offset', 'before', 'test notification'], Component: lazy(() => import('./pages/RemindersPage')) },
  { key: 'notifications', title: 'Notifications', keywords: ['push', 'ntfy', 'gotify', 'webhook', 'channels'], Component: lazy(() => import('./pages/NotificationsPage')) },
  { key: 'backups', title: 'Backups', keywords: ['backup', 'restore', 'download', 'retention'], Component: lazy(() => import('./pages/BackupsPage')) },
  { key: 'integrations', title: 'Integrations', keywords: ['api', 'token', 'developer', 'openapi', 'scalar', 'calendar feed', 'ical'], Component: lazy(() => import('./pages/IntegrationsPage')) },
  { key: 'about', title: 'About', keywords: ['version', 'changelog', "what's new", 'update', 'release'], Component: lazy(() => import('./pages/AboutPage')) },
]
```
  - Each of the 10 stub pages: `export default function AccountPage() { return null } // implemented by Task M` (adjust name/task letter per file; Tasks M–V replace wholesale). `AboutPage.tsx` is NOT a stub — no phase-5 task replaces it: Task A writes a minimal real page (app name, `v{version}` from the `['info']` query, note "Changelog and update status arrive with the productivity release"); phase 9 Task N owns it unconditionally from there (version line, update status, View-changelog button). Same one-line stub pattern for `SettingsLayout.tsx` (Task L), `DisplayMenu.tsx` (Task H), `UndoHost.tsx` (Task W), `ProjectDialog/ProjectConfirms` (Task F), `LabelDialog/FilterDialog` (Task E), `FiltersLabelsPage` (Task D), `FilterViewPage/LabelViewPage` (Task G), `ReportingPage` (Task K) — stubs render `null` (pages may render a `<div>` with the page title so routes are visibly wired).
  - `features/settings/ui.tsx` (frozen, complete — all settings pages must use these):
```tsx
import type { ReactNode } from 'react'
export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-subtitle font-medium text-text-primary mb-1">{title}</h2>
      {description ? <p className="text-copy text-text-secondary mb-3 max-w-prose">{description}</p> : null}
      <div className="rounded-lg border border-border divide-y divide-border-subtle bg-surface-raised">{children}</div>
    </section>
  )
}
export function SettingRow({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-body text-text-primary">{label}</div>
        {description ? <div className="text-caption text-text-tertiary">{description}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}
```
  - `features/settings/useSettings.ts` (frozen, complete):
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_USER_SETTINGS, UserSettingsSchema, type UserSettings, type UserSettingsPatch } from '@opendoist/core'
import { getUserSettings, patchUserSettings } from '../../lib/api/phase5'

export function mergeSettings(base: UserSettings, patch: UserSettingsPatch): UserSettings {
  const next = { ...base, ...patch }
  if (patch.viewPrefs) next.viewPrefs = { ...base.viewPrefs, ...patch.viewPrefs }
  return UserSettingsSchema.parse(next)
}
export function useUserSettings() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['user-settings'], queryFn: getUserSettings, staleTime: 30_000 })
  const mutation = useMutation({
    mutationFn: patchUserSettings,
    onMutate: async (patch: UserSettingsPatch) => {
      await qc.cancelQueries({ queryKey: ['user-settings'] })
      const prev = qc.getQueryData<UserSettings>(['user-settings'])
      qc.setQueryData<UserSettings>(['user-settings'], (s) => mergeSettings(s ?? DEFAULT_USER_SETTINGS, patch))
      return { prev }
    },
    onError: (_e, _p, ctx) => { if (ctx?.prev) qc.setQueryData(['user-settings'], ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['user-settings'] }),
  })
  return { settings: query.data ?? DEFAULT_USER_SETTINGS, isLoading: query.isLoading, update: mutation.mutate }
}
```
  - `features/display/useViewPrefs.ts` (frozen, complete):
```ts
import { DEFAULT_VIEW_PREFS, type ViewPrefs } from '@opendoist/core'
import { useUserSettings } from '../settings/useSettings'
export function useViewPrefs(key: string) {
  const { settings, update } = useUserSettings()
  const prefs = settings.viewPrefs[key] ?? DEFAULT_VIEW_PREFS
  const setPrefs = (p: Partial<ViewPrefs>) => update({ viewPrefs: { [key]: { ...prefs, ...p } } })
  return { prefs, setPrefs }
}
```
  - `features/dialogs/store.ts` (frozen, complete):
```ts
import { create } from 'zustand'
export type DialogRequest =
  | { kind: 'project'; mode: 'create' | 'edit'; projectId?: string }
  | { kind: 'project-archive'; projectId: string }
  | { kind: 'project-delete'; projectId: string }
  | { kind: 'section-delete'; sectionId: string }
  | { kind: 'label'; mode: 'create' | 'edit'; labelId?: string }
  | { kind: 'filter'; mode: 'create' | 'edit'; filterId?: string }
interface DialogStore {
  open: DialogRequest | null
  openDialog: (d: DialogRequest) => void
  close: () => void
}
export const useDialogStore = create<DialogStore>((set) => ({
  open: null,
  openDialog: (d) => set({ open: d }),
  close: () => set({ open: null }),
}))
```
  - `features/dialogs/DialogHost.tsx` (frozen, complete): renders `<ProjectDialog />`, `<ProjectConfirms />`, `<LabelDialog />`, `<FilterDialog />` unconditionally (each component internally reads `useDialogStore` and renders nothing unless its `kind` is open).
  - `features/dialogs/ColorPicker.tsx` (frozen, complete):
```tsx
export const PROJECT_COLORS = [
  'berry_red', 'red', 'orange', 'yellow', 'olive_green', 'lime_green', 'green', 'mint_green',
  'teal', 'sky_blue', 'light_blue', 'blue', 'grape', 'violet', 'lavender', 'magenta',
  'salmon', 'charcoal', 'grey', 'taupe',
] as const
export type ProjectColor = (typeof PROJECT_COLORS)[number]
export const colorVar = (c: string) => `var(--od-palette-${c.replaceAll('_', '-')})`
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: ProjectColor) => void }) {
  return (
    <div role="radiogroup" aria-label="Color" className="grid grid-cols-10 gap-2">
      {PROJECT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} title={c.replaceAll('_', ' ')}
          onClick={() => onChange(c)}
          className="h-6 w-6 rounded-full outline-offset-2 aria-checked:outline-2 aria-checked:outline-focus-ring"
          style={{ backgroundColor: colorVar(c) }}
        />
      ))}
    </div>
  )
}
```
  - `features/undo/store.ts` (frozen, complete):
```ts
import { create } from 'zustand'
export interface UndoableAction { id: number; message: string; undo: () => Promise<void> }
interface UndoStore {
  current: UndoableAction | null
  push: (a: { message: string; undo: () => Promise<void> }) => void
  runUndo: () => Promise<void>
  dismiss: () => void
}
let seq = 0
export const useUndoStore = create<UndoStore>((set, get) => ({
  current: null,
  push: (a) => set({ current: { ...a, id: ++seq } }),
  runUndo: async () => { const c = get().current; set({ current: null }); if (c) await c.undo() },
  dismiss: () => set({ current: null }),
}))
```
  - **Routes** — edit the phase-4 router: `/filters-labels` → FiltersLabelsPage, `/filter/:id` → FilterViewPage, `/label/:id` → LabelViewPage, `/reporting` → ReportingPage, `/settings` (redirect to `/settings/account`) + `/settings/:page` → SettingsLayout. All lazy. `/label/:id` REPLACES phase 4's name-keyed `/label/$labelName` route — DELETE that route here (id is required for `viewKey('label', id)` prefs anyway); Task J rewrites every phase-4 label link (sidebar favorites, palette recents) to the id-keyed route. AS-BUILT CHECK: follow phase 4's route registration idiom exactly.
  - **Hosts** — edit the app-root component: mount `<DialogHost />` and `<UndoHost />` once, inside providers, outside route switching.

- [ ] **Step 6: gate this task** — `pnpm --filter @opendoist/core test` green; `pnpm typecheck` clean; `pnpm lint` clean; `pnpm --filter @opendoist/web build` succeeds. Record all AS-BUILT findings (router path, fetch helper, settings storage shape, existing undo/palette/sidebar file paths) in result notes — they are the map for Tasks B–W.

---

### Task B: Server surface — settings keys, activities, completed, tokens, restore, search (parallel)

**Files:** `apps/server/**` only (routes, schema/migrations, better-auth config, tests). No web/core files.

**Interfaces:** Produces the wire contracts consumed by `apps/web/src/lib/api/phase5.ts` (Task A Step 4) — response bodies MUST validate against the core schemas (`UserSettingsSchema`, `ActivityPageSchema`, `CompletedPageSchema`, `SearchPageSchema`, `ApiTokenSchema`, `CreatedApiTokenSchema`). All routes zod-typed via `@hono/zod-openapi` so they appear in `/api/v1/openapi.json`. RFC 9457 problem-JSON on errors; cursor pagination `{results, next_cursor}`.

- [ ] **Step 1 — settings.** Phase 3 Task A Step 10 already defines the CANONICAL camelCase settings document (identical to core's `UserSettingsSchema` from Task A Step 1) and phase 3 Task G already implements GET/PATCH `/api/v1/user/settings` with shallow-merge-at-top-level + per-key replace inside `viewPrefs`, publishing bus event `settings.updated` with entity `'settings'`. This step is a RECONCILE, not a build: switch the server's schema import to core's `UserSettingsSchema` (delete the duplicate definition in `apps/server/src/api/schemas.ts`, re-exporting from `@opendoist/core` to keep existing imports compiling), verify the PATCH merge semantics with a test, and verify the SSE publish keeps entity `'settings'` (NOT `'user_settings'` — phase 4's SseEventSchema enum only admits phase 3's entity union and silently drops anything else). Fix any drift on the SERVER side; never re-key the document.
- [ ] **Step 2 — activities.** Phase 3 Task G ships `GET /api/v1/activities` (ListQuery + `event_type` + `entity_type` + `project_id` + `since`/`until`, `(at DESC, id)` keyset). This step EXTENDS that route in place — update phase 3's route zod schema, OpenAPI metadata, and `activities.test.ts` in this task: (a) add a `types` query param (csv of event types, superset of the single-value `event_type`, which stays for compatibility); (b) enrich each item with the read-time-denormalized `payload` object from core's `ActivityEventSchema` (`content` = entity content looked up at read time, `project_name` joined from projects, phase 3's stored event-specific payload moved under `payload.meta`) — top-level field names stay phase 3's snake_case (`event_type`, `entity_type`, `entity_id`, `project_id`, `at`). Response must parse with `ActivityPageSchema`; newest first, unlimited history. If phase 3 does NOT yet log events for some phase-5 ops (restore, move, archive), add emissions in the relevant mutation handlers.
- [ ] **Step 3 — completed.** Phase 3 Task B ships `GET /api/v1/tasks/completed` returning a TaskDto page ordered `(completed_at DESC, id)`. Keep that response contract UNCHANGED (core's `CompletedTaskSchema` parses the subset it needs from TaskDto rows; project names join client-side) and only ADD `since`/`until` query params (ISO dates compared against `completed_at`, mirroring phase 3's activities params) — updating phase 3's route schema/OpenAPI/tests for the new params in this task.
- [ ] **Step 4 — tokens.** `GET /api/v1/tokens`, `POST /api/v1/tokens {name, scope}` → `CreatedApiTokenSchema` (full `od_…` value returned exactly once), `DELETE /api/v1/tokens/:id` → `{ok:true}`. Implement over better-auth `@better-auth/api-key` server API (`auth.api.createApiKey/listApiKeys/deleteApiKey`) with `prefix: 'od_'` and scope stored in key permissions — phase 3 freezes `permissions: { opendoist: ['read'] }` / `{ opendoist: ['read', 'read_write'] }` as the ONLY two shapes (the auth guard computes scope from `permissions.opendoist`); map `scope` ⇄ that namespace. AS-BUILT CHECK: phase 3's api-key plugin config — reuse its table and prefix; only add the thin `/api/v1/tokens` wrapper if phase 3 didn't already expose equivalent routes (if it did, align paths/shapes to this contract or add aliases).
- [ ] **Step 5 — restore + reorder.** `POST /api/v1/{tasks|projects|sections}/:id/restore` → `{ok:true}` (NEW routes, this phase owns them): clears `deleted_at` on the row and on child rows carrying the identical `deleted_at` timestamp (cascade marker set at delete time — AS-BUILT CHECK how phase 3 cascades; if it stamps children with the same instant, this works; otherwise restore the entity plus all soft-deleted descendants). `POST /api/v1/projects/:id/unarchive` if missing. Reorder: phase 3 Task E already ships `POST /api/v1/filters/reorder` + `/api/v1/labels/reorder` (body `{items: [{id, item_order}]}` → 204, same pattern as tasks/projects) — do NOT redefine them; verify they rewrite `item_order` in one transaction, and add activity logging/SSE publishes there only if phase 3 omitted them. Log matching activity events for the new restore routes; publish SSE.
- [ ] **Step 6 — search.** Phase 3 Task H ships `GET /api/v1/search?q&limit` returning `{results: [{task: TaskDto, matched_in: 'task' | 'comment'}], next_cursor}`. Keep that wrapper EXACTLY (do not remove or rename fields) and EXTEND each item with `snippet`: task hits via FTS5 `snippet(tasks_fts, -1, '<b>', '</b>', '…', 12)` (column -1 lets SQLite pick the matching column — content or description), comment hits via the same over `comments_fts`; `''` when unavailable. Response must parse with `SearchPageSchema`; update phase 3's route schema/OpenAPI/`search.test.ts` for the added field in this task. (`matched_in` stays two-valued — phase 3's FTS cannot distinguish content vs description hits, and the palette does not need it.)
- [ ] **Step 7 — TOTP plugin.** AS-BUILT CHECK: if better-auth `twoFactor` plugin is not registered in the server auth config, register it (issuer "OpenDoist") and run the better-auth schema generation into a drizzle migration. Keep OIDC/password flows untouched.
- [ ] **Step 8 — tests** (colocated, temp-SQLite harness per phase 3): settings PATCH merge semantics incl. viewPrefs per-key replace; activities filter by type+project+date and cursor paging; completed listing; token create → `od_` prefix + show-once (GET never returns full token); restore round-trip (delete project with tasks → restore → tasks back); reorder persists; search finds a word from a comment. Verify: `pnpm --filter @opendoist/server test` green; `curl -s localhost:7968/api/v1/openapi.json | grep -c activities` ≥ 1 when running locally (optional smoke).

### Task C: Core view engine — group/sort/filter-by + pane splitting (parallel)

**Files:** Replace `packages/core/src/view.ts`; Create `packages/core/src/view.test.ts`.

**Interfaces:** Consumes `types.ts` (FilterTaskView, FilterContext), `dates.ts` (dateInTz, diffDays, isoWeekday), `settings.ts`. Produces exactly the four functions frozen in Task A Step 3 (same signatures; `TaskGroup` unchanged).

- [ ] Semantics (each row a test):
  - `applyViewFilter`: priority → exact match; label → task.labels includes name (case-insensitive); due `'has-date'` → dueDate ≠ null, `'no-date'` → null, `'overdue'` → dueDate < today-in-ctx or (== today and dueTime < now wall-clock). Null fields = no-op.
  - `sortTasks` (stable, non-mutating; `desc` reverses): `manual` → input order unchanged; `date` → dueDate+dueTime asc, no-date last; `added` → createdAt asc; `priority` → 1 first, ties by dueDate; `alphabetical` → content localeCompare (case-insensitive).
  - `groupTasks`: `none` → single group `{key:'all', label:''}`; `project` → group per projectName (input order of first appearance), key `project:<id>`; `priority` → P1..P4 groups, labels "Priority 1"… (skip empty); `label` → one group per label sorted alphabetically, tasks with multiple labels appear in EACH, plus trailing "No label" group; `date` → buckets Overdue / Today / Tomorrow / weekday-name for next 7 days / "Later" / "No date" in that order (skip empty), computed against `ctx.now`/`ctx.timezone`.
  - `splitPanesRaw('#Inbox & no date, view all & !#Inbox')` → two trimmed strings; `\,` escaped comma does not split; commas inside `()` do not split; result length always ≥ 1.
- [ ] Verify: `pnpm --filter @opendoist/core test` green (≥ 20 new cases incl. a fixture set of 8 tasks spanning all buckets); `pnpm lint && pnpm typecheck` clean.

### Task D: Filters & Labels page (parallel)

**Files:** Replace `apps/web/src/features/filters-labels/FiltersLabelsPage.tsx`; Create `apps/web/src/features/filters-labels/{FilterList.tsx,LabelList.tsx,SortableRow.tsx}` (+ test/e2e per harness rule).

**Interfaces:** Consumes phase-4 filters/labels TanStack queries (AS-BUILT CHECK: grep `['filters']|['labels']` query keys; create `useFilters`/`useLabels` hooks INSIDE these files if phase 4 has none, fetching `GET /api/v1/filters|labels`), `reorderFilters/reorderLabels` from `phase5.ts`, `useDialogStore`, `colorVar`.

- [ ] Page (route `/filters-labels`, view title "Filters & Labels", content max 800px): two sections with headers + "Add" icon-buttons (open `{kind:'filter',mode:'create'}` / `{kind:'label',mode:'create'}`).
- [ ] Rows: color dot (12px circle, `colorVar(color)`), name (navigates to `/filter/:id` or `/label/:id`), favorite star toggle (PATCH `is_favorite`, optimistic), overflow menu (Edit → dialog store; Delete → confirm then DELETE + `useUndoStore.push` with restore — filters/labels are small: undo recreates via POST with the captured object since they have no soft-delete guarantee; AS-BUILT CHECK: if DELETE is soft + restore route exists, prefer restore).
- [ ] Drag reorder within each list via dnd-kit `SortableContext` (vertical, drag handle on hover, `--shadow-drag` ghost); on drop, optimistic reorder + `reorderFilters/reorderLabels(orderedIds)`; rollback on error. Lists ordered by `item_order`, favorites shown with filled star.
- [ ] Empty states ("No filters yet — filters are saved searches…"). Verify: typecheck+lint clean; e2e spec: create → rename → reorder → delete → undo restores.

### Task E: Filter & label dialogs + query editor with live validation (parallel)

**Files:** Replace `apps/web/src/features/dialogs/{FilterDialog.tsx,LabelDialog.tsx}`; Create `apps/web/src/features/dialogs/QueryEditor.tsx`, `apps/web/src/features/dialogs/useAllTasks.ts` (+ tests per harness rule).

**Interfaces:** Consumes `parseFilter`, `filterTasks`, `FilterSyntaxError`, `splitPanesRaw` from `@opendoist/core`; `toFilterTaskView` from `phase5.ts`; `ColorPicker`; `useDialogStore`; filters/labels mutations (AS-BUILT CHECK: reuse phase-4 mutation hooks if present, else POST/PATCH `/api/v1/filters|labels` inline). Produces `useAllTasks(): { tasks: FilterTaskView[]; ctx: FilterContext; isLoading: boolean }` — fetches ALL active tasks (`GET /api/v1/tasks`, follow `next_cursor` until null, query key `['tasks','all']`) + projects/sections maps, builds `FilterContext` from `useUserSettings()` (now = `new Date().toISOString()`, timezone/weekStart/nextWeekDay/weekendDay from settings, projects map). **Task G imports `useAllTasks` from this file.**

- [ ] `QueryEditor` (controlled): monospace input; on change (debounce 150ms) run `parseFilter`; on `FilterSyntaxError` show red `text-caption` message with a caret marker at `error.position` under the input (input keeps grey border per component rules; message in `--od-danger`); on success show pane chips: `splitPanesRaw(q).map` → chip "Pane N · {count} tasks" where count = `filterTasks(parsed, tasks, ctx)[i].length`. Show "Syntax help" link → tooltip/popover listing operators `& | ! () , \ *` and examples from dossier §1.7.
- [ ] `FilterDialog`: name input (required), QueryEditor (required, must parse to save), ColorPicker, "Add to favorites" switch; create/edit modes (edit pre-fills from filter id); save → POST/PATCH, invalidate `['filters']`, close; radius 10px dialog, primary button accent.
- [ ] `LabelDialog`: name (required, unique — surface 409 problem-JSON as inline error), ColorPicker, favorite switch.
- [ ] Verify: typecheck+lint; unit tests for editor states (invalid → message with position; valid `a, b` → 2 pane chips) with mocked `useAllTasks`; e2e: create filter `(today | overdue) & #Inbox` shows live count before saving.

### Task F: Project CRUD dialogs — color, favorites, archive, delete (parallel)

**Files:** Replace `apps/web/src/features/dialogs/{ProjectDialog.tsx,ProjectConfirms.tsx}` (+ tests per harness rule).

**Interfaces:** Consumes `ColorPicker`, `useDialogStore`, `useUndoStore`, `restoreEntity`, phase-4 project queries/mutations (AS-BUILT CHECK: grep `['projects']`; reuse create/update/delete/archive mutations, else call `/api/v1/projects` inline with optimistic invalidation).

- [ ] `ProjectDialog` (create/edit): name (required), description (optional, textarea), ColorPicker (default `charcoal`), parent-project select ("None" + non-archived projects excluding self/descendants), "Add to favorites" switch. Create → POST; edit → PATCH. Inbox rule: editing Inbox allows nothing but view prefs — hide Inbox from parent options and never offer delete/archive for it (AS-BUILT CHECK: how phase 3 flags the inbox project, e.g. `is_inbox`).
- [ ] `ProjectConfirms`: archive confirm ("Archive {name}? Its tasks stay but leave active views.") → POST archive + `useUndoStore.push({message:'Project archived', undo: () => unarchive})`; delete confirm (type-name-to-confirm for projects with >10 tasks) → DELETE + `push({message:'Project deleted', undo: () => restoreEntity('projects', id)})`. Section delete confirm (`kind:'section-delete'`) → DELETE + undo via `restoreEntity('sections', id)`.
- [ ] Verify: typecheck+lint; e2e: create project with `lime_green`, favorite it, archive, undo from toast, delete, undo.

### Task G: Filter view (comma panes) + label view (parallel)

**Files:** Replace `apps/web/src/features/filter-view/{FilterViewPage.tsx,LabelViewPage.tsx}`; Create `apps/web/src/features/filter-view/FilterPane.tsx` (+ e2e per harness rule).

**Interfaces:** Consumes `useAllTasks` (Task E file — import only), `parseFilter`, `filterTasks`, `splitPanesRaw`, `groupTasks/sortTasks/applyViewFilter`, `useViewPrefs`, `DisplayMenu` (stub until H), phase-4 task-list rendering (AS-BUILT CHECK: reuse the phase-4 `TaskList`/`TaskRow` components so checkboxes/priorities/undo behave identically — grep `TaskRow`).

- [ ] `/filter/:id`: load filter by id (from `['filters']` cache or GET), `parseFilter(query)`; on `FilterSyntaxError` render an error card with "Edit filter" button → `openDialog({kind:'filter',mode:'edit',filterId})`. Panes: `filterTasks(parsed, tasks, ctx)` zipped with `splitPanesRaw(query)`; **one pane → normal single list; multiple → horizontal flex row, each pane `min-w-[320px] max-w-[--content-max] flex-1`, container `overflow-x-auto`**, pane header = its raw sub-query (13px `text-secondary`) + task count. Each pane applies view prefs (key `viewKey('filter', id)` — one Display menu for the whole view, applied per pane) through `applyViewFilter → sortTasks → groupTasks` and renders groups with sticky group headers.
- [ ] `/label/:id`: header = label name + color dot (label resolved BY ID from the `['labels']` cache — Task A Step 5 already replaced phase 4's name-keyed `/label/$labelName` route with this id-keyed one, so this task owns only the page body); tasks = `useAllTasks` filtered where `labels` includes the label's name; prefs key `viewKey('label', id)`; same group/sort pipeline; Display menu in header.
- [ ] Both pages re-render live on SSE-driven query invalidation (no extra wiring beyond using the shared queries). Verify: typecheck+lint; e2e: filter `#Inbox & no date, view all & !#Inbox` renders two side-by-side panes with correct counts.

### Task H: Display menu + per-view persistence + show-completed (parallel)

**Files:** Replace `apps/web/src/features/display/DisplayMenu.tsx`; Create `apps/web/src/features/display/CompletedSection.tsx`; Edit phase-4 view components for Inbox, Today, Upcoming, and Project views (header area only — AS-BUILT CHECK the file names, e.g. `apps/web/src/views/*.tsx`; these files belong to THIS task).

**Interfaces:** Consumes `useViewPrefs`, core view engine, `listCompleted` from `phase5.ts`, labels query (for filter-by label options). Produces `DisplayMenu({ viewKey, showCompletedAvailable }: { viewKey: string; showCompletedAvailable?: boolean })` and `CompletedSection({ projectId }: { projectId?: string })`.

- [ ] `DisplayMenu`: toolbar icon-button (Lucide `SlidersHorizontal`, 20px) opening a 10px-radius popover: **Group by** select (None/Project/Priority/Label/Date), **Sort by** select (Manual/Date/Date added/Priority/Alphabetical) + direction toggle, **Filter by** rows (Priority select 1–4/Any, Label select, Due select Any/Has date/No date/Overdue), **Show completed** switch, and a "Reset to default" ghost button (writes `DEFAULT_VIEW_PREFS`). Every change calls `setPrefs` immediately (optimistic via `useUserSettings`). A dot on the trigger when prefs ≠ defaults.
- [ ] Wire into view headers: Inbox `viewKey('inbox')`, Today `viewKey('today')`, Upcoming `viewKey('upcoming')`, Project `viewKey('project', id)` — pipe each view's tasks through `applyViewFilter → sortTasks → groupTasks` before rendering (keep phase-4 section/sub-task rendering for project view when groupBy is `none` and sortBy `manual`; the pipeline replaces rendering only when prefs deviate from defaults). AS-BUILT CHECK: today/upcoming have their own inherent grouping — group-by there applies WITHIN the day/overdue blocks; keep it simple: when groupBy ≠ none in Today, replace the flat list with groups (Overdue block always stays on top).
- [ ] `CompletedSection`: when `showCompleted` is on, render a "Completed" divider + rows (checked circle, strike-through `text-tertiary` content, completion date 12px) fetched via `listCompleted({project_id})`, infinite cursor "Show more"; uncomplete button per row (POST reopen — AS-BUILT CHECK phase-3 route name, e.g. `/tasks/:id/reopen` or `/uncomplete`) invalidating both lists.
- [ ] Verify: typecheck+lint; unit test the prefs→pipeline mapping with fixture tasks; e2e: set Today group-by priority → reload → persisted; toggle show completed in a project → completed rows appear.

### Task I: Palette FTS search + navigation commands (parallel)

**Files:** Edit the phase-4 ⌘K palette component files (AS-BUILT CHECK: grep `cmdk|CommandDialog` in `apps/web/src` — these files belong to THIS task); Create `apps/web/src/features/search/useServerSearch.ts` (+ test per harness rule).

**Interfaces:** Consumes `searchServer` from `phase5.ts` (Task B provides the endpoint). Produces `useServerSearch(query: string)` — TanStack query, `enabled: query.trim().length >= 2`, debounced 200ms, key `['search', q]`, `staleTime: 10_000`.

- [ ] Palette: when input is non-empty, add a "Tasks" group rendering search results — checkbox-style icon (results whose `task.completed_at` is non-null dimmed with strike-through), snippet with `<b>` marks rendered safely (split on `<b>`/`</b>` — never `dangerouslySetInnerHTML`; fall back to `task.content` when snippet is empty), project name 12px `text-tertiary` on the right (joined client-side from the `['projects']` cache via `task.project_id`), `matched_in === 'comment'` shows a small comment icon. Selecting navigates to the task via phase 4's canonical `/task/:id` deep link / `?task=` search param (AS-BUILT CHECK: phase 4's task-open mechanism) and records it in palette recents.
- [ ] Add navigation commands to the default (empty-input) command list: "Go to Filters & Labels", "Go to Reporting", "Settings", "Settings > Theme", plus one command per settings page ("Settings > {title}" from `SETTINGS_PAGES` registry). Keep existing phase-4 commands untouched.
- [ ] Loading/empty states: "Searching…" skeleton row; "No results for '{q}'". Verify: typecheck+lint; unit test snippet-mark splitting; e2e: create task "buy groceries // milk and eggs", palette-search "eggs" finds it via description.

### Task J: Sidebar + keyboard integration (parallel)

**Files:** Edit the phase-4 sidebar component files and the phase-4 keyboard-map file (AS-BUILT CHECK: grep `Sidebar` and `useHotkeys|hotkey` in `apps/web/src` — these files belong to THIS task).

**Interfaces:** Consumes `useUserSettings` (sidebar prefs), filters/labels queries, `useDialogStore`.

- [ ] Sidebar: add "Filters & Labels" nav item (Lucide `Tags` or `Filter`, 24px) → `/filters-labels`; add "Reporting" item (Lucide `Activity`) → `/reporting`. Apply `settings.sidebar`: hide items whose `show*` is false (Inbox/Today/Upcoming/Filters & Labels/Reporting); `showCounts === false` hides count badges (AS-BUILT CHECK: phase-4 count badges — if absent, add Today count = tasks due ≤ today from the shared tasks query; keep 12px `text-tertiary`).
- [ ] Favorites section: favorite **filters and labels** appear alongside favorite projects (color dot + name, navigate to their views — labels to the id-keyed `/label/:id`). Rewrite EVERY phase-4 label link to `/label/:id` while here: sidebar favorites and palette-recents entries (Task A Step 5 deleted the `/label/$labelName` route, so any surviving name-keyed link is a dead route). AS-BUILT CHECK: phase 4's favorites block — extend it; if none exists, add a "Favorites" group above Projects shown only when at least one favorite exists.
- [ ] Keyboard sequences (react-hotkeys-hook, follow phase 4's registration idiom): `g>v` → `/filters-labels`, `g>a` → `/reporting`, `g>l` → `/filters-labels` (labels anchor), `o>s` → `/settings/account`, `o>t` → `/settings/theme`, `o>p` → `/reporting`. Ensure they're listed in the `?` shortcut overlay (AS-BUILT CHECK: overlay data source — append entries).
- [ ] Verify: typecheck+lint; e2e: press `g` then `v` lands on Filters & Labels; toggling `showToday` off (via settings API) hides Today from sidebar after refetch.

### Task K: Reporting view — activity feed + completed mode (parallel)

**Files:** Replace `apps/web/src/features/reporting/ReportingPage.tsx`; Create `apps/web/src/features/reporting/{ActivityFeed.tsx,CompletedFeed.tsx,ReportingFilters.tsx,activity-presentation.ts}` (+ tests per harness rule).

**Interfaces:** Consumes `listActivities`, `listCompleted` from `phase5.ts`; `KNOWN_ACTIVITY_TYPES`, `ActivityEvent` from core; projects query for the project filter; `useUserSettings` for date/time format.

- [ ] `activity-presentation.ts` (pure, unit-tested): `eventIcon(eventType)` (from `e.event_type`) → Lucide name (task_added `Plus`, task_completed `CircleCheck`, task_uncompleted `Undo2`, `*_deleted` `Trash2`, `*_updated` `Pencil`, project_* `Hash`, comment_* `MessageSquare`, section_* `Rows3`, label_* `Tag`, filter_* `Filter`, unknown → `CircleDot`); `eventSentence(e)` → "You completed a task: {content}" style strings for all known types, generic "…{type.replace('_',' ')}…" fallback; `dayLabel(atIso, tz, now)` → "Today" / "Yesterday" / "Jul 13 · Sunday".
- [ ] Page (route `/reporting`, title "Reporting"): tabs **Activity** | **Completed** (shadcn Tabs). `ReportingFilters` row shared by both: event-type multi-select (Activity tab only; from `KNOWN_ACTIVITY_TYPES` with "All" default), project select ("All projects"), date range (presets: All time / Last 7 days / Last 30 days / custom since–until date inputs). Filters map to query params (`types` csv, `project_id`, `since`, `until`).
- [ ] `ActivityFeed`: `useInfiniteQuery` on `listActivities` (`getNextPageParam: (p) => p.next_cursor`); events grouped under sticky day headers via `dayLabel`; each row = 16px icon + sentence (content 14px `text-primary` from `e.payload.content`, verb/frame 13px `text-secondary`) + project name chip (`e.payload.project_name`) + time (respect 12h/24h). "Load more" sentinel button (IntersectionObserver optional). Unlimited history — no cap notice.
- [ ] `CompletedFeed`: same day-grouping over `listCompleted`; row = checked circle + strike-through content + project chip (name joined client-side from the `['projects']` cache via `project_id` — the wire rows are phase 3 TaskDto subsets); uncomplete action per row.
- [ ] Verify: typecheck+lint; unit tests for `eventSentence`/`dayLabel` (incl. unknown type fallback); e2e: complete a task → Reporting Activity shows it under "Today"; filter by type `task_completed` narrows the feed.

### Task L: Settings shell — layout, routing, search-within-settings (parallel)

**Files:** Replace `apps/web/src/features/settings/SettingsLayout.tsx`; Create `apps/web/src/features/settings/SettingsSearch.tsx` (+ test per harness rule).

**Interfaces:** Consumes `SETTINGS_PAGES` registry (frozen), router params (`/settings/:page`).

- [ ] `SettingsLayout`: Todoist-style centered overlay dialog (max-w 960px, h ~min(720px, 90vh), radius 10px, `--shadow-dialog`) over the current view; left nav (200px, `--od-surface` bg) listing registry pages (icon-less, 14px rows, active = `--od-selected` + `--od-selected-text`), right pane renders the active page in `<Suspense>` (spinner fallback) with page title header (20px semibold). Close button (X, top-right) + Esc → navigate back to the underlying view (AS-BUILT CHECK: use router "background location" if phase 4 has the pattern; otherwise navigate to `settings.homeView` mapped route). Unknown `:page` param → redirect to `account`. Mobile (<768px): nav becomes the first screen; picking a page slides to it with a back button.
- [ ] `SettingsSearch`: input pinned atop the nav ("Search settings…"); fuzzy-lite match (`title` + `keywords`, case-insensitive substring) filters nav entries live and highlights the matched substring; Enter opens the first match; no matches → "No settings found".
- [ ] Verify: typecheck+lint; e2e: open `/settings/theme` directly renders Theme; typing "week" in search shows General; Enter navigates.

### Task M: Settings page — Account (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/AccountPage.tsx`; Edit the phase-4 better-auth client file to add the `twoFactorClient` plugin (AS-BUILT CHECK: grep `createAuthClient` — this file belongs to THIS task).

**Interfaces:** Consumes settings `ui.tsx` primitives, better-auth react client (`authClient.useSession`, `updateUser`, `changePassword`, `twoFactor.*`, `listAccounts`, `deleteUser`), `GET /api/v1/info` for configured OIDC providers.

- [ ] Sections: **Profile** (name input + Save via `updateUser`; email shown read-only with change flow via `changeEmail` if better-auth verification is configured, else read-only with tooltip). **Password** (current + new + confirm, min 8; `authClient.changePassword({revokeOtherSessions:true})`; success/error inline). **Two-factor authentication**: disabled state → "Enable 2FA" → password prompt → `twoFactor.enable` → show TOTP secret + `data:` QR (generate QR locally — AS-BUILT CHECK: if no QR lib is installed, render the `otpauth://` URI as copyable text + secret; do NOT add deps) → verify 6-digit code → enabled state shows "Disable 2FA" (password-gated). AS-BUILT CHECK: Task B registers the server plugin; if `authClient.twoFactor` is undefined at runtime, render the section with a "requires server restart" notice rather than crashing. **Connected accounts**: list from `listAccounts` (provider, linked date) + providers advertised by `/api/v1/info` not yet linked shown as "Link {name}" buttons (`signIn.oauth2`/`linkSocial` per better-auth SSO idiom). **Danger zone** (red-bordered section): "Sign out everywhere" (`revokeSessions` → sign-out) and "Delete account" (type-email-to-confirm → `deleteUser` → redirect to login; warn it erases all data).
- [ ] Verify: typecheck+lint; e2e: change password → old session still valid, sign-out/sign-in with new password works.

### Task N: Settings page — General (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/GeneralPage.tsx`; Edit the phase-4 parse-context hook if needed (AS-BUILT CHECK below — that single file belongs to THIS task).

**Interfaces:** Consumes `useUserSettings`, `ui.tsx`, projects/labels/filters queries (home-view options).

- [ ] Rows (each writes via `update(...)` immediately): **Home view** select — static options Inbox/Today/Upcoming/Filters & Labels + optgroups Projects/Labels/Filters with values `project:<id>` etc.; **Timezone** searchable select from `Intl.supportedValuesOf('timeZone')` (current browser tz hinted); **Date format** MDY "Jan 3, 2026" / DMY "3 Jan 2026"; **Time format** 12h/24h; **Week start** weekday select (Mon–Sun); **Next week** weekday select; **Weekend** weekday select; **Smart date recognition** switch with description "Turn off to stop Quick Add from converting typed dates".
- [ ] AS-BUILT CHECK (wiring): find where phase 4 builds `ParseContext` for Quick Add (grep `smartDate|DEFAULT_PARSE_CONTEXT_SETTINGS`); ensure it derives `timezone/weekStart/nextWeekDay/weekendDay/smartDate` from `useUserSettings()` — edit that one hook file if it uses hardcoded defaults. Also ensure the app's root redirect honors `settings.homeView` (AS-BUILT: if phase 4's root route hardcodes Today, update it here).
- [ ] Verify: typecheck+lint; e2e: turn smart-date off → Quick Add "call mom tomorrow" keeps "tomorrow" in the title; set home view Inbox → app root lands on Inbox.

### Task O: Settings page — Theme (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/ThemePage.tsx`; Edit the phase-4 theme-application code (AS-BUILT CHECK: grep `data-theme|od-theme` — that file belongs to THIS task).

**Interfaces:** Consumes `useUserSettings`, `THEME_NAMES`, `ui.tsx`.

- [ ] Theme grid: 8 cards (2/4 columns responsive), one per `THEME_NAMES` entry. Each card is a mini app preview rendered with `data-theme={name}` on the card root so tokens.css paints it authentically: sidebar strip (`var(--od-surface)`), canvas (`var(--od-bg)`), accent pill (`var(--od-accent)`), fake task rows; name below; selected card gets a 2px `--od-focus-ring` outline + check badge. Click → `update({ theme: name })`.
- [ ] Rows: **Auto Dark Theme** switch (`autoDark`) with description "Follow the system and switch to Dark automatically"; note line "Your theme syncs across devices — it's stored in your account settings."
- [ ] Wiring (single source of truth): resolution = `autoDark && OS-dark ? 'dark' : theme`; on settings change AND on OS `prefers-color-scheme` change, set `document.documentElement.dataset.theme` (kale = remove the attribute per tokens.css) and mirror to `localStorage['od-theme']`/`['od-auto-dark']` so the phase-1 head script paints the right theme pre-hydration (AS-BUILT CHECK: reconcile with the head script's exact localStorage keys/values in `apps/web/index.html`; adjust mirror-writes, not the frozen settings keys).
- [ ] Verify: typecheck+lint; e2e: pick Tangerine → accent changes app-wide and survives reload; enable autoDark + emulate dark OS → Dark theme wins; explicit Dark stays dark under light OS.

### Task P: Settings page — Sidebar (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/SidebarPage.tsx` (+ test per harness rule).

- [ ] Section "Show in sidebar": switches for Inbox, Today, Upcoming, Filters & Labels, Reporting → `update({ sidebar: { ...settings.sidebar, showX } })` (send the full sidebar object). Section "Options": "Show task counts" switch. Description note: "Hidden views stay reachable from search and keyboard shortcuts." (Task J applies these to the actual sidebar.)
- [ ] Verify: typecheck+lint; unit test: toggling emits a full `sidebar` object patch.

### Task Q: Settings page — Quick Add chips (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/QuickAddPage.tsx`; Edit the phase-4 Quick Add chip-row component to consume prefs (AS-BUILT CHECK: grep the composer's chip/action row — that file belongs to THIS task).

**Interfaces:** Consumes `useUserSettings`, `QUICK_ADD_CHIP_IDS`, dnd-kit sortable.

- [ ] Chip list (7 rows, dnd-kit vertical sortable with grip handles): icon + label per chip id (date `Calendar`, deadline `Flag`… pick sensible Lucide icons; keep the map local) + visibility switch per row. Drag reorder + toggles write the FULL `quickAdd.chips` array (`update({ quickAdd: { ...settings.quickAdd, chips } })`). Row for **"Show labels on buttons"** switch (`labeled`). Live preview strip at top rendering the chip row exactly as the composer will (visible chips in order; icons-only when `labeled` false).
- [ ] Composer wiring: chip row reads `settings.quickAdd` — render visible chips in stored order, overflow "…" menu contains hidden chips; `labeled` toggles text labels. Keep all phase-4 chip behaviors (what each chip inserts) untouched.
- [ ] Verify: typecheck+lint; e2e: hide "duration", reorder "priority" first → Quick Add composer reflects both after reload.

### Task R: Settings page — Productivity (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/ProductivityPage.tsx` (+ test per harness rule).

- [ ] Rows: **Daily goal** number input 0–100 (default 5, description "Tasks per day; 0 disables"); **Weekly goal** 0–700 (default 25); **Days off** — 7 weekday toggle-chips Mon–Sun (selected = excluded from streaks; writes `daysOff` array of ISO weekday numbers); **Vacation mode** switch ("Pauses goals; streaks are preserved"); **Karma** switch (`karmaEnabled`, description links the karma formula: "+5 per completion, +3 on-time bonus, +10 daily goal, +25 weekly goal, −10 per task ≥4 days overdue"). Info banner: "Goal charts and karma history arrive with the productivity release (phase 9) — your goals are tracked from now."
- [ ] Verify: typecheck+lint; unit test: days-off chips round-trip `[6,7]` default.

### Task S: Settings page — Reminders (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/RemindersPage.tsx` (+ test per harness rule).

- [ ] Rows: **Automatic reminders** select — options None (`null`) / At due time (0) / 10 / 30 (default) / 45 / 60 / 120 minutes before, writing `autoReminderMinutes`; description "Added automatically to tasks that have a due time." **Test notification** button — onClick POST `/api/v1/channels/test` if the route exists (AS-BUILT CHECK at runtime: on 404/501 show toast "Notification channels arrive in phase 6"); render the button always (it is the phase-6 hook point).
- [ ] Verify: typecheck+lint; unit test: select maps "None"→null and "At due time"→0 correctly.

### Task T: Settings page — Notifications (placeholder wiring for phase 6) (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/NotificationsPage.tsx` (+ test per harness rule).

- [ ] Four channel cards (Push, ntfy, Gotify, Webhook), each: icon, one-line description, enable switch bound to `settings.notifications.<key>` (full-object patch like Task P), and a disabled "Configure" button with tooltip "Configuration arrives with reminders (phase 6)". Push card additionally shows browser permission state (`Notification.permission`) as a badge (granted/denied/default) — informational only. Banner: toggles are saved now and take effect when channels ship.
- [ ] Verify: typecheck+lint; unit test: toggling ntfy patches `{notifications: {…, ntfy: true}}`.

### Task U: Settings page — Backups (placeholder shell for phase 9) (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/BackupsPage.tsx` (+ test per harness rule).

- [ ] Layout matching the final design: header row with "Back up now" primary button (disabled, tooltip "Backups ship in phase 9"), retention note ("Nightly snapshots, 14 kept — configurable via `OPENDOIST_BACKUP_RETENTION`"), and a backups table (Name / Size / Date / actions Download·Restore). Data: try `GET /api/v1/backups` at mount (AS-BUILT CHECK at runtime); on 404 render the empty-state card "No backups yet — automatic nightly backups arrive in phase 9" with the docs blurb about `/data/backups` and the optional Litestream sidecar. No fabricated rows.
- [ ] Verify: typecheck+lint; unit test: 404 → placeholder state renders.

### Task V: Settings page — Integrations (API tokens, Developer, calendar feed) (parallel)

**Files:** Replace `apps/web/src/features/settings/pages/IntegrationsPage.tsx`; Create `apps/web/src/features/settings/pages/TokenCreateDialog.tsx` (+ test per harness rule).

**Interfaces:** Consumes `listTokens/createToken/revokeToken` from `phase5.ts`, `ui.tsx`.

- [ ] **API tokens** section: table (Name / Scope badge / `start…` monospace hint / Created / Last used / Revoke). "Create token" → `TokenCreateDialog`: name input + scope radio (`read` "Read-only" / `read_write` "Read & write") → on create, swap dialog body to the show-once state: full `od_…` token in a monospace copy field, copy button, amber warning "This token is shown only once — store it now", Done button. Revoke → confirm → DELETE → list refresh. Empty state explains Bearer usage: `Authorization: Bearer od_…`.
- [ ] **Developer** section: link rows "API reference (Scalar)" → `/api/v1/docs` (new tab) and "OpenAPI spec" → `/api/v1/openapi.json`; CLI hint row (`opendoist login <url> <token>`).
- [ ] **Calendar feed** section (placeholder): disabled copy field "webcal://… — available when the iCal feed ships (phase 6)" + disabled "Rotate URL" button. AS-BUILT CHECK at runtime: if `GET /api/v1/ical-token` already exists (phase ordering drift), wire it live instead.
- [ ] Verify: typecheck+lint; e2e: create token → value starts `od_`, visible once; after Done the list shows only the hint; revoke removes it; `curl -H "Authorization: Bearer <token>" localhost:7968/api/v1/projects` returns 200 (gate re-checks).

### Task W: Undo system — toast host + reschedule/move/delete coverage (parallel)

**Files:** Replace `apps/web/src/features/undo/UndoHost.tsx`; Edit the phase-4 task-mutation hooks file(s) (AS-BUILT CHECK: grep `useMutation` under the tasks feature — complete/delete/update/move hooks; these files belong to THIS task) (+ tests per harness rule).

**Interfaces:** Consumes `useUndoStore` (frozen), `restoreEntity`, phase-3 routes. Tasks D/F push their own undos through the same store — this task owns the HOST and the task-level wiring only.

- [ ] `UndoHost`: bottom-left toast (surface-overlay bg, white text, radius 10px, `--shadow-toast`, z 400): message + **Undo** button + close X; auto-dismiss 10 s (pause on hover); a new push replaces the current toast (single-slot, matching Todoist); `runUndo` errors surface as a follow-up error toast. Keyboard: `mod+z` triggers `runUndo` when a toast is visible (register inside UndoHost, not the global map).
- [ ] Wire pushes into task mutations (idempotent — AS-BUILT CHECK: if phase 4 already shows an undo toast for complete/delete, migrate it onto `useUndoStore` so there is ONE system):
  - complete → "Task completed" / undo = reopen route; recurring complete undo = reopen + PATCH the due back to the pre-advance `due` captured before mutating.
  - delete task → "Task deleted" / undo = `restoreEntity('tasks', id)`.
  - reschedule (any due change from scheduler/drag/Quick edit) → "Rescheduled to {date|'no date'}" / undo = PATCH the FULL previous due object (`{date,time,string,recurrence}` or null) captured from the cache before optimistic update.
  - move (project/section change) → "Moved to {projectName}" / undo = PATCH previous `project_id`+`section_id` (+ previous `child_order` if the API accepts it — AS-BUILT CHECK).
- [ ] After every undo, invalidate the affected query keys (`['tasks',…]`, `['projects']`, `['sections']`) so views converge.
- [ ] Verify: typecheck+lint; unit test store semantics (replace-on-push, dismiss clears); e2e: reschedule a task tomorrow→today, Undo restores tomorrow; move between projects and Undo; delete a section and Undo restores its tasks.

---

### Task X: Integration gate (SEQUENTIAL — after B–W)

**Files:** may touch anything needed to make the gate pass (smallest possible diffs); applies the one-line wirings recorded by tasks that hit the cross-task file rule; removes any leftover stub comments.

- [ ] **Step 1:** `pnpm install` ONLY if any manifest changed, then `pnpm verify` (lint + typecheck + test + build) → green. Fix failures with minimal diffs; record every fix.
- [ ] **Step 2:** Boot the stack (server on **7968** serving the built SPA or dev proxy per phase-4 setup) and run the Playwright suite including `apps/web/e2e/phase5/**` → green.
- [ ] **Step 3:** Phase-specific end-to-end checklist (each verified against the running app; use the CLI-less curl checks where noted):
  - Filter lifecycle: create filter `(today | overdue) & #Inbox, view all & !#Inbox` via dialog — live validation flags a broken query (`today &`) with position, valid query shows per-pane counts; saved filter renders **two side-by-side panes**; favorite → appears in sidebar Favorites; drag-reorder persists after reload.
  - Labels: create/edit/delete with palette colors; label view lists tagged tasks; favorites in sidebar.
  - Display menu: group-by priority in Today persists across reload (`curl .../api/v1/user/settings | jq '.viewPrefs.today.groupBy'` → `"priority"`); show-completed renders completed rows; reset returns defaults.
  - Search: palette finds a task by a word in its description AND by a word only in a comment; `search: <word>` filter query matches client-side.
  - Reporting: activity feed day-groups today's CRUD; type/project/date filters narrow; completed tab lists completions; pagination works past 50 events.
  - Settings: all 11 pages render (About included — version line from `/info`; no Suspense crash), search-within-settings jumps, General changes retune Quick Add parsing (smart-date off test), theme card switch + auto-dark both directions, sidebar toggles hide/show items, quick-add chips reorder reflects in composer, token create shows `od_…` once and authorizes a curl Bearer request, danger-zone flows behind confirmations.
  - Undo: complete / delete task / reschedule / move / delete section / archive+delete project each show one toast whose Undo restores exact prior state (verify due `string` restored for recurring reschedule).
  - Keyboard: `g>v`, `g>a`, `o>s`, `o>t` navigate; `?` overlay lists them.
  - `GET /api/v1/openapi.json` documents activities/completed/tokens/search/restore routes; Scalar renders at `/api/v1/docs`.
- [ ] **Step 4:** a11y smoke (axe) on Filters & Labels, Reporting, Settings/Theme — no new critical violations.
- [ ] **Step 5:** Do not commit — report ready-for-checkpoint with the full fix log.

## Self-Review (done)

- Spec coverage: §2.4 filter language UI + panes (D/E/G), Display menu + persistence (H + settings.viewPrefs), FTS palette search (B/I), undo (W, plus D/F pushes); §2.5 reporting (B/K) and all eleven settings pages — ten as separate tasks (M–V) plus the Task-A About page (completed by phase 9 Task N) — with shell/search (L); project/label CRUD dialogs + 20-color palette (E/F + frozen ColorPicker); build-order phase-5 line fully decomposed. Deliberately deferred per spec: karma math/charts (phase 9), channel config + ical token (phase 6), backups actions (phase 9) — pages ship as wired placeholders exactly as scoped.
- Parallel safety: 22 parallel tasks with disjoint Files lists; every shared surface (registry, stores, hooks, ColorPicker, ui primitives, api client) is frozen complete in Task A; cross-phase-4 file edits are assigned to exactly one task each (H = view headers, I = palette, J = sidebar+keyboard, M = auth client, N = parse-context hook, O = theme application, Q = composer chips, W = task mutations), with a fallback rule when claims collide.
- Drift management: phase 3/4 plans were authored concurrently — every dependency on their output carries an AS-BUILT CHECK (settings router shape called out in A/B as required by the phase brief; router idiom, fetch helper, activity table, api-key prefix, undo/palette/sidebar file paths, reopen/restore route names).
- Placeholder scan: all Task A stubs are explicitly replaced wholesale by named tasks; no TBDs remain; verify steps carry expected observable outcomes.
