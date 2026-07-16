# OpenDoist Phase 4: Web Shell (Layout, Quick Add UI, Views, Keyboard) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via a Workflow: Task A first (sequential), Tasks B–Q in parallel (disjoint file sets, no commits, no `pnpm install`), Task R integrates.** Commits happen at integration checkpoints, not per-task, because tasks run concurrently in one working tree. Implementation agents run as Opus; integration/review agents as Fable.

**Goal:** `apps/web` becomes the real OpenDoist SPA: login/register, Todoist-parity app layout (sidebar 280px resizable / topbar / 800px content), typed API client with optimistic mutations + SSE invalidation, task list components per the dossier §2.9 cheatsheet, Quick Add with live token highlighting, task detail, Inbox/Today/Upcoming/Project/Label views, the full keyboard map + `?` overlay, ⌘K palette, 10 s undo toasts, and Playwright coverage of the core flows. Token showcase survives at `/dev/tokens`.

**Architecture:** All new contracts (DTO zod schemas, API client, query-key map, hook signatures, zustand stores, shared component props, route tree) are frozen in Task A. Parallel tasks implement against them and REPLACE stub files wholesale — they never edit Task A's files. Views fetch nothing view-specific: `useActiveTasks()` loads all non-completed tasks into one cache entry; each view derives its slice client-side with pure selectors (single-user app, small data — this kills server-param drift and makes optimistic updates one-cache simple; server-side filter queries arrive in phase 5). Client parsing/highlighting uses `@opendoist/core` `parseQuickAdd`; the server re-parses authoritatively on `POST /tasks/quick`.

**Tech Stack:** Vite 8 + React 19 · TanStack Router (code-based routes — no codegen file to race on) · TanStack Query 5 · Zustand 5 · shadcn/ui on Base UI (added via CLI, owned in-repo) · Tailwind 4 tokens from phase 1 · dnd-kit (behind `@/lib/dnd`) · cmdk · react-hotkeys-hook 5 (`'g>t'` sequences) · rich-textarea · lucide-react · better-auth React client · Playwright + @axe-core/playwright.

**Reference documents (read before your task):**
- Spec: `docs/superpowers/specs/2026-07-15-opendoist-design.md` (§2.3–2.4, §3.3, §4)
- Dossier: `docs/superpowers/research/2026-07-15-opendoist-research.md` (§1.6 shortcuts, §1.8 views, §2 all visual specs, §2.9 component rules, §3.4 frontend libs)
- Frozen core contract: `packages/core/src/types.ts` (authoritative; import types from `@opendoist/core`, never redeclare)

## Global Constraints

- Priorities stored **1 = highest (p1) … 4 = default** — everywhere, including keyboard keys `1`–`4`.
- Server: **port 7968**, env prefix `OPENDOIST_`, API tokens prefix `od_`, REST at `/api/v1/*`, SSE at `/api/v1/events`, better-auth under `/api/auth/*`, problem-JSON errors, cursor pagination `{results, next_cursor}`.
- Design: radii **5px and 10px only** (`rounded-sm`/`rounded-lg`); Kale `#4c7a45` default accent; **focus ring always blue `#1f60c2`** (`:focus-visible` only, never the accent); type scale 12/13/14/16/20/24/32, medium = 600; 4px grid; sidebar 280px (210–420); content `max-width: var(--content-max)` (800px); task row ~42px; motion 150–300 ms `var(--ease-standard)`, respect `prefers-reduced-motion`. Style ONLY with `tokens.css` utilities/vars (`--od-*`, `--color-*` bridges) — no hex literals in components. Icons: lucide-react only; 16 inline / 18 row-actions / 20 toolbar / 24 nav; `strokeWidth={1.75}` at 20–24; icon color `text-text-secondary`, hover `text-text-primary`, accent only for active nav.
- Component rules cheatsheet (dossier §2.9, mirrored in `CONTRIBUTING.md`) is law; deviations require editing the cheatsheet in the same PR.
- TypeScript strict, no `any` (Biome `noExplicitAny: error`), `verbatimModuleSyntax`. Biome formatting (single quotes, semicolons as-needed). Unit tests colocated `src/**/*.test.ts(x)`, Vitest, node environment (test pure logic, not DOM).
- **Parallel-execution rules:** builders touch ONLY their listed files; never run `pnpm install`/`pnpm add` (Task A declares all deps and installs once); never `git commit`; never start dev servers or run `vite build`/Playwright (shared ports + `dist/` races — Task A and Gate R only). Parallel verify = `pnpm --filter @opendoist/web typecheck` + `pnpm --filter @opendoist/web test`; typecheck may transiently fail in files owned by other in-flight tasks — your gate is zero errors in files YOU own; Gate R enforces global green.
- Every stub Task A creates carries the comment `// PHASE4-STUB: replaced by Task <X>`. Replacing tasks must delete the marker. Gate R greps for leftovers.
- If a catalog version fails to resolve, set it to the latest published (`pnpm view <pkg> version`) and record the change in your result notes.
- **AS-BUILT rule:** phase 3's server is as-built and may drift from spec §3.2. Task A reconciles all endpoint paths/casing against the live OpenAPI document and freezes the result in `schemas.ts`/`client.ts`. Parallel tasks' `AS-BUILT CHECK` bullets are verification-only: confirm via curl; if reality differs from the frozen client map, do NOT edit Task A's files — implement against the frozen map and record the discrepancy in your result notes for Gate R to fix centrally.

---

### Task A: Deps, shadcn primitives, API contract, stores, router skeleton (SEQUENTIAL — everything depends on this)

**Files:**
- Edit: `pnpm-workspace.yaml` (catalog additions), `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/styles/tokens.css` (shadcn bridge only — never touch existing token blocks), `apps/web/src/main.tsx`
- Create: `apps/web/components.json`, `apps/web/vitest.config.ts`, `apps/web/src/components/ui/*` (shadcn-generated, then frozen), `apps/web/src/lib/utils.ts`, `apps/web/src/lib/theme.ts`, `apps/web/src/lib/dnd.tsx`, `apps/web/src/lib/format-date.ts` (+`.test.ts`), `apps/web/src/lib/derive.ts` (+`.test.ts`), `apps/web/src/lib/parse-context.ts`
- Create: `apps/web/src/api/schemas.ts`, `apps/web/src/api/client.ts`, `apps/web/src/api/keys.ts`, `apps/web/src/api/hooks/{tasks,projects,sections,labels,comments,user,info}.ts` (minimal bodies), `apps/web/src/api/sse.ts` (stub)
- Create: `apps/web/src/stores/{ui,selection,undo,toasts}.ts` (complete)
- Create: `apps/web/src/router.tsx`, `apps/web/src/components/view-header.tsx`, `apps/web/src/auth/client.ts`
- Move: `apps/web/src/App.tsx` → `apps/web/src/dev/token-showcase.tsx` (rename component `TokenShowcase`, keep content; delete `App.tsx`)
- Create stubs (each a few lines rendering `null` or a placeholder `<div>`, marked `PHASE4-STUB`): `apps/web/src/app/layout.tsx` · `apps/web/src/auth/{login-page,register-page}.tsx` · `apps/web/src/views/{inbox,today,upcoming,project,label}/index.tsx` · `apps/web/src/components/task/{task-list,row-popovers,multi-select-toolbar}.tsx` · `apps/web/src/components/quick-add/{quick-add-dialog,inline-add}.tsx` · `apps/web/src/components/task-detail/task-detail-dialog.tsx` · `apps/web/src/keyboard/index.tsx` · `apps/web/src/components/palette/command-palette.tsx` · `apps/web/src/components/toast/toaster.tsx`

- [ ] **Step 1: Catalog + manifests.** Append to `pnpm-workspace.yaml` catalog (keep existing entries): `'@tanstack/react-router': ^1.130.0`, `'@tanstack/react-query': ^5.101.2`, `zustand: ^5.0.14`, `'@dnd-kit/core': ^6.3.1`, `'@dnd-kit/sortable': ^10.0.0`, `'@dnd-kit/utilities': ^3.2.2`, `cmdk: ^1.1.1`, `'react-hotkeys-hook': ^5.3.3`, `'rich-textarea': ^0.27.1`, `'lucide-react': ^0.525.0`, `'better-auth': ^1.6.23`, `'@base-ui/react': ^1.6.0`, `'class-variance-authority': ^0.7.1`, `clsx: ^2.1.1`, `'tailwind-merge': ^3.3.0`, `'@playwright/test': ^1.61.1`, `'@axe-core/playwright': ^4.10.2`. Add to `apps/web/package.json` dependencies: all of the above except playwright/axe (devDeps) — plus `date-fns: catalog:`, `zod: catalog:`; devDependencies add `vitest: catalog:`, `'@playwright/test': catalog:`, `'@axe-core/playwright': catalog:`; scripts become `"test": "vitest run"`, `"test:e2e": "playwright test"` (config file arrives in Task Q). `apps/web/tsconfig.json`: add `"baseUrl": ".", "paths": { "@/*": ["./src/*"] }` and `"include": ["src", "e2e", "playwright.config.ts"]`. `vite.config.ts`: add `resolve: { alias: { '@': '/src' } }` (use `fileURLToPath(new URL('./src', import.meta.url))`) and `server: { proxy: { '/api': 'http://localhost:7968' } }`. `vitest.config.ts`: include `src/**/*.test.{ts,tsx}`, environment `node`. `index.html`: title → `OpenDoist` (keep the theme head script verbatim).
- [ ] **Step 2: AS-BUILT reconciliation (do this before freezing schemas).** Start the phase-3 server once: `pnpm --filter @opendoist/server dev` (if the package or script name differs, find it via `ls apps/` + its package.json and record it). Then `curl -s localhost:7968/api/v1/openapi.json | python3 -m json.tool | head -200` and inspect: (a) exact paths for tasks/projects/sections/labels/comments/quick/close/reopen/move/events/info/user; (b) JSON field casing (spec says Todoist-style `snake_case` — if the server emits camelCase, adjust every schema below accordingly); (c) whether task list returns soft-deleted/completed tasks and which query param excludes them; (d) the better-auth base path (`/api/auth` expected — check server source `apps/server/src`); (e) `GET /api/v1/info` response shape (version, auth providers, registration flag); (f) the update verb (`PATCH` vs `POST`) on tasks/projects/sections/labels. Freeze what you find into Steps 3–4. Kill the server afterwards.
- [ ] **Step 3: `src/api/schemas.ts` (frozen contract — adjust ONLY per Step 2 findings, then verbatim):**

```ts
import { DueSchema, PrioritySchema } from '@opendoist/core'
import { z } from 'zod'

export const TaskSchema = z.object({
  id: z.string(), project_id: z.string(), section_id: z.string().nullable(),
  parent_id: z.string().nullable(), child_order: z.number().int(), day_order: z.number().int(),
  content: z.string(), description: z.string(), priority: PrioritySchema,
  due: DueSchema.nullable(), deadline_date: z.string().nullable(),
  duration_min: z.number().int().nullable(), labels: z.array(z.string()),
  is_collapsed: z.boolean(), uncompletable: z.boolean(),
  completed_at: z.string().nullable(), created_at: z.string(), updated_at: z.string(),
})
export type Task = z.infer<typeof TaskSchema>

export const ProjectSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), color: z.string(),
  parent_id: z.string().nullable(), child_order: z.number().int(),
  is_favorite: z.boolean(), is_archived: z.boolean(), is_collapsed: z.boolean(),
  is_inbox: z.boolean(),
})
export type Project = z.infer<typeof ProjectSchema>

export const SectionSchema = z.object({
  id: z.string(), project_id: z.string(), name: z.string(),
  section_order: z.number().int(), is_archived: z.boolean(), is_collapsed: z.boolean(),
})
export type Section = z.infer<typeof SectionSchema>

export const LabelSchema = z.object({
  id: z.string(), name: z.string(), color: z.string(),
  item_order: z.number().int(), is_favorite: z.boolean(),
})
export type Label = z.infer<typeof LabelSchema>

export const CommentSchema = z.object({
  id: z.string(), task_id: z.string(), content: z.string(),
  attachment: z.unknown().nullable(), created_at: z.string(),
})
export type Comment = z.infer<typeof CommentSchema>

/** Canonical camelCase user-settings document served by GET /user/settings (phase 3 Task A
 *  Step 10 `SettingsSchema` — the one deliberate non-snake_case wire shape). Parse the subset
 *  this phase consumes; `.partial().passthrough()` tolerates the full document. */
export const UserSettingsSchema = z.object({
  timezone: z.string(), weekStart: z.number().int(), nextWeekDay: z.number().int(),
  weekendDay: z.number().int(), smartDate: z.boolean(),
  timeFormat: z.enum(['12h', '24h']), dateFormat: z.enum(['MDY', 'DMY']),
  homeView: z.string(),
}).partial().passthrough()
export type UserSettings = z.infer<typeof UserSettingsSchema>
/** GET /user returns NO settings field — settings live at GET /user/settings. */
export const UserSchema = z.object({
  id: z.string(), name: z.string(), email: z.string(),
  two_factor_enabled: z.boolean().optional(), created_at: z.string().optional(),
}).passthrough()
export type User = z.infer<typeof UserSchema>

/** Exact shape of phase 3's InfoDto (GET /api/v1/info). */
export const InfoSchema = z.object({
  version: z.string(),
  first_run: z.boolean(),
  registration_open: z.boolean(),
  auth_providers: z.object({ password: z.boolean(), oidc: z.object({ name: z.string() }).nullable() }),
  features: z.object({ stt: z.boolean(), llm: z.boolean(), push: z.boolean() }).partial().passthrough(),
  available_importers: z.array(z.string()).default([]),
}).passthrough() // passthrough: phase 9 adds `update`
export type Info = z.infer<typeof InfoSchema>

export const SseEventSchema = z.object({
  type: z.string(),
  /** MUST mirror phase 3's ServerEvent entity union (apps/server/src/events/bus.ts) — events whose
   *  entity is outside this enum fail safeParse and are silently dropped. Phase 6 widens BOTH lists
   *  with 'reminders' | 'push_subscriptions' | 'notification_channels'. */
  entity: z.enum(['task', 'project', 'section', 'label', 'filter', 'comment', 'settings']),
  ids: z.array(z.string()),
})
export type SseEvent = z.infer<typeof SseEventSchema>

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ results: z.array(item), next_cursor: z.string().nullable() })
}

import type { Due, Priority } from '@opendoist/core'
export interface TaskCreate {
  content: string; description?: string; project_id?: string; section_id?: string | null
  parent_id?: string | null; priority?: Priority; due?: Due | null; deadline_date?: string | null
  duration_min?: number | null; labels?: string[]; uncompletable?: boolean
}
export type TaskPatch = Partial<TaskCreate> & {
  day_order?: number; child_order?: number; is_collapsed?: boolean
}
export interface TaskMove {
  project_id?: string; section_id?: string | null; parent_id?: string | null; child_order?: number
}
```

- [ ] **Step 4: `src/api/client.ts` + `src/api/keys.ts` (frozen).** `client.ts`:

```ts
import type { z } from 'zod'
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly problem: { title?: string; detail?: string } & Record<string, unknown>) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`)
    this.name = 'ApiError'
  }
}
const BASE = '/api/v1'
export async function api<T>(path: string, opts: { method?: string; body?: unknown; schema: z.ZodType<T> }): Promise<T>
export async function apiVoid(path: string, opts?: { method?: string; body?: unknown }): Promise<void>
/** follows next_cursor (limit=200) until exhausted, concatenating results */
export async function apiAllPages<T>(path: string, item: z.ZodType<T>): Promise<T[]>
/** single source of truth for every server path this phase touches — reconcile HERE per AS-BUILT */
export const endpoints = {
  tasks: '/tasks', task: (id: string) => `/tasks/${id}`,
  quick: '/tasks/quick', close: (id: string) => `/tasks/${id}/close`,
  reopen: (id: string) => `/tasks/${id}/reopen`, move: (id: string) => `/tasks/${id}/move`,
  projects: '/projects', project: (id: string) => `/projects/${id}`,
  sections: '/sections', section: (id: string) => `/sections/${id}`,
  labels: '/labels', label: (id: string) => `/labels/${id}`,
  comments: (taskId: string) => `/comments?task_id=${taskId}`, comment: (id: string) => `/comments/${id}`,
  user: '/user', userSettings: '/user/settings', info: '/info',
  /** absolute — consumed by `new EventSource(endpoints.events)`, never by api() */
  events: '/api/v1/events',
  search: (q: string) => `/search?q=${encodeURIComponent(q)}`,
} as const
```

Reference implementation of the core function (verbatim; `apiVoid`/`apiAllPages` follow the same shape):

```ts
export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; schema: z.ZodType<T> },
): Promise<T> {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (!res.ok) {
    const problem = await res.json().catch(() => ({ title: res.statusText }))
    throw new ApiError(res.status, problem as ConstructorParameters<typeof ApiError>[1])
  }
  return opts.schema.parse(await res.json())
}
```

`apiAllPages`: loop `api(path + '?limit=200&cursor=' + cursor, { schema: paginated(item) })` until `next_cursor === null`, concatenating `results` (first request omits `cursor`; use `&` when `path` already contains `?`). `keys.ts`: `export const qk = { tasks: ['tasks'] as const, projects: ['projects'] as const, sections: ['sections'] as const, labels: ['labels'] as const, user: ['user'] as const, userSettings: ['user-settings'] as const, info: ['info'] as const, comments: (taskId: string) => ['comments', taskId] as const }` (`['user-settings']` is the exact key phase 5's `useUserSettings` reuses).
- [ ] **Step 5: Hook modules with frozen signatures + minimal working bodies** (Task B replaces `tasks.ts` + `sse.ts` wholesale; other files keep A's bodies unless B notes otherwise). Every mutation body in A: `useMutation({ mutationFn, onSettled: () => qc.invalidateQueries({ queryKey: qk.<entity> }) })`. Canonical minimal module — `hooks/labels.ts` verbatim; write the others in exactly this shape:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiAllPages, apiVoid, endpoints, type ApiError } from '../client'
import { qk } from '../keys'
import { LabelSchema, type Label } from '../schemas'

export function useLabels() {
  return useQuery<Label[], ApiError>({
    queryKey: qk.labels,
    queryFn: () => apiAllPages(endpoints.labels, LabelSchema),
  })
}

export function useLabelMutations() {
  const qc = useQueryClient()
  const settled = { onSettled: () => qc.invalidateQueries({ queryKey: qk.labels }) }
  return {
    create: useMutation<Label, ApiError, { name: string; color?: string }>({
      mutationFn: (input) => api(endpoints.labels, { method: 'POST', body: input, schema: LabelSchema }),
      ...settled,
    }),
    update: useMutation<Label, ApiError, { id: string; patch: Partial<Pick<Label, 'name' | 'color' | 'is_favorite'>> }>({
      mutationFn: ({ id, patch }) => api(endpoints.label(id), { method: 'PATCH', body: patch, schema: LabelSchema }),
      ...settled,
    }),
    remove: useMutation<void, ApiError, { id: string }>({
      mutationFn: ({ id }) => apiVoid(endpoints.label(id), { method: 'DELETE' }),
      ...settled,
    }),
  }
}
```

(**AS-BUILT CHECK** inside Step 2 already fixed the update verb — if the server uses `POST` for updates, change `'PATCH'` consistently across all hook modules now.) Frozen exports:

```ts
// hooks/tasks.ts
export function useActiveTasks(): UseQueryResult<Task[], ApiError>          // apiAllPages(endpoints.tasks, TaskSchema)
export interface TaskMutations {
  quickAdd: UseMutationResult<unknown, ApiError, { text: string }>          // POST endpoints.quick {text}
  create: UseMutationResult<Task, ApiError, TaskCreate>
  update: UseMutationResult<Task, ApiError, { id: string; patch: TaskPatch; silent?: boolean }>
  close: UseMutationResult<void, ApiError, { id: string; silent?: boolean; complete_series?: boolean }> // complete_series → POST close body
  reopen: UseMutationResult<void, ApiError, { id: string }>
  remove: UseMutationResult<void, ApiError, { id: string; silent?: boolean }>
  move: UseMutationResult<void, ApiError, { id: string; to: TaskMove; silent?: boolean }>
}
export function useTaskMutations(): TaskMutations
// hooks/projects.ts — useProjects(): UseQueryResult<Project[], ApiError>;
//   useProjectMutations(): { create(input: {name: string; color?: string; parent_id?: string | null}) → Project; update({id, patch: Partial<Pick<Project,'name'|'color'|'is_favorite'|'is_collapsed'>>}); remove({id}) }
// hooks/sections.ts — useSections(): UseQueryResult<Section[], ApiError> (ALL sections);
//   useSectionMutations(): { create({project_id, name}); update({id, patch}); remove({id}) }
// hooks/labels.ts — useLabels(): UseQueryResult<Label[], ApiError>; useLabelMutations(): { create({name, color?}); update({id, patch}); remove({id}) }
// hooks/comments.ts — useComments(taskId: string); useCommentMutations(taskId): { create({content}); remove({id}) }
// hooks/user.ts — useUser(): UseQueryResult<User, ApiError>;
//   useUserSettings(): UseQueryResult<UserSettings, ApiError>   // api(endpoints.userSettings, { schema: UserSettingsSchema }), key qk.userSettings, staleTime 30_000
// hooks/info.ts — useInfo(): UseQueryResult<Info, ApiError> (staleTime: Infinity, retry: false)
// sse.ts — export function useSseInvalidation(): void   // A: empty body, PHASE4-STUB
```

- [ ] **Step 6: Zustand stores (complete code in A, no stubs).** `stores/ui.ts`: `{ sidebarCollapsed: boolean; sidebarWidth: number (persist both to localStorage 'od-sidebar'); quickAddOpen: boolean; paletteOpen: boolean; shortcutOverlayOpen: boolean; activeRowPopover: { taskId: string; kind: 'schedule' | 'priority' | 'move' | 'labels' | 'more' } | null; detailCommentFocus: boolean; toggleSidebar(); setSidebarWidth(px: number) (clamp 210–420); setQuickAddOpen(v); setPaletteOpen(v); setShortcutOverlayOpen(v); openRowPopover(taskId, kind); closeRowPopover(); setDetailCommentFocus(v) }`. `stores/selection.ts`: `{ visibleIds: string[]; focusedId: string | null; selectedIds: ReadonlySet<string>; setVisibleIds(ids: string[]) (drop focus/selection of ids no longer visible); focusNext(); focusPrev(); setFocused(id | null); toggleSelected(id); rangeSelectTo(id) (from focusedId through visible order); clearSelection() }`. `stores/toasts.ts`: `{ toasts: { id: string; kind: 'info' | 'error'; message: string }[]; ... }` plus module-level `export const toast = { info(msg), error(msg) }` helpers (auto-dismiss info 5 s, error 8 s). `stores/undo.ts` verbatim (the 10 s inverse-op contract for Tasks B and P):

```ts
import { create } from 'zustand'
import { toast } from './toasts'

export interface UndoEntry {
  id: string
  label: string
  /** epoch ms when the entry disappears (10 s after push) */
  expiresAt: number
  run: () => Promise<void>
}

interface UndoState {
  entries: UndoEntry[]
  push: (label: string, run: () => Promise<void>) => void
  dismiss: (id: string) => void
  undo: (id: string) => void
}

const UNDO_WINDOW_MS = 10_000

export const useUndoStore = create<UndoState>((set, get) => ({
  entries: [],
  push: (label, run) => {
    const id = crypto.randomUUID()
    const entry: UndoEntry = { id, label, expiresAt: Date.now() + UNDO_WINDOW_MS, run }
    set((s) => ({ entries: [...s.entries, entry].slice(-3) }))
    setTimeout(() => get().dismiss(id), UNDO_WINDOW_MS)
  },
  dismiss: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  undo: (id) => {
    const entry = get().entries.find((e) => e.id === id)
    if (!entry) return
    get().dismiss(id)
    entry.run().catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Undo failed')
    })
  },
}))
```
- [ ] **Step 7: Shared lib (complete, tested).** `lib/utils.ts`: `cn` (clsx + tailwind-merge). `lib/theme.ts`: `type ThemeChoice = 'system' | 'kale' | 'todoist' | 'dark' | 'moonstone' | 'tangerine' | 'blueberry' | 'lavender' | 'raspberry'`, `applyTheme(t: ThemeChoice)` (sets/removes `data-theme` + `.system-dark` exactly like the index.html head script, persists `od-theme`), `getTheme(): ThemeChoice`. `lib/dnd.tsx`: the ONLY module allowed to import `@dnd-kit/*`; re-export `DndContext, DragOverlay, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable, SortableContext, verticalListSortingStrategy, useSortable, arrayMove, CSS` plus `useAppSensors()` (PointerSensor with `activationConstraint: { distance: 4 }`). `lib/parse-context.ts`: `buildParseContext(settings: UserSettings | undefined, now = new Date()): ParseContext` — timezone from `settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone`, weekStart/nextWeekDay/weekendDay/smartDate straight off the settings document with `DEFAULT_PARSE_CONTEXT_SETTINGS` fallbacks, `now: now.toISOString()`; and `useParseCtx(): ParseContext` (wraps `useUserSettings()` — server-side timezone/weekStart/nextWeekDay/weekendDay and the smart-date toggle drive parsing; browser values are fallbacks only, never the source of truth). `lib/format-date.ts` (signature + behavior table, implement + `test.each`): `formatDueChip(due: { date: string; time: string | null }, todayIso: string): { label: string; tone: 'overdue' | 'today' | 'tomorrow' | 'week' | 'weekend' | 'nextweek' | 'future' }` — date < today → tone overdue, label `Jul 2`-style (add year if ≠ current); today → `Today`; +1 → `Tomorrow`; within next 7 days → weekday name (`Friday`), tone weekend if ISO weekday 6/7 else week; 8–14 days → tone nextweek label `Mon, Jul 27`; else future `Jul 30`; append time ` 16:00`→`4pm`-style when `time` non-null. Tone→CSS var map exported (**frozen**, per dossier §2.7 date colors): `DUE_TONE_VAR: Record<tone, string>` = overdue→`--od-date-overdue`, today→`--od-date-today`, tomorrow→`--od-date-tomorrow`, weekend→`--od-date-weekend`, nextweek→`--od-date-next-week`, week→`--od-text-secondary` (weekday-this-week has no own Todoist color), future→`--od-text-secondary`. `lib/derive.ts` (pure selectors over `Task[]`, all tested): `activeTasks(tasks)` (completed_at null), `tasksInProject(tasks, projectId)`, `tasksWithLabel(tasks, name)`, `dueOn(tasks, dateIso)`, `overdue(tasks, todayIso)` (dueDate < today), `inboxCount(tasks, inboxProjectId)`, `todayCount(tasks, todayIso)` (dueOn + overdue), `byChildOrder`, `byDayOrder`, `subtreeOf(tasks, parentId)`, `topLevel(tasks)` (parent_id null), `buildTaskTree(tasks): Array<{ task: Task; depth: number }>` (DFS by child_order, respecting `is_collapsed` — collapsed nodes emit but skip descendants).
- [ ] **Step 8: shadcn/ui.** Write `apps/web/components.json`: `{ "style": "default", "rsc": false, "tsx": true, "tailwind": { "config": "", "css": "src/styles/tokens.css", "baseColor": "neutral", "cssVariables": true }, "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" } }`. Run `pnpm dlx shadcn@latest add button dialog dropdown-menu popover tooltip command input scroll-area separator skeleton switch` (July 2026 CLI defaults to Base UI; accept). Then: (1) in `tokens.css`, the CLI appends `:root`/`.dark` var blocks + an `@theme inline` block — KEEP the `@theme inline` block, DELETE the `.dark` block entirely, and replace the appended `:root` values with this bridge so shadcn primitives follow the active OpenDoist theme: `--background: var(--od-bg); --foreground: var(--od-text-primary); --card/--popover: var(--od-surface-raised) (+ -foreground: var(--od-text-primary)); --primary: var(--od-accent); --primary-foreground: var(--od-on-accent); --secondary/--muted/--accent: var(--od-hover); --secondary-foreground/--accent-foreground: var(--od-text-primary); --muted-foreground: var(--od-text-secondary); --destructive: var(--od-danger); --border: var(--od-border); --input: var(--od-input-border); --ring: var(--od-focus-ring); --radius: 10px;`. (2) Restyle pass over `src/components/ui/*`: buttons/inputs/menu-items/rows `rounded-sm` (5px), dialogs/dropdowns/popovers/command `rounded-lg` (10px); button heights h-8 default (h-7 sm / h-9 lg), font 13px weight 600; focus styles must use `outline-2 outline-[var(--od-focus-ring)] outline-offset-2` on `:focus-visible` (remove any accent ring classes); dialog shadow `[box-shadow:var(--shadow-dialog)]`, menus `[box-shadow:var(--shadow-menu)]`. If the registry is unreachable, hand-write the same components on `@base-ui/react` + `cmdk` per dossier §2.9 (same file names/exports as shadcn). These files are then FROZEN — later tasks import, never edit.
- [ ] **Step 9: Router + entry + placeholders.** `src/auth/client.ts`: `import { createAuthClient } from 'better-auth/react'; import { genericOAuthClient } from 'better-auth/client/plugins'; export const authClient = createAuthClient({ baseURL: '/api/auth', plugins: [genericOAuthClient()] })` (phase 3 wires OIDC through better-auth's genericOAuth plugin — the client plugin provides `authClient.signIn.oauth2`; adjust basePath per Step 2d). `src/router.tsx` (code-based; complete): root route renders `<Outlet/>`; `/login`, `/register` → auth pages; pathless layout route `app` with `beforeLoad` guard (`const { data } = await authClient.getSession(); if (!data?.session) throw redirect({ to: '/login' })`), `validateSearch: z.object({ task: z.string().optional() })`, component `AppLayout` (from `@/app/layout`); children: `/` (redirect `/today`), `/inbox`, `/today`, `/upcoming`, `/project/$projectId`, `/label/$labelName`, and `/task/$taskId` — the CANONICAL task deep link (phase 6 notification payloads and phase 8 `opendoist open` build `${origin}/task/<id>`): its `beforeLoad` throws `redirect({ to: '/today', search: { task: params.taskId } })` so the app opens with the task-detail dialog; plus top-level `/dev/tokens` → `TokenShowcase`. Export `router` (createRouter with `context: { queryClient }`) + `declare module '@tanstack/react-router' { interface Register { router: typeof router } }`. `src/main.tsx`: `QueryClientProvider` (defaults: `staleTime: 30_000, retry: 1, refetchOnWindowFocus: true`) + `RouterProvider`. `src/components/view-header.tsx` (complete, frozen): `ViewHeader({ title, subtitle?, actions?: ReactNode })` — `text-header` (20px) weight 700 title row inside the 800px column, `pt-8 pb-4`. Every stub listed in Files renders enough to mount (e.g. views render `<ViewHeader title="Today"/>`), marked `PHASE4-STUB`.
- [ ] **Step 10: Install & gate.** `cd /Users/pranav/developer/opendoist && pnpm install` → then `pnpm exec playwright install chromium` (from repo root; downloads browser for Task Q/R). Verify, with expected outcomes:
  - `pnpm --filter @opendoist/web typecheck` → exits 0, no output.
  - `pnpm --filter @opendoist/web test` → all `format-date.test.ts` + `derive.test.ts` cases pass (≥20 tests total, `Test Files 2 passed`).
  - `pnpm --filter @opendoist/web build` → `vite build` completes; note the emitted bundle so R can compare.
  - `pnpm lint` → exits 0 (run `pnpm lint:fix` first for formatting trivia).
  - Smoke: `pnpm --filter @opendoist/web dev` briefly, open `http://localhost:5173/dev/tokens` (showcase renders) and `/login` (stub renders); kill the server. Do NOT commit.

---

### Task B: Query hooks upgrade — optimistic mutations, undo wiring, SSE (PARALLEL)

**Files:** Replace `src/api/hooks/tasks.ts`, `src/api/sse.ts`; Create `src/api/cache-updates.ts`, `src/api/cache-updates.test.ts`.
**Consumes:** Task A's schemas/client/keys/stores (frozen signatures — do not change any export).

- [ ] `cache-updates.ts` — pure functions over `Task[]` (each unit-tested): `applyPatch(tasks, id, patch)`, `applyClose(tasks, id)` (recurring due with `recurrence` non-null → advance via core `nextOccurrence(due.recurrence, { after: { date, time }, ctx })` keeping `string`; else set `completed_at` = now and REMOVE from array), `applyReopen`, `applyRemove(tasks, id)` (drop task + all descendants), `applyMove(tasks, id, to)`, `applyCreate(tasks, task)`. Export `snapshotRollback` helper types.
- [ ] Rewrite `useTaskMutations()`: every mutation gains `onMutate` — `await qc.cancelQueries({queryKey: qk.tasks})`, snapshot `qc.getQueryData<Task[]>(qk.tasks)`, `qc.setQueryData(qk.tasks, applyX(...))`, return `{ prev }`; `onError` — restore snapshot + `toast.error(err.message)`; `onSettled` — invalidate `qk.tasks`. Undo wiring (spec §2.4: complete/delete/reschedule/move): in `onSuccess` when `!vars.silent`, push to undo store — close → `push('Task completed', () => reopenFn(id))`; remove → `push('Task deleted', () => restoreFn())` where restore = **AS-BUILT CHECK:** look for `POST /tasks/:id/restore` (soft-delete) in openapi.json; if absent, recreate via `POST /tasks` from the snapshot task (note: new id); update-with-due-change → `push('Rescheduled', () => updateFn({id, patch: {due: prevDue}, silent: true}))`; move → inverse move with previous `project_id/section_id/parent_id/child_order`. Inverse ops always pass `silent: true`.
- [ ] `sse.ts` — `useSseInvalidation()`: `useEffect` creating `new EventSource('/api/v1/events')`; `onmessage` → `SseEventSchema.safeParse(JSON.parse(e.data))`; on success invalidate by entity map (task→`qk.tasks`, project→`qk.projects`, section→`qk.sections`, label→`qk.labels`, comment→`qk.comments(ids[0])`, settings→`qk.userSettings`; entity `filter` passes validation but has no phase-4 consumer — phase 5 adds the `['filters']` key); ignore parse failures; `onerror` → EventSource auto-reconnects (no code needed); cleanup closes. Debounce invalidations 250 ms per entity (mutations already invalidate; SSE mainly serves multi-tab). **AS-BUILT CHECK:** `curl -N localhost:7968/api/v1/events` (authed session needed — verify event `data:` payload matches `{type, entity, ids}`; adjust `SseEventSchema` is NOT allowed — note discrepancies for Gate R).
- [ ] Verify: `pnpm --filter @opendoist/web test` — cache-updates suite green (≥12 cases incl. recurring close advancing due via a real `every day` spec); typecheck clean in owned files.

### Task C: Auth screens (PARALLEL)

**Files:** Replace `src/auth/login-page.tsx`, `src/auth/register-page.tsx`; Create `src/auth/oidc-buttons.tsx`, `src/auth/auth-shell.tsx`.
**Consumes:** `authClient`, `useInfo`, ui components, router (`useNavigate`).

- [ ] `auth-shell.tsx`: centered card (max-w-[400px], `rounded-lg`, brand icon from `/assets` if present else the name wordmark, h1 32px `text-header-xl`).
- [ ] Login: email + password inputs (h-8, `rounded-sm`), submit → `authClient.signIn.email({ email, password })`; on error render problem detail under the form in `--od-danger` 13px; on success `navigate({ to: '/today' })`. Below: `<OidcButtons/>` — reads `useInfo()`; when `info.auth_providers.oidc` is non-null render ONE secondary button "Continue with {info.auth_providers.oidc.name}" → `authClient.signIn.oauth2({ providerId: 'oidc', callbackURL: '/today' })` (phase 3 registers OIDC via better-auth's genericOAuth plugin under providerId `'oidc'` — a recorded phase-3 deviation from `@better-auth/sso`; the client plugin is wired in Task A Step 9); render nothing when null. Footer link → `/register` shown when top-level `info.registration_open` is true.
- [ ] Register (first-run): name/email/password/confirm → `authClient.signUp.email({ name, email, password })` → auto session → `/today`. If server rejects (registration locked) show the problem detail. Heading: "Create your account" + one-liner "First account becomes the owner."
- [ ] Both pages: labelled inputs (a11y), `autocomplete` attrs, Enter submits, disabled state while pending. Verify: typecheck clean; manual check deferred to R.

### Task D: App layout — sidebar, topbar, theme, counts (PARALLEL)

**Files:** Replace `src/app/layout.tsx`; Create `src/app/{sidebar,topbar,user-menu,theme-menu,sidebar-projects,counts}.tsx|ts`.
**Consumes:** ui store, hooks (projects/tasks/user/info), derive selectors, theme lib, lucide icons, ui primitives.

- [ ] `layout.tsx`: grid `[sidebar auto] [main 1fr]`; mounts (in order) `<Sidebar/>`, main column with `<Topbar/>` + `<main>` (scroll container; children constrained by each view to `max-w-[var(--content-max)] mx-auto px-6`), then portals: `<QuickAddDialog/>`, `<TaskDetailDialog/>`, `<CommandPalette/>`, `<Toaster/>`, `<GlobalHotkeys/>` (from `@/keyboard`), `<MultiSelectToolbar/>`; call `useSseInvalidation()` once here.
- [ ] `sidebar.tsx`: width `var(--sidebar-width)` driven by store `sidebarWidth`; drag handle (4px hit strip on right edge) resizes 210–420, double-click resets 280; collapsed state translates off-canvas (`transition: 300ms var(--ease-standard)`, width 0); bg `bg-surface`. Content: "+ Add task" accent row (opens Quick Add), then nav items Inbox / Today / Upcoming (lucide `Inbox` / `CalendarCheck` / `CalendarDays` — **20px, strokeWidth 1.75** in the 32px rows; the cheatsheet's 24px nav size is for icon rails, not text rows); item: h-8, p-[5px], `rounded-sm`, 14px text, hover `bg-sidebar-hover`, active `bg-selected text-selected-text` + icon accent; right-aligned counts 12px `text-text-tertiary` (`counts.ts`: `useViewCounts()` → `{ inbox, today }` from tasks cache via derive + inbox project id from `useProjects()`).
- [ ] `sidebar-projects.tsx`: sections "Favorites" (favorited projects/labels) and "My Projects": project rows with 12px color dot (`--od-palette-<color>`), nested by parent (indent 16px), collapse chevron persisting `is_collapsed` via project mutations; link `/project/$projectId`. Labels are NOT listed in the sidebar this phase (Filters & Labels view is phase 5) — favorites may include labels → link `/label/$labelName`.
- [ ] `topbar.tsx`: h-11 row: sidebar toggle (lucide `PanelLeft`, 20px, tooltip "M"), spacer, search button (opens palette, shows `⌘K` kbd hint), help `?` button (opens shortcut overlay), `<UserMenu/>` (avatar initial → dropdown: name/email header, "Theme ▸" (`theme-menu.tsx`: 9 options from `lib/theme.ts`, check on active, applies + persists), divider, "Design tokens" → `/dev/tokens`, "Log out" → `authClient.signOut()` then hard navigate `/login`; footer row `v{info.version}` 12px tertiary).
- [ ] Verify: typecheck clean; no hex literals (`grep -nE '#[0-9a-fA-F]{3,6}' src/app/ | grep -v tokens` → empty).

### Task E: Task list core — checkbox, row, list, meta (PARALLEL)

**Files:** Create `src/components/task/{task-checkbox,task-row,task-meta}.tsx`; Replace `src/components/task/task-list.tsx`.
**Consumes:** selection store, ui store, task mutations, format-date, dnd wrapper, `RowPopovers` + `InlineAdd` imports (stubs until F/G land).

- [ ] `task-checkbox.tsx` — props `{ priority: Priority; checked: boolean; uncompletable: boolean; onToggle(): void }`: 24px hit area, 18px circle; P1–P3 `border-2` in `var(--od-p{n})` + fill same color at 10% opacity → 20% on hover (`transition-opacity 150ms ease-in`) + hover shows check glyph preview in priority color; P4 `border` 1px `var(--od-p4)`, no fill; checked = solid priority fill + white check; completing plays `animate-[od-check_250ms_linear]` then calls `onToggle` (listen `onAnimationEnd`); uncompletable → render a 6px dot placeholder, no checkbox, not clickable. `aria-label="Complete task"`, `role="checkbox"`, `aria-checked`, and `data-priority={priority}` on the wrapper (frozen — Playwright asserts it).
- [ ] `task-row.tsx` — props `{ task: Task; showProject?: boolean; depth?: number; sortable?: boolean }`: min-h-[42px], `pl-[5px] pr-[38px] py-2` (+ `depth * 24`px extra left pad), `rounded-sm`, bottom `border-border-subtle`; grid: [collapse-chevron?][checkbox 24px][6px gap][body][hover-actions]. Row element attrs (frozen — keyboard nav and Playwright depend on them): `id={'task-' + task.id}`, `data-focused`, `data-selected`. Body: content 14px `text-text-primary` (completed → line-through `text-text-tertiary`); description first line 13px `text-text-secondary` truncated; meta row 12px `text-text-tertiary` gap-2: due chip (`task-meta.tsx`: `formatDueChip` label + `CalendarDays` 16px icon, color `var(DUE_TONE_VAR[tone])`, recurring adds `Repeat` icon), deadline chip (`Target`/`Flag` 16 + date, `--od-date-overdue` red), duration (`Clock` 16 + `45min`), labels (`Tag` 12px dot-colored chips in label palette color), project breadcrumb right-aligned when `showProject` (name + 12px dot). Hover actions (visible on `group-hover`/row focus only, 18px icons): edit `Pen` (opens detail), schedule `CalendarDays` (opens row popover 'schedule'), more `Ellipsis` (popover 'more'). Row states: `data-focused` (selection store `focusedId === task.id`) → bg `#fafafa`-equivalent `bg-hover/50`… use `bg-hover` + `shadow-[inset_0_0_0_1px_var(--od-row-focus-ring)]`; `data-selected` → `bg-selected`. Click → focus row; Cmd/Ctrl+click → toggleSelected; Shift+click → rangeSelectTo; double-click or click on content → open detail (`navigate(search: {task: id})`). Renders `<RowPopovers taskId={task.id}/>` (Task F) anchored at the actions area, and checkbox `onToggle` → `close.mutate({id})` / `reopen`. Shift+click on a recurring task's checkbox completes the whole series — `close.mutate({ id, complete_series: true })`, which sends body `{ complete_series: true }` on POST /tasks/{id}/close (phase 3 Task C's close route body is `{ complete_series: z.boolean().default(false) }` — no query param). If `sortable`, wrap with `useSortable({ id: task.id })` from `@/lib/dnd` (transform via `CSS.Transform`, drag ghost `shadow-drag`).
- [ ] `task-list.tsx` — props frozen: `{ tasks: Task[]; groupId: string; emptyText?: string; showProject?: boolean; tree?: boolean; sortable?: boolean }`. Renders rows (when `tree`, map `buildTaskTree(tasks)` to depth-ed rows with collapse chevrons toggling `update({patch:{is_collapsed}}, silent)`; else flat top-level order as given); registers its visible ordered ids into the selection store on change — **multiple lists coexist** (Upcoming days): registration merges per `groupId` in DOM order: implement module-level registry `registerVisible(groupId, ids)` that concatenates groups by insertion order then calls `setVisibleIds`; unregister on unmount. Empty state: 13px `text-text-tertiary` italic row. When `sortable`, wrap children in `SortableContext(items=task ids, verticalListSortingStrategy)`.
- [ ] Verify: typecheck clean in owned files; `pnpm --filter @opendoist/web test` still green.

### Task F: Task action surfaces — scheduler, priority, move, labels, more, multi-select (PARALLEL)

**Files:** Replace `src/components/task/row-popovers.tsx`, `src/components/task/multi-select-toolbar.tsx`; Create `src/components/task/{scheduler-popover,priority-menu,move-popover,label-popover,more-menu}.tsx`.
**Consumes:** ui store (`activeRowPopover`), mutations, `useParseCtx`, core `resolveNaturalDate`, hooks (projects/sections/labels).

- [ ] `row-popovers.tsx`: reads `activeRowPopover`; when it targets this taskId renders the matching popover (all `rounded-lg`, `shadow-popover` bg `surface-raised`) controlled-open, `onOpenChange(false)` → `closeRowPopover()`. Export `RowPopovers({ taskId }): ReactElement | null`.
- [ ] `scheduler-popover.tsx`: text input autofocused — value parsed live via `resolveNaturalDate(text, ctx)`, result previewed under input (`Jul 30` chip) — Enter applies `update({id, patch: {due: {date, time, string: text, recurrence: null}}})`; preserve existing recurrence when input parses via core `parseRecurrenceText`? Keep v1: if the phrase starts with `every`, run full `parseQuickAdd(text, ctx)` and take its `due`. Preset rows (with weekday hints right-aligned): Today, Tomorrow, Next week (`nextWeekDay`), Next weekend (`weekendDay`), No date (clears due). Used by both row popover + multi-select + Today's Reschedule.  Export also `SchedulerPanel` (uncontained content) for reuse.
- [ ] `priority-menu.tsx`: 4 items, `Flag` filled 16px in `--od-p{n}` (P4 outline flag tertiary), labels "Priority 1…4", current checked → `update({patch: {priority: n}})`.
- [ ] `move-popover.tsx`: search input + project list (dot + name, sections indented under each project) → `move.mutate({ id, to: { project_id, section_id } })`.
- [ ] `label-popover.tsx`: checkbox list of labels (search + "Create '{q}'" row via label mutations) toggling `update({patch: {labels}})`.
- [ ] `more-menu.tsx` (dropdown): Edit (detail), Add subtask (opens InlineAdd via ui-store? v1: opens detail), Duplicate (`create` from task fields), Copy link (`navigator.clipboard.writeText(location.origin + '/task/' + id)` — the canonical `/task/$taskId` deep-link route from Task A Step 9; toast.info 'Link copied'), divider, Delete (`remove.mutate`) in `--od-danger`.
- [ ] `multi-select-toolbar.tsx`: fixed bottom-center pill (`rounded-lg`, `shadow-toast`, z `var(--z-toast)`) visible when `selectedIds.size > 0`: "{n} selected" + buttons Schedule (SchedulerPanel applying to all), Priority, Move, Complete, Delete, ✕ clear. Bulk ops loop the mutations (first one non-silent for a single undo label "{n} tasks completed" running all inverses — acceptable v1: push one undo entry that loops inverse calls).
- [ ] Verify: typecheck clean in owned files.

### Task G: Quick Add — input, highlighting, chips, dialog, inline add (PARALLEL)

**Files:** Replace `src/components/quick-add/{quick-add-dialog,inline-add}.tsx`; Create `src/components/quick-add/{quick-add-input.tsx,quick-add-model.ts,quick-add-model.test.ts,chip-row.tsx,autocomplete.tsx}`.
**Consumes:** core `parseQuickAdd`/token types, `useParseCtx`, task/project/label mutations + caches, ui store `quickAddOpen`.

- [ ] `quick-add-model.ts` (pure, tested ≥10 cases): `type QuickAddState = { text: string; ignored: Array<{ start: number; end: number; text: string }> }`; `parseState(state, ctx): { parsed: ParsedQuickAdd; activeTokens: QuickAddToken[] }` — run `parseQuickAdd(state.text, ctx)`, drop tokens matching an ignored span (same start + same text), and for dropped tokens recompute the *effective* parsed fields (a due/priority/project… token dropped → field reverts to default; label dropped → removed from labels) and **recompute title locally**: original text minus surviving token spans, whitespace-collapsed; `needsStructuredSubmit(state): boolean` (ignored non-empty); `toCreatePayload(parsed, caches): TaskCreate` (project/section/label names → ids from caches; unknown names returned in `missing: {projects, labels}` for pre-creation).
- [ ] `quick-add-input.tsx`: `rich-textarea` single-line-styled textarea; renderer walks `activeTokens` and wraps each span: `background: color-mix(in srgb, var(--tok) 18%, transparent); border-radius: 3px` with `--tok` per kind — due/duration `--od-date-today`, deadline `--od-date-overdue`, reminder `--od-warning`, project/section `--od-accent`, label `--od-info`, priority `--od-p{n}`, description `--od-text-tertiary`; each span `data-kind` + `title="Click to remove"` and `onClick` → push span into `ignored` (detokenize; clicking an ignored span text again is a no-op). `autocomplete.tsx`: when caret follows `#`/`@`/`/` show anchored menu (rich-textarea caret position helper) listing matching projects/labels/sections + "Create '{q}'" (creates via mutation then inserts canonical name, quoting `#"Two Words"`); arrows + Enter select, Esc closes menu only.
- [ ] `chip-row.tsx`: chips mirroring parsed state, order per Todoist default (date, priority, reminders, labels, deadline, project, description) — all visible + labeled in v1 (Settings→Quick Add customization is phase 5): date chip (opens mini menu Today/Tomorrow/Next week/Remove → rewrites/strips the due phrase in `text`), priority chip (menu p1–p4 → replaces/append ` p{n}` token), labels chip (inserts `@`), deadline (inserts `{}` with caret inside), project (inserts `#`), description (appends ` // `). Chip = h-6, `rounded-sm`, 12px, border `--od-border`.
- [ ] `quick-add-dialog.tsx`: shadcn Dialog, top-aligned (`top-24`), w ≤ 560px, `rounded-lg`, `shadow-dialog`; contains input, description preview line, chip row, footer: project selector (defaults Inbox) + Cancel / "Add task" (primary, disabled when title empty). Submit: if `needsStructuredSubmit` OR `parsed.reminders.length > 0 && quick endpoint lacks reminder support` → pre-create missing projects/labels, `create.mutate(toCreatePayload(...))`, then POST each reminder (`/reminders` — **AS-BUILT CHECK:** confirm reminders route + body `{task_id, ...ReminderDraft}` in openapi.json; if absent skip reminders, note for R); else `quickAdd.mutate({ text })`. **AS-BUILT CHECK:** confirm `/tasks/quick` body field is `text` and whether it auto-creates unknown `#project`/`@label` (create a probe task against a scratch server if unclear) — if it does not, always pre-create referenced names. Keys: **Enter saves + clears + stays open** (focus back to input); **Ctrl/Cmd+Enter saves + closes**; Esc cancels — if text non-empty first Esc shows inline "Discard?" confirm (second Esc or button discards). On save `toast.info('Task added')` suppressed when dialog stays open (Todoist shows inline flash — v1: brief input placeholder flash "Added ✓").
- [ ] `inline-add.tsx` — props `{ defaults: Partial<TaskCreate>; placement: 'top' | 'bottom'; onDone?(): void }`: the "+ Add task" affordance views render at list bottom (row with accent `Plus` 18px); expands to the same input/chips inline card; Enter saves + keeps open (Todoist behavior), Esc collapses. Applies `defaults` (project_id/section_id/due date for Upcoming per-day add) AFTER parse (explicit tokens win over defaults).
- [ ] Verify: `pnpm --filter @opendoist/web test` — quick-add-model suite green; typecheck clean in owned files.

### Task H: Task detail dialog (PARALLEL)

**Files:** Replace `src/components/task-detail/task-detail-dialog.tsx`; Create `src/components/task-detail/{detail-main,detail-sidebar,subtask-list,comments}.tsx`.
**Consumes:** router search param `task`, tasks cache, mutations, comments hooks, RowPopovers pieces (SchedulerPanel, PriorityMenu content), TaskCheckbox, InlineAdd.

- [ ] Dialog opens when route search `task` set; `onOpenChange(false)` → navigate clearing the param. Size: w-[min(880px,90vw)] h-[min(640px,85vh)], `rounded-lg`, grid `[1fr_var(--detail-panel)]`. Task missing from cache → slim "Task not found" body.
- [ ] `detail-main`: header row = big TaskCheckbox + breadcrumb (project › section, links). Content editable in place (click → borderless input 16px weight 600, Cmd/Ctrl+Enter or blur saves via `update`, Esc reverts); description below (13px, textarea auto-grow, same save keys, placeholder "Description"); then `subtask-list.tsx` (children via `subtreeOf`, rows reuse `TaskRow` depth 0 + `InlineAdd` with `defaults={{parent_id, project_id}}`); then `comments.tsx`: list (12px timestamp, markdown NOT rendered v1 — plain text) + composer (textarea + "Comment" button → comment create; focused automatically when ui store `detailCommentFocus` set, then cleared).
- [ ] `detail-sidebar`: bg `surface`, stacked fields with 12px tertiary captions: Project (move-popover trigger), Date (SchedulerPanel popover), Deadline (date input popover writing `deadline_date`), Priority (priority menu), Labels (label popover), Duration (number input min); each renders current value or "+ Add …" ghost.
- [ ] Verify: typecheck clean in owned files.

### Task I: Inbox view (PARALLEL)

**Files:** Replace `src/views/inbox/index.tsx`.
- [ ] Find inbox project (`useProjects()` → `is_inbox`); tasks = `topLevel(byChildOrder(activeTasks ∩ project)))`; render `<ViewHeader title="Inbox"/>` + `<TaskList tasks groupId="inbox" tree/>` + `<InlineAdd defaults={{project_id}} placement="bottom"/>`. Loading: 3 × skeleton rows (h-[42px]). Content column wrapper `max-w-[var(--content-max)] mx-auto px-6 pb-24` (same wrapper in all views).
- [ ] Verify: typecheck clean in owned file.

### Task J: Today view (PARALLEL)

**Files:** Replace `src/views/today/index.tsx`; Create `src/views/today/overdue-block.tsx`.
- [ ] Header `Today` with subtitle `{n} tasks`. `overdue-block.tsx` — frozen export (Task K imports it): `export function OverdueBlock({ tasks }: { tasks: Task[] })`; when `overdue(tasks, today)` non-empty → section header row "Overdue" (14px weight 600) + right-aligned **Reschedule** button (accent text) opening a SchedulerPanel popover that applies the chosen date to ALL overdue tasks (each `update` with due.date replaced, time/recurrence/string preserved; single undo entry "Rescheduled {n} tasks"); overdue list sorted by dueDate then time, `showProject`.
- [ ] Main block: header "Jul 16 ‧ Today ‧ Wednesday" style date line; tasks `dueOn(tasks, today)` sorted `byDayOrder`, `<TaskList groupId="today" showProject/>` + `<InlineAdd defaults={{due today}}/>`. `today` ISO from `dateInTz(ctx.now, ctx.timezone)` (core) via `useParseCtx()`.
- [ ] Verify: typecheck clean in owned files.

### Task K: Upcoming view (PARALLEL)

**Files:** Replace `src/views/upcoming/index.tsx`; Create `src/views/upcoming/{week-strip,day-section,use-upcoming-days}.ts|tsx`.
- [ ] `use-upcoming-days.ts`: state `{ anchor: string (selected date, default today); range: number (rendered days, default 21) }`; day list = `[today … today+range]` via `addDaysIso`; `extend()` +14; month label from anchor; `gotoWeek(±1)` moves anchor 7 days (min today); exposes per-day tasks map from `dueOn`.
- [ ] `week-strip.tsx`: sticky under header — month + year title with `‹ ›` week pagers and "Today" button; 7 day cells (weekday initial + day number, dot when tasks exist, selected = accent circle, click scrolls to that day anchor). Shortcut hooks NOT here (Task N binds Shift+←/→ and Home to store actions exported from `use-upcoming-days`? cross-task: export module-level zustand-lite store `useUpcomingStore` inside `use-upcoming-days.ts` with `gotoWeek/gotoToday` so Task N can import it — FROZEN name: `useUpcomingStore`).
- [ ] `day-section.tsx`: `id="day-{date}"` heading `Jul 18 ‧ Saturday` (13px weight 600, sticky), `useDroppable({ id: 'day-' + date })`; `<TaskList groupId={'day-'+date} sortable/>` + `<InlineAdd defaults={{due: {date, time: null, string: date, recurrence: null}}}/>`. Overdue block at top reusing Task J's `overdue-block` (import from `@/views/today/overdue-block` — read-only cross-import of a PARALLEL task's file is allowed at integration; until then guard with a local re-implementation? **No** — J owns it; K imports it; typecheck settles at R. Acceptable: single import, signatures frozen here: `OverdueBlock({ tasks }: { tasks: Task[] })`).
- [ ] `index.tsx`: DndContext (`useAppSensors`, `closestCenter`): drag task row → drop on day container or between rows → same-day reorder = sequential `update({patch:{day_order}}, silent)` for shifted rows (**AS-BUILT CHECK:** use a bulk reorder endpoint if openapi.json has one); cross-day = `update({patch: {due: {…prev, date: dropDate, string: dropDate}}})` (undo via B). Infinite scroll: sentinel div + IntersectionObserver → `extend()`. DragOverlay renders a floating TaskRow clone with `shadow-drag`.
- [ ] Verify: typecheck clean in owned files (J's overdue-block import may pend until R).

### Task L: Project view (PARALLEL)

**Files:** Replace `src/views/project/index.tsx`; Create `src/views/project/{section-block.tsx,add-section.tsx,use-project-dnd.ts}`.
- [ ] `index.tsx`: `useParams` projectId; header = project name (+ color dot) with actions (Edit name inline, Add section, Delete project in more-menu). Body: no-section tasks first (`tree` TaskList `groupId="proj-root"` sortable) then `section-block` per section by `section_order`.
- [ ] `section-block.tsx`: header row — collapse chevron (persist `is_collapsed` via section mutations), name (inline editable), count, more-menu (rename/delete); collapsed hides list; `<TaskList tree sortable groupId={'sec-'+id}/>` + `<InlineAdd defaults={{project_id, section_id}}/>`.
- [ ] `add-section.tsx`: divider-style "+ Add section" hover affordance between blocks → inline name input → section create (`S` key handled by Task N calling a frozen export `useProjectStore.getState().startAddSection()` — declare tiny `useProjectStore` zustand in `use-project-dnd.ts`… rename file purpose: `use-project-dnd.ts` exports BOTH `useProjectDnd(projectId)` and `useProjectViewStore` `{ addingSectionAt, startAddSection(), stop() }` — FROZEN names).
- [ ] `use-project-dnd.ts`: DndContext handlers — reorder within container → `arrayMove` + sequential `update({patch:{child_order}}, silent)` per shifted task; drop into other section/root → `move.mutate({ id, to: { section_id, child_order } })`. Subtask indent/outdent for Task N: export `indentTask(taskId)` (set parent_id = previous visible sibling at same depth; no-op if none) and `outdentTask(taskId)` (parent_id = grandparent) implemented via `move`/`update`.
- [ ] Verify: typecheck clean in owned files.

### Task M: Label view (PARALLEL)

**Files:** Replace `src/views/label/index.tsx`.
- [ ] `useParams` labelName (URL-decoded); header = `@{name}` with the label's palette color dot; tasks = `tasksWithLabel(active, name)` sorted: dated first (date, time) then undated by created_at; `<TaskList groupId="label" showProject/>`; empty state "No tasks with this label". Unknown label (not in `useLabels()`) still renders (labels are name-based on tasks).
- [ ] Verify: typecheck clean in owned file.

### Task N: Keyboard map + shortcut overlay (PARALLEL)

**Files:** Replace `src/keyboard/index.tsx`; Create `src/keyboard/{map.ts,shortcut-overlay.tsx,use-focus-nav.ts}`.
**Consumes:** react-hotkeys-hook, stores, mutations, router, `useUpcomingStore`, `useProjectViewStore`/`indentTask`/`outdentTask` (Tasks K/L frozen exports).

- [ ] `map.ts` — single source of truth: `export interface Shortcut { id: string; keys: string; display: string; group: 'General' | 'Navigation' | 'Add tasks' | 'Manage tasks' | 'Project view' | 'Upcoming' ; desc: string; enabledOnForms?: boolean }` + `export const SHORTCUTS: Shortcut[]` covering (dossier §1.6 minus collaboration/desktop/sort/zoom keys — omitted set documented in a comment): `q` Quick Add · `/`, `f`, `mod+k` palette · `esc` dismiss · `m` sidebar · `shift+?` overlay (react-hotkeys-hook `'shift+slash'`) · `g>h`,`g>t` Today · `g>i` Inbox · `g>u` Upcoming · `j`/`down` `k`/`up` focus · `enter` open task · `e` complete · `t` schedule popover · `shift+t` remove date · `1 2 3 4` priority · `y` priority menu · `c` comment (open detail + `setDetailCommentFocus`) · `l` labels popover · `v` move popover · `.` more menu · `x` toggle select · `,` focus multi-toolbar (focus() its first button) · `mod+backspace`/`shift+delete` delete selected (or focused) · `shift+mod+c` copy task link · `a` add bottom / `shift+a` add top (**frozen decision:** both open the Quick Add dialog pre-scoped to the current view's defaults — a v1 simplification recorded in Self-Review; the in-list positional composer arrives with phase 5's Display work) · `shift+e` toggle focused task's subtasks (`is_collapsed`) · `ctrl+]`/`ctrl+[` indent/outdent (project view only) · `s` add section (project view) · `shift+left/right` week paging + `home` today (upcoming view only).
- [ ] `index.tsx` `<GlobalHotkeys/>`: one component binding all SHORTCUTS with `useHotkeys(keys, handler, { sequenceTimeoutMs: 1000, enableOnFormTags: false, preventDefault })`; route-scoped ones check `useRouterState().location.pathname` prefix. Task verbs act on selection when `selectedIds.size > 0` else `focusedId`; complete = `close.mutate` (checkbox animation is bypassed on key — acceptable). Esc priority chain: close popover → clear selection → close overlay/palette/dialog (only handle when no shadcn layer already consumed it — check `document.querySelector('[data-state=open]')` guard, else skip).
- [ ] `use-focus-nav.ts`: j/k move `focusNext/Prev` + `document.getElementById('task-' + id)?.scrollIntoView({ block: 'nearest' })` (Task E must set row `id={'task-' + task.id}` — coordinate: E's row spec above already includes `data-focused`; ADD to E's spec: row element `id` attr `task-{id}` — E owns it, contract frozen here).
- [ ] `shortcut-overlay.tsx`: Dialog (w 640px) listing SHORTCUTS grouped, 2-col rows `desc … <kbd>` (kbd: 12px mono, `rounded-[3px]`, border, px-1); ⌘/Ctrl rendered per `navigator.platform`. Opens via `?` and topbar help.
- [ ] Verify: typecheck clean in owned files (K/L imports may pend until R).

### Task O: Command palette (PARALLEL)

**Files:** Replace `src/components/palette/command-palette.tsx`; Create `src/components/palette/recents.ts`.
- [ ] `recents.ts`: `pushRecent({ type: 'view' | 'project' | 'label', id, title })` + `getRecents(): Recent[]` (localStorage `od-recents`, dedupe, max 8) + `useTrackRecents()` (router subscribe → push on nav).
- [ ] Palette: shadcn `CommandDialog` bound to ui store `paletteOpen`; input placeholder "Search or jump to…". Groups: **Recents** (when query empty) · **Views** Inbox/Today/Upcoming (icons, kbd hints `g i` etc.) · **Projects** (dot + name) · **Labels** · **Commands**: Add task (Q), Toggle sidebar (M), Keyboard shortcuts (?), Theme ▸ (9 inline items applying `applyTheme`), Design tokens page, Log out · **Tasks** (query ≥ 2 chars): client-side case-insensitive substring over tasks cache content+description, top 8, selecting opens `?task=id`. **AS-BUILT CHECK:** if `GET /api/v1/search?q=` exists in openapi.json, use it (debounced 200 ms) instead of substring; else substring is the frozen fallback (FTS palette search formally lands phase 5).
- [ ] Selecting always closes palette + `pushRecent`. Verify: typecheck clean in owned files.

### Task P: Undo + toast surfaces (PARALLEL)

**Files:** Replace `src/components/toast/toaster.tsx`; Create `src/components/toast/undo-toast.tsx`.
- [ ] `toaster.tsx`: fixed bottom-left stack (z `var(--z-toast)`), renders toasts store (info/error: `rounded-lg`, bg `surface-overlay`, white text 13px, `shadow-toast`, icon 16) AND undo store entries via `undo-toast.tsx`: label + **Undo** button (accent-on-dark text) + thin 2px progress bar animating width 100→0 over the entry's remaining ms (`transition: width linear`; respect reduced motion → static) + ✕ dismiss. Clicking Undo → `undo(id)` (store handles run+dismiss+errors). Entries/toasts animate in with 150 ms fade/slide.
- [ ] Verify: typecheck clean in owned files.

### Task Q: Playwright setup + E2E specs (PARALLEL — specs only; suite runs in Gate R)

**Files:** Create `apps/web/playwright.config.ts`, `apps/web/e2e/{auth.setup.ts,quick-add.spec.ts,complete-undo.spec.ts,keyboard.spec.ts,theme.spec.ts,a11y.spec.ts,helpers.ts}`.
**AS-BUILT CHECK:** server package dev command + data-dir env (`OPENDOIST_DATA_DIR` expected) from `apps/server/package.json`; adjust `webServer` commands.

- [ ] `playwright.config.ts`: `testDir: 'e2e'`, single `chromium` project + a `setup` project (`auth.setup.ts`) that all specs depend on (`storageState: 'e2e/.auth/user.json'`); `use: { baseURL: 'http://localhost:5173' }`; `webServer: [ { command: 'OPENDOIST_DATA_DIR=$(mktemp -d) pnpm --filter @opendoist/server dev', url: 'http://localhost:7968/api/health', reuseExistingServer: false, timeout: 60_000 }, { command: 'pnpm --filter @opendoist/web dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: false } ]` (mktemp gives a fresh DB per run; if env interpolation is flaky use a `globalSetup` that sets `process.env`).
- [ ] `auth.setup.ts`: `/register` → name `Test Owner`, email `owner@example.com`, password `test-password-1` → expect redirect to `/today` → save storageState.
- [ ] `quick-add.spec.ts`: press `q` → dialog; type `Buy milk tomorrow 4pm p1 #Errands @shopping`; expect highlight spans `[data-kind="due"]` containing `tomorrow 4pm`, `[data-kind="priority"]`, `[data-kind="project"]`, `[data-kind="label"]`; chip row shows date + priority chips; autocomplete "Create 'Errands'" flow; Enter → input clears, dialog stays open; Esc ×2 → closed; task appears in Upcoming tomorrow's day section and sidebar counts unchanged for today.
- [ ] `complete-undo.spec.ts`: quick-add `Water plants today`; goto `/today`; row visible; click checkbox → row leaves list (after 250 ms animation) and undo toast "Task completed" appears; click Undo → row returns; then `mod+Backspace`-style delete via row more-menu → "Task deleted" toast → Undo → row returns.
- [ ] `keyboard.spec.ts`: `g` `t` → `/today`; `g` `i` → `/inbox`; `g` `u` → `/upcoming`; seed 2 tasks; `j`/`k` moves `[data-focused]` between rows; `e` completes focused; `1` sets P1 (checkbox border color asserted via CSS var class `[data-priority="1"]` — Task E: add `data-priority` to checkbox — frozen here); `?` opens overlay listing "Quick Add"; `m` collapses sidebar (`aria-hidden` or width 0); `mod+k` opens palette, typing `upc` + Enter navigates to Upcoming.
- [ ] `theme.spec.ts`: user menu → Theme → Dark: `html[data-theme="dark"]`; reload persists; pick Tangerine → attribute swaps; pick System → attribute removed.
- [ ] `a11y.spec.ts`: `AxeBuilder` on `/login`, `/today`, `/upcoming` → zero `serious`/`critical` violations.
- [ ] `helpers.ts`: `quickAdd(page, text)`, `seedTasks(page, texts[])` (loops quickAdd), selectors const. Verify (no servers!): `pnpm --filter @opendoist/web typecheck` and `pnpm --filter @opendoist/web exec playwright test --list` prints all specs without executing.

---

### Task R: Integration gate (SEQUENTIAL — after B–Q)

**Files:** may touch anything with the smallest possible diffs; resolves cross-task pends (K→J import, N→K/L exports, E's `id`/`data-priority` attrs), reconciles AS-BUILT notes recorded by B/C/F/G/K/O/Q.

- [ ] **Step 1:** `grep -rn "PHASE4-STUB" apps/web/src` → must be empty (any hit = a task under-delivered; implement the minimum to close it and record it).
- [ ] **Step 2:** `pnpm install` only if manifests changed, then `pnpm verify` (lint + typecheck + test + build) — fix with minimal diffs until green.
- [ ] **Step 3:** Collect every AS-BUILT discrepancy note from parallel results; apply the centralized fixes in `src/api/client.ts` endpoints map / `schemas.ts` only; re-run `pnpm --filter @opendoist/web test`.
- [ ] **Step 4:** End-to-end: `pnpm --filter @opendoist/web test:e2e` → all specs green (headed debug with `--headed --workers=1` as needed). Flake budget: one retry; persistent failures are bugs, not flakes.
- [ ] **Step 5:** Manual smoke against the real server (`pnpm --filter @opendoist/server dev` + `pnpm --filter @opendoist/web dev`): register → quick add `every mon 9am #Work` → verify recurring chip in Inbox? (project Work) → complete it → due advances (server recompute) → sidebar counts update → `/dev/tokens` still renders all 9 themes. Two browser tabs: complete a task in tab 1 → tab 2 updates via SSE within ~1 s.
- [ ] **Step 6:** Do not commit — report ready-for-checkpoint with the list of every deviation + as-built fix applied.

## Self-Review (done)

- Scope coverage vs assignment: restructure+/dev/tokens (A) · auth screens/OIDC/first-run (C) · layout/sidebar-resize/collapse/topbar (D) · typed client+zod+hooks+optimistic+SSE (A+B) · task list per §2.9 with checkbox fill/animation/hover/selection/multi-select (E+F) · Quick Add overlay highlighting, detokenize, chips, Q, Enter-reopens, `/tasks/quick` (G) · task detail (H) · five views as separate tasks (I–M) · keyboard map + `?` (N) · palette (O) · undo toasts (P) · Playwright core flows incl. login, highlighting, complete+undo, keyboard, theme (Q).
- Deliberate v1 simplifications (recorded for phase 5): Ctrl+Enter = save+close (not insert-above) · `a`/`shift+a` open scoped Quick Add instead of in-list composer at exact position · Display menu/sort keys/`o>` sequences/completed-tasks toggle deferred (phase 5) · TanStack Virtual deferred until real >1k lists · palette task-search client-side unless server `/search` is confirmed.
- Parallel-safety: all Files lists disjoint; cross-task needs resolved by frozen named exports (`useUpcomingStore`, `useProjectViewStore`, `OverdueBlock`, row `id`/`data-priority` attrs) with Gate R as the settlement point; no parallel task edits Task A files, runs installs, servers, or builds.
- Contract consistency: hook signatures identical in A (definition) and B (reimplementation); store fields referenced by D/E/F/N all exist in A's store specs; endpoints referenced by B/G/O all live in A's `endpoints` map.
