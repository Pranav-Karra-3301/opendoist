# OpenDoist Phases 1–2: Foundation + Core Engines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via a Workflow: Task A first (sequential), Tasks B–F in parallel (disjoint file sets, no commits, no `pnpm install`), Task G integrates.** Commits happen at integration checkpoints, not per-task, because tasks run concurrently in one working tree.

**Goal:** A pnpm monorepo with working CI, design tokens + theme showcase, and a fully tested `@opendoist/core` package (Quick Add parser, recurrence engine, filter-query engine).

**Architecture:** `packages/core` is pure/zero-IO and owns all product logic that web/server/CLI will share. `apps/web` exists only as a Vite shell that renders the design-token showcase. All contracts (zod schemas, function signatures) are defined in Task A and are **frozen** — parallel tasks implement against them without edits.

**Tech Stack:** Node ≥22, pnpm workspaces + catalog, TypeScript strict, Biome 2, Vitest 4 (+fast-check), zod 4, chrono-node 2.10, date-fns 4 + @date-fns/tz, temporal-polyfill + rrule-temporal, Vite 8 + React 19 + Tailwind 4.

**Reference documents (already in repo, read before your task):**
- Spec: `docs/superpowers/specs/2026-07-15-opendoist-design.md`
- Dossier: `docs/superpowers/research/2026-07-15-opendoist-research.md` (grammar §1.1–1.3, filters §1.7, tokens CSS §2.8, component rules §2.9)

## Global Constraints

- Priorities stored **1 = highest (p1) … 4 = default**.
- Dates in core: calendar dates are `YYYY-MM-DD` strings; times are `HH:mm` wall-clock strings; instants are ISO-8601 UTC strings; IANA timezone carried in context objects. No `Date` in public APIs.
- Week: ISO weekday numbers 1=Mon…7=Sun everywhere.
- TypeScript `strict`, no `any` (Biome `noExplicitAny: error`), `verbatimModuleSyntax`.
- Tests colocated `src/**/*.test.ts`, run by Vitest; every public function has tests.
- Radii 5px/10px only; Kale `#4c7a45` default accent; focus ring `#1f60c2` (tokens task).
- License AGPL-3.0. Conventional commit messages.
- Parallel-execution rules: builders touch ONLY their listed files; never run `pnpm install` (Task A declares all deps and installs once); never `git commit`.
- If a catalog version fails to resolve, set it to the latest published version (`pnpm view <pkg> version`) and record the change in your result notes.

---

### Task A: Root scaffold + core contract (SEQUENTIAL — everything depends on this)

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.editorconfig`, `.nvmrc`, `biome.json`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`, `packages/core/src/types.ts`, `packages/core/src/dates.ts`, `packages/core/src/nl-date.ts`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json` (manifest only — Task E writes the app source)
- Test: `packages/core/src/types.test.ts`, `packages/core/src/dates.test.ts`, `packages/core/src/nl-date.test.ts`

**Interfaces (produces — FROZEN for Tasks B–D):** everything in `types.ts`, `dates.ts`, `nl-date.ts` below.

- [ ] **Step 1: Root files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*

catalog:
  typescript: ^5.9.0
  vitest: ^4.1.10
  '@biomejs/biome': ^2.5.4
  zod: ^4.4.3
  chrono-node: ^2.10.0
  date-fns: ^4.4.0
  '@date-fns/tz': ^1.5.0
  temporal-polyfill: ^1.0.1
  rrule-temporal: ^2.0.0
  nanoid: ^5.1.0
  fast-check: ^4.3.0
  react: ^19.2.0
  react-dom: ^19.2.0
  '@types/react': ^19.2.0
  '@types/react-dom': ^19.2.0
  '@types/node': ^22.15.0
  vite: ^8.1.0
  '@vitejs/plugin-react': ^6.0.0
  tailwindcss: ^4.3.0
  '@tailwindcss/vite': ^4.3.0
```

`package.json` (root):
```json
{
  "name": "opendoist-monorepo",
  "private": true,
  "engines": { "node": ">=22" },
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
  },
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "typescript": "catalog:"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`.nvmrc`: `22`

`.editorconfig`: root=true; `[*]` charset utf-8, lf, final newline, 2-space indent.

`biome.json`:
```json
{
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true, "suspicious": { "noExplicitAny": "error" } } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } }
}
```
Run `pnpm exec biome migrate --write` after install if the schema complains; keep the settings above.

- [ ] **Step 2: Package manifests**

`packages/core/package.json`:
```json
{
  "name": "@opendoist/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "node -e \"console.log('core: source-consumed workspace package, no build step')\""
  },
  "dependencies": {
    "zod": "catalog:",
    "chrono-node": "catalog:",
    "date-fns": "catalog:",
    "@date-fns/tz": "catalog:",
    "temporal-polyfill": "catalog:",
    "rrule-temporal": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:",
    "fast-check": "catalog:",
    "@types/node": "catalog:"
  }
}
```

`packages/core/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`
`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
```

`apps/web/package.json`:
```json
{
  "name": "@opendoist/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "node -e \"console.log('web: Playwright arrives in phase 4')\""
  },
  "dependencies": {
    "react": "catalog:",
    "react-dom": "catalog:",
    "@opendoist/core": "workspace:*"
  },
  "devDependencies": {
    "vite": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "tailwindcss": "catalog:",
    "@tailwindcss/vite": "catalog:",
    "typescript": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "react-jsx", "types": ["vite/client"] },
  "include": ["src"]
}
```

- [ ] **Step 3: `packages/core/src/types.ts` — the frozen contract (verbatim)**

```ts
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
  /** fixed dates: every 14 jan, 14 apr, 15 jun */
  dates: z.array(z.object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })).default([]),
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
  'due', 'duration', 'deadline', 'reminder', 'project', 'section', 'label',
  'priority', 'description', 'uncompletable',
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

export const ParsedQuickAddSchema = z.object({
  /** input with consumed tokens removed, whitespace collapsed, trimmed */
  title: z.string(),
  tokens: z.array(QuickAddTokenSchema),
  due: DueSchema.nullable(),
  durationMin: z.number().int().min(1).max(1440).nullable(),
  deadline: IsoDateSchema.nullable(),
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
  weekStart: 1, nextWeekDay: 1, weekendDay: 6, smartDate: true,
} as const

/* ---------- filter engine ---------- */

export type FilterPredicate =
  | { t: 'today' } | { t: 'tomorrow' } | { t: 'yesterday' } | { t: 'overdue' }
  | { t: 'noDate' } | { t: 'noTime' } | { t: 'recurring' } | { t: 'noDeadline' }
  | { t: 'noLabels' } | { t: 'noPriority' } | { t: 'subtask' } | { t: 'uncompletable' }
  | { t: 'viewAll' } | { t: 'noSection' }
  | { t: 'dateOn'; ref: string } | { t: 'dateBefore'; ref: string } | { t: 'dateAfter'; ref: string }
  | { t: 'dateWithin'; days: number }
  | { t: 'deadlineOn'; ref: string } | { t: 'deadlineBefore'; ref: string } | { t: 'deadlineAfter'; ref: string }
  | { t: 'createdOn'; ref: string } | { t: 'createdBefore'; ref: string } | { t: 'createdAfter'; ref: string }
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
export interface FilterQuery { panes: FilterExpr[] }

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
  constructor(message: string, public readonly position: number) {
    super(message)
    this.name = 'FilterSyntaxError'
  }
}
```

- [ ] **Step 4: `packages/core/src/dates.ts` — timezone helpers (verbatim)**

```ts
import { TZDate } from '@date-fns/tz'
import { addDays as dfAddDays, differenceInCalendarDays } from 'date-fns'
import type { Weekday } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

/** calendar date of `instant` (ISO UTC string) in `timezone` */
export function dateInTz(instant: string, timezone: string): string {
  const d = new TZDate(instant, timezone)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** wall-clock HH:mm of `instant` in `timezone` */
export function timeInTz(instant: string, timezone: string): string {
  const d = new TZDate(instant, timezone)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO weekday 1..7 of a YYYY-MM-DD calendar date */
export function isoWeekday(date: string): Weekday {
  const d = new Date(`${date}T00:00:00Z`)
  return ((d.getUTCDay() + 6) % 7) + 1 as Weekday
}

export function addDaysIso(date: string, days: number): string {
  const d = dfAddDays(new Date(`${date}T00:00:00Z`), days)
  return d.toISOString().slice(0, 10)
}

/** days from `a` to `b` (b - a) as calendar dates */
export function diffDays(a: string, b: string): number {
  return differenceInCalendarDays(new Date(`${b}T00:00:00Z`), new Date(`${a}T00:00:00Z`))
}

/** next date (strictly after `date` unless `allowSame`) that falls on `weekday` */
export function nextWeekdayOnOrAfter(date: string, weekday: Weekday, allowSame = true): string {
  const current = isoWeekday(date)
  let delta = (weekday - current + 7) % 7
  if (delta === 0 && !allowSame) delta = 7
  return addDaysIso(date, delta)
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** UTC instant for a wall-clock date+time in `timezone` (DST-safe via TZDate) */
export function instantFor(date: string, time: string, timezone: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new TZDate(y!, m! - 1, d!, hh!, mm!, 0, timezone).toISOString()
}

export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
```

- [ ] **Step 5: `packages/core/src/nl-date.ts` — natural-language date resolution (shared by quick-add, recurrence bounds, and filter date refs)**

Public API (frozen):

```ts
import type { ParseContext } from './types'

export interface ResolvedDate { date: string; time: string | null }
export interface DateSpan extends ResolvedDate { start: number; end: number; text: string; durationMin: number | null }

/** Resolve a whole string as a date phrase ('today', 'mid january', 'next friday 4pm', '27th').
 *  Returns null when the string is not a date phrase. */
export function resolveNaturalDate(text: string, ctx: ParseContext): ResolvedDate | null

/** Find date phrases inside free text with their spans; used by the Quick Add parser.
 *  Also captures a trailing 'for <duration>' immediately after a timed phrase. */
export function findDateSpans(text: string, ctx: ParseContext): DateSpan[]
```

Implementation: chrono-node `chrono.casual.clone()` with `forwardDate: true`, reference `{ instant: new Date(ctx.now), timezone: ctx.timezone }`. Add custom parsers/refiners for (behavior table = tests):

| Input (ctx.now = 2026-07-15T21:00Z, tz America/New_York → local Wed Jul 15 5pm) | date | time |
|---|---|---|
| `today`, `tod` | 2026-07-15 | null |
| `tomorrow`, `tom` | 2026-07-16 | null |
| `tom 4pm` | 2026-07-16 | 16:00 |
| `6pm` (not yet passed locally) | 2026-07-15 | 18:00 |
| `4pm` (already passed locally) | 2026-07-16 | 16:00 |
| `27th` | 2026-07-27 | null |
| `27` (bare number ≤31) | 2026-07-27 | null (next 27th; August if passed) |
| `mid january` | 2027-01-15 | null |
| `end of month` | 2026-07-31 | null |
| `next friday` | 2026-07-24 | null (Friday of next week, not this week's) |
| `this weekend` | 2026-07-18 | null (upcoming `ctx.weekendDay`) |
| `next week` | 2026-07-20 | null (next `ctx.nextWeekDay`) |
| `later this week` | 2026-07-17 | null (two days out, capped at Sunday) |
| `in 5 days`, `+5 days` | 2026-07-20 | null |
| `in 3 weeks` | 2026-08-05 | null |
| `fri at 1900`, `Fri @ 7pm`, `fri at 19:00` | 2026-07-17 | 19:00 |
| `tom morning` / `in the morning` | (tom/today) | 09:00 |
| `in the afternoon` | — | 12:00 |
| `in the evening` | — | 19:00 |
| `new year day` | 2027-01-01 | null |
| `valentine` | 2027-02-14 | null |
| `halloween` | 2026-10-31 | null |
| `new year eve` | 2026-12-31 | null |
| `mar 30` | 2027-03-30 | null (forward) |

`for <duration>` capture: `for 45min` / `for 45 minutes` / `for 2h` / `for 1 hour 30 minutes` → minutes (cap 1440); only attaches when the phrase has a time.

- [ ] **Step 6: `packages/core/src/index.ts`**

```ts
export * from './types'
export * from './dates'
export * from './nl-date'
export * from './quick-add'   // Task B
export * from './recurrence'  // Task C
export * from './filter'      // Task D
```
Until B–D land, create placeholder barrels so typecheck passes (Tasks B–D replace them wholesale): `src/quick-add/index.ts` and `src/filter/index.ts` contain only `export {}` with a `// implemented by Task B/D` comment; `src/recurrence/index.ts` must export TYPED STUBS matching Task C's frozen signatures so Task B compiles against it:

```ts
// implemented by Task C — typed stubs so dependents typecheck meanwhile
import type { ParseContext, RecurrenceSpec } from '../types'
export function parseRecurrenceText(
  _text: string,
  _ctx: ParseContext,
): { spec: RecurrenceSpec; consumed: number; firstDate: string; firstTime: string | null } | null {
  return null
}
export function nextOccurrence(
  _spec: RecurrenceSpec,
  _opts: { after: { date: string; time: string | null }; ctx: ParseContext },
): { date: string; time: string | null } | null {
  return null
}
```

- [ ] **Step 7: Tests for types/dates/nl-date**

`types.test.ts`: PrioritySchema accepts 1–4 rejects 0/5; RecurrenceSpecSchema parses a full object and applies defaults; ParsedQuickAddSchema round-trips a representative object.
`dates.test.ts`: `dateInTz('2026-07-15T03:00:00Z','America/New_York')==='2026-07-14'`; `isoWeekday('2026-07-15')===3`; `instantFor('2026-11-01','01:30','America/New_York')` (DST-ambiguous) returns a valid instant; `nextWeekdayOnOrAfter('2026-07-15', 3, false)==='2026-07-22'`.
`nl-date.test.ts`: the full behavior table above as `test.each`.

- [ ] **Step 8: Install & gate**

Run: `cd /Users/pranav/developer/opendoist && pnpm install`
Then: `pnpm --filter @opendoist/core test` → all pass; `pnpm typecheck` → clean; `pnpm lint` → clean (fix trivia with `pnpm lint:fix`).
Expected: lockfile `pnpm-lock.yaml` created. Do NOT commit (orchestrator commits at checkpoint).

---

### Task B: Quick Add parser

**Files:**
- Create: `packages/core/src/quick-add/index.ts`, `packages/core/src/quick-add/parse.ts`, `packages/core/src/quick-add/tokens.ts`
- Replace placeholder: `packages/core/src/quick-add/index.ts`
- Test: `packages/core/src/quick-add/parse.test.ts`, `packages/core/src/quick-add/golden.test.ts`

**Interfaces:**
- Consumes: `types.ts` (ParsedQuickAdd, QuickAddToken, ParseContext, DEFAULT_PARSE_CONTEXT_SETTINGS), `nl-date.ts` (findDateSpans, resolveNaturalDate), `recurrence` **only via** `parseRecurrenceText(text, ctx)` from Task C — to keep B/C parallel-safe, B calls it through a late import: `import { parseRecurrenceText } from '../recurrence'`; until C lands, B's tests that need recurrence use the placeholder behavior (skip-marked, un-skipped at integration).
- Produces: `parseQuickAdd(input: string, ctx: ParseContext): ParsedQuickAdd`

**Token rules (each is a test):**
- Tokens require a word boundary before their sigil (start-of-string or whitespace). `p1`–`p4` case-insensitive, whole word. Duplicate priority/project/section: **last one wins**, earlier occurrences stay plain text. Labels accumulate (dedupe, case-preserving first-spelling).
- `#project` / `/section` / `@label`: name = run of non-whitespace chars; or quoted `#"Movie Watchlist"` for multiword. `/section` only tokenizes if a `#project` token exists anywhere in the input.
- `{…}` deadline: inner text resolved by `resolveNaturalDate` (date part only; time inside braces is an error → not a token).
- `!…` reminder: `!30 min before` → relative(30); `!2 hours before` → relative(120); `!14:00` → absolute(today-or-tomorrow rule, 14:00); `!tomorrow 9am` → absolute; `!every day 5pm` → recurring (via parseRecurrenceText).
- Due: first date span from `findDateSpans` not inside another token; `every …` recurrence phrase (from `parseRecurrenceText` span) takes precedence and merges (e.g. `every mon at 20:00` → due with recurrence + times).
- `for 45min` duration only when a timed due exists.
- `// text`: everything after the first ` // ` (space-slash-slash-space) = description; not scanned for other tokens.
- Leading `* ` (asterisk space) → uncompletable, stripped from title.
- `ctx.smartDate === false`: no due/deadline/reminder tokens are produced; explicit sigil tokens (`#@/p{}!`) still work? **No** — Todoist's toggle only disables *date* recognition. `#/@/p` still tokenize; `{}` `!` also still tokenize (they are explicit). Only bare-text dates stop tokenizing.
- Title = input minus token spans, whitespace collapsed. Tokens never overlap; on overlap, earlier-starting longer token wins.

- [ ] **Step 1: golden.test.ts — write the golden table first (subset here; extend to ≥60 rows covering every syntax row of dossier §1.1–1.3)**

```ts
import { describe, expect, test } from 'vitest'
import { parseQuickAdd } from './index'
import { DEFAULT_PARSE_CONTEXT_SETTINGS, type ParseContext } from '../types'

const ctx: ParseContext = {
  now: '2026-07-15T21:00:00Z', // Wed, 5pm in New York
  timezone: 'America/New_York',
  ...DEFAULT_PARSE_CONTEXT_SETTINGS,
}

test('plain title', () => {
  const r = parseQuickAdd('buy milk', ctx)
  expect(r.title).toBe('buy milk')
  expect(r.due).toBeNull()
  expect(r.priority).toBe(4)
  expect(r.tokens).toEqual([])
})

test('date + time + priority + project + section + label', () => {
  const r = parseQuickAdd('Submit report tom 4pm p1 #Work /Admin @email', ctx)
  expect(r.title).toBe('Submit report')
  expect(r.due).toMatchObject({ date: '2026-07-16', time: '16:00', recurrence: null })
  expect(r.priority).toBe(1)
  expect(r.project).toBe('Work')
  expect(r.section).toBe('Admin')
  expect(r.labels).toEqual(['email'])
  expect(r.tokens.map((t) => t.kind).sort()).toEqual(['due', 'label', 'priority', 'project', 'section'])
})

test('deadline in braces + relative reminder + duration', () => {
  const r = parseQuickAdd('Team meeting today 4pm for 45min {july 30} !30 min before', ctx)
  expect(r.due).toMatchObject({ date: '2026-07-15', time: '16:00' })
  expect(r.durationMin).toBe(45)
  expect(r.deadline).toBe('2026-07-30')
  expect(r.reminders).toEqual([{ kind: 'relative', minutesBefore: 30 }])
})

test('bare time rolls forward', () => {
  expect(parseQuickAdd('do laundry 4pm', ctx).due).toMatchObject({ date: '2026-07-16', time: '16:00' })
  expect(parseQuickAdd('do laundry 6pm', ctx).due).toMatchObject({ date: '2026-07-15', time: '18:00' })
})

test('uncompletable + description extension', () => {
  const r = parseQuickAdd('* Flight check-in tod // gate closes 30m before', ctx)
  expect(r.uncompletable).toBe(true)
  expect(r.title).toBe('Flight check-in')
  expect(r.due?.date).toBe('2026-07-15')
  expect(r.description).toBe('gate closes 30m before')
})

test('last priority wins, quoted project', () => {
  const r = parseQuickAdd('fix bug p3 p1 #"Movie Watchlist"', ctx)
  expect(r.priority).toBe(1)
  expect(r.project).toBe('Movie Watchlist')
  expect(r.title).toBe('fix bug p3')
})

test('smartDate off keeps sigils, drops bare dates', () => {
  const r = parseQuickAdd('call mom tomorrow p2 @family', { ...ctx, smartDate: false })
  expect(r.due).toBeNull()
  expect(r.title).toBe('call mom tomorrow')
  expect(r.priority).toBe(2)
  expect(r.labels).toEqual(['family'])
})

test('recurring due merges times', () => {
  const r = parseQuickAdd('team sync every mon, fri at 20:00', ctx)
  expect(r.due?.recurrence).toMatchObject({ anchor: 'schedule', freq: 'weekly', weekdays: [1, 5], times: ['20:00'] })
  expect(r.due?.date).toBe('2026-07-17') // next occurrence: Fri
  expect(r.due?.time).toBe('20:00')
})
```

- [ ] **Step 2:** run → fails (module empty). **Step 3:** implement `tokens.ts` (sigil scanner producing candidate spans) + `parse.ts` (orchestrates: description split → uncompletable → sigil tokens → recurrence span → date spans → assembly; returns schema-validated result). **Step 4:** green + extend goldens to ≥60 rows. **Step 5:** `pnpm --filter @opendoist/core test` + typecheck + lint clean.

---

### Task C: Recurrence engine

**Files:**
- Create: `packages/core/src/recurrence/index.ts`, `packages/core/src/recurrence/grammar.ts`, `packages/core/src/recurrence/engine.ts`
- Test: `packages/core/src/recurrence/grammar.test.ts`, `packages/core/src/recurrence/engine.test.ts`, `packages/core/src/recurrence/engine.property.test.ts`

**Interfaces:**
- Consumes: `types.ts` (RecurrenceSpec, ParseContext, Weekday), `dates.ts`, `nl-date.ts` (resolveNaturalDate for `starting/until/from/ending` bounds).
- Produces (frozen):
```ts
/** Parse a recurrence phrase if `text` STARTS WITH one (after optional leading spaces).
 *  Returns the spec + the consumed span length, or null. Handles 'every', 'every!', 'ev', 'daily',
 *  'weekly', 'monthly', 'quarterly', 'yearly', 'after N <unit>' (→ completion anchor). */
export function parseRecurrenceText(text: string, ctx: ParseContext):
  { spec: RecurrenceSpec; consumed: number; firstDate: string; firstTime: string | null } | null

/** Next occurrence strictly after `after` (a calendar date, optionally with time for hourly freq). */
export function nextOccurrence(spec: RecurrenceSpec, opts: {
  after: { date: string; time: string | null }
  ctx: ParseContext
}): { date: string; time: string | null } | null
```
- `quarterly` = monthly interval 3. `every other X` = interval 2. `after 10 days` → `{anchor:'completion', freq:'daily', interval:10}`.
- `until` inclusive: occurrences > until → null. `starting` bound: first occurrence ≥ starting. `for 3 weeks` → until = firstDate + 21 days.

**Grammar fixtures (grammar.test.ts, extend to every dossier §1.3 row):**

| Input | Spec highlights | firstDate (ctx as Task B) |
|---|---|---|
| `every day` / `daily` | daily ×1 | 2026-07-16 |
| `every workday` | weekly, weekdays ['workday'] | 2026-07-16 |
| `every! 3 days` | completion, daily ×3 | 2026-07-18 |
| `after 10 days` | completion, daily ×10 | 2026-07-25 |
| `every other tue` | weekly ×2, weekdays [2] | 2026-07-21 |
| `every 3rd friday` | monthly, ordinal {3, weekday, 5} | 2026-07-17 |
| `every last day` | monthly, ordinal {last, day} | 2026-07-31 |
| `every mon, fri at 20:00` | weekly, weekdays [1,5], times ['20:00'] | 2026-07-17 |
| `every 2, 15, 27` | monthly, monthDays [2,15,27] | 2026-07-27 |
| `every 14 jan, 14 apr` | yearly, dates [{1,14},{4,14}] | 2027-01-14 |
| `every quarter` | monthly ×3 | 2026-10-15 |
| `ev monday` | weekly, weekdays [1] | 2026-07-20 |
| `every day starting aug 1` | daily, starting 2026-08-01 | 2026-08-01 |
| `everyday from 10 May until 20 May` | daily, starting/until | 2027-05-10 |
| `every day for 3 weeks` | daily, until firstDate+21 | 2026-07-16 |
| `every 12 hours starting at 9pm` | hourly ×12, times seed 21:00 | 2026-07-15 |

**engine.test.ts:** sequences — from `{date:'2026-07-17'}` with `every mon, fri`: next 4 = 07-20, 07-24, 07-27, 07-31. Ordinal: `every 3rd friday` after 2026-07-17 → 2026-08-21. `every last day` after 2026-07-31 → 2026-08-31. monthDays wrap, yearly dates wrap, until stops (returns null past bound), completion anchor: nextOccurrence with after = completion date.

**engine.property.test.ts (fast-check):** for arbitrary valid specs + dates: (1) `nextOccurrence(...).date > after.date` or (equal date and later time for hourly); (2) applying next twice is monotonic; (3) weekly specs always land on a listed weekday; (4) around DST transitions in America/New_York (2026-03-08, 2026-11-01) daily specs advance exactly one calendar day.

Steps: fixtures red → grammar impl → engine impl (pure calendar math on ISO strings via `dates.ts`; use rrule-temporal ONLY if it simplifies — calendar math on strings is acceptable and dependency-light) → green → extend → lint/typecheck.

---

### Task D: Filter-query engine

**Files:**
- Create: `packages/core/src/filter/index.ts`, `packages/core/src/filter/lexer.ts`, `packages/core/src/filter/parser.ts`, `packages/core/src/filter/evaluate.ts`
- Test: `packages/core/src/filter/parser.test.ts`, `packages/core/src/filter/evaluate.test.ts`

**Interfaces:**
- Consumes: `types.ts` (FilterExpr, FilterQuery, FilterPredicate, FilterTaskView, FilterContext, FilterSyntaxError), `nl-date.ts` (resolveNaturalDate for date refs at EVAL time), `dates.ts`.
- Produces (frozen):
```ts
export function parseFilter(query: string): FilterQuery   // throws FilterSyntaxError
export function evaluateFilter(expr: FilterExpr, task: FilterTaskView, ctx: FilterContext): boolean
export function filterTasks(query: FilterQuery, tasks: FilterTaskView[], ctx: FilterContext): FilterTaskView[][] // one array per pane
```

**Grammar:** precedence `!` > `&` > `|`; parentheses; `,` splits top-level panes; `\` escapes the next char inside names; `*` wildcard in `@label*` names. Keywords case-insensitive: `today tomorrow yesterday overdue od "no date" "no time" "no labels" "no priority" "no deadline" "no section"(as !/*) recurring subtask uncompletable "view all" p1 p2 p3 p4 "N days" "next N days" date: "date before:" "date after:" "due before:" "due after:" deadline: "deadline before:" "deadline after:" created: "created before:" "created after:" search: @… #… ##… /… !/*`. Date refs stored raw (`{t:'dateBefore', ref:'next week'}`), resolved at eval.

**parser.test.ts:** AST snapshots for: `(today | overdue) & #Work` · `(p1 | p2) & 14 days` · `#Inbox & no date, view all & !#Inbox & !no date` (2 panes) · `saturday & @night` (date-on saturday) · `search: Meeting & today` · `##School & !#Science` · `@home*` wildcard · `#One \& Two` escaped · malformed `today &` throws FilterSyntaxError with position.

**evaluate.test.ts:** fixture task set (10 tasks spanning dates/priorities/labels/projects with a parent-child project pair) — each canonical query returns the exact expected id list; `##parent` includes child-project tasks; `overdue` uses dueDate < today OR (equal + time past); `7 days` = due within next 7 days including today; label wildcard `@home*` matches `home`/`homework`.

Steps: parser tests red → lexer+parser → green → evaluate tests red → evaluator → green → lint/typecheck.

---

### Task E: Design tokens + theme showcase (apps/web)

**Files:**
- Create: `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles/tokens.css`
- (Manifests already exist from Task A — do not edit them.)

**Interfaces:** Produces the canonical `tokens.css` used by all later UI phases; `data-theme` values: `todoist | dark | moonstone | tangerine | kale (=default, no attribute needed) | blueberry | lavender | raspberry | light (alias of default)`.

- [ ] **Step 1:** `tokens.css` — copy the dossier §2.8 block **verbatim**, then: (a) delete the `@media (prefers-color-scheme: dark)` placeholder comment block — system-dark is handled by the head script toggling `.system-dark`; (b) keep the `[data-theme="dark"], .system-dark { … }` combined selector exactly as written; (c) append `[data-theme="light"] {}` alias comment.
- [ ] **Step 2:** `index.html` with theme head script (before CSS):
```html
<script>
  const t = localStorage.getItem('od-theme')
  if (t && t !== 'system') document.documentElement.dataset.theme = t
  else document.documentElement.classList.toggle('system-dark', matchMedia('(prefers-color-scheme: dark)').matches)
</script>
```
- [ ] **Step 3:** `vite.config.ts` (react + tailwindcss plugins), `main.tsx` (imports `./styles/tokens.css`), `App.tsx` = token showcase: theme picker (9 buttons incl. System, persists `od-theme`, sets `data-theme`/`.system-dark`), type-scale specimens, radius/shadow cards, semantic-color swatch grid (reads computed `--od-*` values), the 20 project-palette dots with names, four priority checkbox mockups (18px circle, 2px ring, 10% fill, hover 20%), date-color chips (today/tomorrow/weekend/next week/overdue), buttons (primary/secondary/danger, heights 28/32/36). Pure JSX + token classes/vars — no component library.
- [ ] **Step 4:** `pnpm --filter @opendoist/web build` → succeeds; `pnpm --filter @opendoist/web typecheck` clean; lint clean.

---

### Task F: CI + repo meta

**Files:**
- Create: `.github/workflows/ci.yml`, `LICENSE`, `README.md`, `CONTRIBUTING.md`, `cliff.toml`

- [ ] **Step 1:** `ci.yml`:
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
  pr-title:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: amannn/action-semantic-pull-request@v5
        env: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```
- [ ] **Step 2:** `LICENSE` = full AGPL-3.0 text (`curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE`; verify first line reads "GNU AFFERO GENERAL PUBLIC LICENSE").
- [ ] **Step 3:** `README.md`: centered icon (`assets/brand/icon-green.svg`), one-line pitch ("Self-hosted, single-user, keyboard-first task manager — a Todoist-compatible open alternative"), status banner (pre-alpha, phase 1–2), Features (from spec §1–2, marked planned/done), planned quick start (`docker run -d -p 7968:7968 -v ./data:/data ghcr.io/pranav-karra-3301/opendoist`), development setup (pnpm install / verify), stack table, license + Noun Project attribution line ("List" by Glyphy, CC BY 3.0).
- [ ] **Step 4:** `CONTRIBUTING.md`: dev setup, conventional-commit + squash-merge policy, "tokens are law" section — copy the dossier §2.9 component-rules table verbatim, note that any deviation must edit the table in the same PR.
- [ ] **Step 5:** `cliff.toml` (git-cliff, Keep-a-Changelog):
```toml
[changelog]
header = "# Changelog\n\nAll notable changes to OpenDoist.\n"
body = """
{% if version %}## [{{ version | trim_start_matches(pat="v") }}] - {{ timestamp | date(format="%Y-%m-%d") }}{% else %}## [Unreleased]{% endif %}
{% for group, commits in commits | group_by(attribute="group") %}
### {{ group }}
{% for commit in commits %}- {% if commit.scope %}*({{ commit.scope }})* {% endif %}{{ commit.message | upper_first }}
{% endfor %}{% endfor %}
"""
[git]
conventional_commits = true
filter_unconventional = false
commit_parsers = [
  { message = "^feat", group = "Features" },
  { message = "^fix", group = "Bug Fixes" },
  { message = "^perf", group = "Performance" },
  { message = "^refactor", group = "Refactoring" },
  { message = "^docs", group = "Documentation" },
  { message = "^test", group = "Testing" },
  { message = "^chore|^ci|^build", group = "Maintenance" },
]
```

---

### Task G: Integration gate (SEQUENTIAL — after B–F)

**Files:** may touch anything needed to make the gate pass (smallest possible diffs); replaces any remaining placeholder barrels; un-skips Task B's recurrence-dependent tests.

- [ ] **Step 1:** `pnpm install` (only if manifests changed), then `pnpm verify` (lint + typecheck + test + build).
- [ ] **Step 2:** Fix failures with minimal diffs; re-run until green. Record every fix in your result notes.
- [ ] **Step 3:** Confirm `packages/core` coverage: `pnpm --filter @opendoist/core exec vitest run --reporter=verbose` — golden tables present (≥60 quick-add rows, all dossier recurrence rows, canonical filter queries).
- [ ] **Step 4:** Do not commit — report ready-for-checkpoint.

## Self-Review (done)

- Spec coverage: phase 1 items (workspaces, Biome, tokens, CI, changelog tooling, LICENSE/README/CONTRIBUTING, brand wired into README) → Tasks A/E/F; phase 2 items (schemas, parser, recurrence, filter) → Tasks A–D. Dockerfile deliberately deferred to phase 3 (nothing runnable to containerize yet; a placeholder image would violate verifiability).
- Placeholder scan: barrels in Task A are explicitly temporary and replaced by B–D/G; no TBDs remain.
- Type consistency: `parseRecurrenceText`/`nextOccurrence`/`findDateSpans`/`resolveNaturalDate` signatures identical in Tasks A–D; ParseContext fields consistent (`now/timezone/weekStart/nextWeekDay/weekendDay/smartDate`).
