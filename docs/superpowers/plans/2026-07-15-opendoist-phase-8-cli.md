# OpenDoist Phase 8: CLI (`opendoist` binary) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via a Workflow: Task A first (sequential), Tasks B–M in parallel (disjoint file sets, no commits, no `pnpm install`), Task N integrates.** Commits happen at integration checkpoints, not per-task, because tasks run concurrently in one working tree. Implementation agents run as Opus; integration/review agents as Fable.

**Goal:** A published-quality `opendoist` CLI in `packages/cli`: `login/logout/whoami`, `add` (full Quick Add grammar via `@opendoist/core` — offline-identical to web/server), `list/today/upcoming [filter]`, `done/reopen/rm` (id or fuzzy match), `projects/sections/labels/filters` (list + add), `search`, `open`, a global `--json` flag with stable machine output and exit codes 0/1/2, tsdown-bundled single-file dist (core inlined), changesets-ready for npm, and baked into the Docker image so `docker exec <ctr> opendoist …` works.

**Architecture:** The CLI is a thin, testable shell around two frozen internal layers: `src/lib/config.ts` (env-paths config file + `OPENDOIST_URL`/`OPENDOIST_TOKEN` env precedence) and `src/lib/api.ts` (typed fetch client — **the only file that knows server routes/DTO shapes**). Every command lives in its own `src/commands/*.ts` module registered onto one commander program; parsing/validation reuses `@opendoist/core` (`parseQuickAdd`, `parseFilter`) so behavior matches the web app and server exactly. All human output flows through `src/lib/format.ts`; all process output through the mockable `io` object — which is what makes mocked-fetch tests for every command cheap.

**Tech Stack:** commander 15 · env-paths 4 · cli-table3 0.6 · `node:util` `styleText` (zero-dep colors) · tsdown 0.22 (Rolldown bundler, inlines `@opendoist/core` + all deps) · Vitest 4 · changesets 2.31 (npm publish, CLI only). Node ≥22, TypeScript strict, Biome.

**Reference documents (already in repo, read before your task):**
- Spec: `docs/superpowers/specs/2026-07-15-opendoist-design.md` — §3.4 (CLI), §3.2 (API surface), §2.3 (Quick Add grammar), §2.4 (filter language), §3.5 (port 7968, env, Docker)
- Dossier: `docs/superpowers/research/2026-07-15-opendoist-research.md` — §3.6 (CLI stack), §3.7 (tsdown/changesets), §1.7 (filter queries), §1.9 (Todoist API shapes we mirror)
- Frozen core contract: `packages/core/src/types.ts` (authoritative — import, never redefine)

## Global Constraints

- Priorities stored **1 = highest (p1) … 4 = default (p4)** everywhere, including CLI output and JSON.
- Server default port **7968**; env vars use the **`OPENDOIST_`** prefix; API tokens are prefixed **`od_`**.
- Radii 5px/10px, Kale `#4c7a45` accent, focus ring `#1f60c2` — web-only tokens, listed for cross-phase consistency; the CLI maps semantic colors to terminal ANSI names (see Task B), never hex.
- TypeScript `strict`, no `any` (Biome `noExplicitAny: error`), `verbatimModuleSyntax`. Biome formatting: single quotes, semicolons as-needed, 2-space indent, line width 100.
- Tests colocated `src/**/*.test.ts`, run by Vitest; every command gets mocked-fetch tests.
- License AGPL-3.0. Conventional commit messages (integration checkpoints only).
- **Parallel-execution rules:** builders touch ONLY their listed files; never run `pnpm install` (Task A declares all deps and installs once); never `git commit`. If a catalog version fails to resolve, set it to the latest published version (`pnpm view <pkg> version`) and record the change in your result notes.
- **CLI-specific invariants (frozen by this plan):**
  - Exit codes: **0** success · **1** any error (usage, network, API, aborted confirmation) · **2** auth (no credentials, 401, 403).
  - `--json` is a global flag: success → the documented JSON value on stdout; failure → `{"ok":false,"error":{"code","message"[,"status"]}}` on stdout, exit code still 1/2. Human errors go to stderr as `error: …` + optional `hint: …`.
  - Every server route/DTO lives ONLY in `src/lib/api.ts`. Command files call typed client methods — this is what makes phase-3 drift a one-file fix.
  - Wire format assumption: snake_case JSON, cursor pagination `{results, next_cursor}` (spec §3.2). AS-BUILT CHECK in Tasks A/N reconciles against the real server.
  - Human output: no emojis. Allowed glyphs: `✓` (done), `○`/`●` (checkbox), `★` (favorite), `·` (separator).
  - Command tests must NOT snapshot human table layout (only `format.test.ts` may) — they assert `--json` output exactly and human output by substring, so Task B's formatter can evolve without breaking Tasks C–J.

---

### Task A: CLI scaffold + frozen contracts (SEQUENTIAL — everything depends on this)

**Files:**
- Edit: `pnpm-workspace.yaml` (catalog additions only), `package.json` (root: add changeset script + devDep)
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/tsdown.config.ts`, `packages/cli/vitest.config.ts`
- Create: `packages/cli/src/index.ts`, `packages/cli/src/program.ts`
- Create: `packages/cli/src/lib/errors.ts`, `packages/cli/src/lib/config.ts`, `packages/cli/src/lib/api.ts`, `packages/cli/src/lib/context.ts`, `packages/cli/src/lib/prompt.ts`, `packages/cli/src/lib/format.ts` (typed stub)
- Create: `packages/cli/src/test/harness.ts`
- Create stubs (each replaced wholesale by its owning task): `packages/cli/src/commands/auth.ts`, `add.ts`, `views.ts`, `mutate.ts`, `projects.ts`, `labels.ts`, `search.ts`, `open.ts`

**Interfaces (produces — FROZEN for Tasks B–M):** everything below.

- [ ] **Step 0: AS-BUILT CHECKS (record findings in result notes):**
  - `grep -n "export function parseFilter" packages/core/src/filter/*.ts` must hit (phase 1–2 Task D landed). If core's filter module exports different names, note them — Tasks E/H adapt imports, contracts here stay.
  - `grep -rn "tasks/quick\|tasks/completed" apps/server/src` (phase 3+ output). Reconcile the route table in `api.ts` (Step 6) with the real paths/casing before freezing — note there is NO server-side filter endpoint anywhere (`/tasks/filter` does not exist; phase 5 evaluates filter queries client-side and so does this CLI, see Task E). If `apps/server` does not exist yet, keep the table as written — Task N reconciles.
  - Confirm catalog entries below resolve (`pnpm view commander version` etc.).

- [ ] **Step 1: Catalog + root manifest edits**

Append to the `catalog:` block of `pnpm-workspace.yaml` (keep existing entries untouched):

```yaml
  commander: ^15.0.0
  env-paths: ^4.0.0
  cli-table3: ^0.6.5
  tsdown: ^0.22.8
  '@changesets/cli': ^2.31.0
```

Root `package.json`: add to `scripts`: `"changeset": "changeset"`; add to `devDependencies`: `"@changesets/cli": "catalog:"`.

- [ ] **Step 2: `packages/cli/package.json` (verbatim)**

```json
{
  "name": "opendoist",
  "version": "0.1.0",
  "description": "Command-line client for OpenDoist, the self-hosted keyboard-first task manager",
  "license": "AGPL-3.0-only",
  "type": "module",
  "bin": { "opendoist": "./dist/index.js" },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=22" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/pranav-karra-3301/opendoist.git",
    "directory": "packages/cli"
  },
  "homepage": "https://github.com/pranav-karra-3301/opendoist#readme",
  "bugs": "https://github.com/pranav-karra-3301/opendoist/issues",
  "keywords": ["opendoist", "todoist", "tasks", "todo", "cli", "self-hosted"],
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm build"
  },
  "devDependencies": {
    "@opendoist/core": "workspace:*",
    "@types/node": "catalog:",
    "cli-table3": "catalog:",
    "commander": "catalog:",
    "env-paths": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**Deliberate:** there is NO `dependencies` field. tsdown externalizes only `dependencies`/`peerDependencies`, so with everything in `devDependencies` the bundle inlines commander, env-paths, cli-table3, `@opendoist/core` AND core's transitive deps (zod, chrono-node, date-fns, …). The published tarball and the Docker-copied `dist/index.js` are fully self-contained (node builtins excepted). Never move a package to `dependencies`.

- [ ] **Step 3: Build/test configs (verbatim)**

`packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "resolveJsonModule": true },
  "include": ["src", "tsdown.config.ts"]
}
```

`packages/cli/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
})
```

`packages/cli/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
```

- [ ] **Step 4: `src/lib/errors.ts` (verbatim)**

```ts
export type CliErrorCode = 'auth' | 'network' | 'api' | 'usage' | 'error'

export class CliError extends Error {
  readonly exitCode: number
  readonly code: CliErrorCode
  readonly hint: string | null
  constructor(message: string, opts: { exitCode?: number; code?: CliErrorCode; hint?: string | null } = {}) {
    super(message)
    this.name = 'CliError'
    this.exitCode = opts.exitCode ?? 1
    this.code = opts.code ?? 'error'
    this.hint = opts.hint ?? null
  }
}
export class AuthError extends CliError {
  constructor(message: string, hint: string | null = 'run `opendoist login` to (re)authenticate') {
    super(message, { exitCode: 2, code: 'auth', hint })
    this.name = 'AuthError'
  }
}
export class NetworkError extends CliError {
  constructor(message: string, hint: string | null = 'is the server up and the URL correct? (offline?)') {
    super(message, { code: 'network', hint })
    this.name = 'NetworkError'
  }
}
export class ApiError extends CliError {
  constructor(message: string, readonly status: number, readonly problem: unknown = null) {
    super(message, { code: 'api' })
    this.name = 'ApiError'
  }
}
export class UsageError extends CliError {
  constructor(message: string, hint: string | null = null) {
    super(message, { code: 'usage', hint })
    this.name = 'UsageError'
  }
}
```

- [ ] **Step 5: `src/lib/config.ts` (verbatim)** — config file at `~/.config/opendoist/config.json` on Linux (XDG); env-paths gives platform-correct dirs on macOS/Windows. `OPENDOIST_CONFIG_PATH` is a test/escape-hatch override.

```ts
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import envPaths from 'env-paths'

export interface CliConfig {
  url: string
  token: string
}
export type CredentialSource = 'env' | 'config' | 'mixed'
export interface Connection extends CliConfig {
  source: CredentialSource
}

/** Adds a scheme when missing (http for localhost/loopback, https otherwise), strips trailing slashes. */
export function normalizeUrl(raw: string): string {
  let url = raw.trim()
  if (url === '') return url
  if (!/^https?:\/\//i.test(url)) {
    const isLocal = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url)
    url = `${isLocal ? 'http' : 'https'}://${url}`
  }
  return url.replace(/\/+$/, '')
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENDOIST_CONFIG_PATH
  if (override !== undefined && override !== '') return override
  return join(envPaths('opendoist', { suffix: '' }).config, 'config.json')
}

export function readConfigFile(env: NodeJS.ProcessEnv = process.env): CliConfig | null {
  try {
    const record = JSON.parse(readFileSync(configFilePath(env), 'utf8')) as Record<string, unknown>
    if (typeof record?.url !== 'string' || typeof record?.token !== 'string') return null
    return { url: normalizeUrl(record.url), token: record.token }
  } catch {
    return null
  }
}

/** Writes config with 0600 perms (0700 dir); chmod again because writeFileSync mode only applies on create. */
export function writeConfigFile(config: CliConfig, env: NodeJS.ProcessEnv = process.env): string {
  const path = configFilePath(env)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify({ url: normalizeUrl(config.url), token: config.token }, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

export function deleteConfigFile(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    rmSync(configFilePath(env))
    return true
  } catch {
    return false
  }
}

/** Precedence: OPENDOIST_URL / OPENDOIST_TOKEN env vars > config file. Null when either half is missing. */
export function resolveConnection(env: NodeJS.ProcessEnv = process.env): Connection | null {
  const file = readConfigFile(env)
  const envUrl = env.OPENDOIST_URL ? normalizeUrl(env.OPENDOIST_URL) : null
  const envToken = env.OPENDOIST_TOKEN ? env.OPENDOIST_TOKEN : null
  const url = envUrl ?? file?.url ?? null
  const token = envToken ?? file?.token ?? null
  if (url === null || token === null) return null
  const source: CredentialSource =
    envUrl !== null && envToken !== null ? 'env' : envUrl === null && envToken === null ? 'config' : 'mixed'
  return { url, token, source }
}
```

- [ ] **Step 6: `src/lib/api.ts` (verbatim)** — DTOs + typed client. The resource methods at the bottom ARE the route table — the CLI's single source of truth for server paths. AS-BUILT CHECK: reconcile every method's path/verb/param/DTO casing against `apps/server` routes at execution time (Step 0 / Task N); fix drift HERE ONLY, never in command files.

```ts
import type { Priority } from '@opendoist/core'
import { ApiError, AuthError, NetworkError } from './errors'

// DTOs listed compactly for plan brevity — after pasting, `pnpm lint:fix` expands to house style.
export interface DueDto { date: string; time: string | null; string: string; is_recurring: boolean }
export interface TaskDto {
  id: string; content: string; description: string
  project_id: string; section_id: string | null; parent_id: string | null
  priority: Priority; due: DueDto | null; deadline_date: string | null; duration_min: number | null
  labels: string[]; child_order: number; day_order: number; uncompletable: boolean
  completed_at: string | null; created_at: string // phase 3's field name — NOT Todoist's added_at
}
export interface ProjectDto {
  id: string; name: string; color: string; parent_id: string | null; child_order: number
  is_favorite: boolean; is_archived: boolean; is_inbox: boolean
}
export interface SectionDto { id: string; project_id: string; name: string; section_order: number }
export interface LabelDto { id: string; name: string; color: string; item_order: number; is_favorite: boolean }
export interface FilterDto {
  id: string; name: string; query: string; color: string; item_order: number; is_favorite: boolean
}
/** phase 3's GET /user returns id/name/email/two_factor_enabled/created_at — NO timezone
 *  (timezone lives in the /user/settings document; the CLI uses the system timezone). */
export interface UserDto { id: string; email: string; name: string }
export interface InfoDto { version: string; [key: string]: unknown }
/** one hit from phase 3's GET /search */
export interface SearchHitDto { task: TaskDto; matched_in: 'task' | 'comment' }
export interface Page<T> { results: T[]; next_cursor: string | null }

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Query = Record<string, string | number | boolean | undefined>

export class ApiClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string | null,
  ) {}

  async request<T>(method: HttpMethod, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.token !== null) headers.authorization = `Bearer ${this.token}`
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    let res: Response
    try {
      res = await fetch(url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
    } catch (cause) {
      const reason = cause instanceof Error && cause.cause instanceof Error ? cause.cause.message : 'fetch failed'
      throw new NetworkError(`cannot reach ${this.baseUrl} (${reason})`)
    }
    if (res.status === 401)
      throw new AuthError(
        'unauthorized (401): token missing, expired, or revoked',
        'run `opendoist login` with a fresh od_ token from Settings → Integrations',
      )
    if (res.status === 403)
      throw new AuthError('forbidden (403): token lacks the required scope', 'create a token with read_write scope')
    if (!res.ok) {
      let detail = res.statusText
      let problem: unknown = null
      try {
        problem = await res.json()
        const p = problem as { title?: string; detail?: string }
        detail = p.detail ?? p.title ?? detail
      } catch {} // non-JSON error body
      throw new ApiError(`${method} ${path} failed (${res.status}): ${detail}`, res.status, problem)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  /** Drains cursor pagination: {results, next_cursor} until next_cursor is null.
   *  Default page size 200; callers may override via query.limit (search caps at 50 server-side). */
  async listAll<T>(path: string, query: Query = {}): Promise<T[]> {
    const out: T[] = []
    let cursor: string | null = null
    do {
      const page: Page<T> = await this.request('GET', path, { query: { limit: 200, ...query, cursor: cursor ?? undefined } })
      out.push(...page.results)
      cursor = page.next_cursor
    } while (cursor !== null)
    return out
  }

  // resource methods — compact for plan brevity; `pnpm lint:fix` after pasting.
  // NOTE: there is NO /tasks/filter endpoint — filter queries are evaluated locally (Task E).
  private id = (id: string) => encodeURIComponent(id)
  info(): Promise<InfoDto> { return this.request('GET', '/api/v1/info') }
  me(): Promise<UserDto> { return this.request('GET', '/api/v1/user') }
  quickAdd(text: string): Promise<TaskDto> { return this.request('POST', '/api/v1/tasks/quick', { body: { text } }) }
  listTasks(query: { project_id?: string } = {}): Promise<TaskDto[]> { return this.listAll('/api/v1/tasks', query) } // open tasks only
  listCompletedTasks(query: { project_id?: string } = {}): Promise<TaskDto[]> { return this.listAll('/api/v1/tasks/completed', query) } // completed listing is its OWN route — no ?completed= param exists
  getTask(id: string): Promise<TaskDto> { return this.request('GET', `/api/v1/tasks/${this.id(id)}`) }
  closeTask(id: string): Promise<void> { return this.request('POST', `/api/v1/tasks/${this.id(id)}/close`) }
  reopenTask(id: string): Promise<void> { return this.request('POST', `/api/v1/tasks/${this.id(id)}/reopen`) }
  deleteTask(id: string): Promise<void> { return this.request('DELETE', `/api/v1/tasks/${this.id(id)}`) }
  listProjects(): Promise<ProjectDto[]> { return this.listAll('/api/v1/projects') }
  createProject(body: { name: string; color?: string; parent_id?: string }): Promise<ProjectDto> { return this.request('POST', '/api/v1/projects', { body }) }
  listSections(query: { project_id?: string } = {}): Promise<SectionDto[]> { return this.listAll('/api/v1/sections', query) }
  createSection(body: { name: string; project_id: string }): Promise<SectionDto> { return this.request('POST', '/api/v1/sections', { body }) }
  listLabels(): Promise<LabelDto[]> { return this.listAll('/api/v1/labels') }
  createLabel(body: { name: string; color?: string }): Promise<LabelDto> { return this.request('POST', '/api/v1/labels', { body }) }
  listFilters(): Promise<FilterDto[]> { return this.listAll('/api/v1/filters') }
  createFilter(body: { name: string; query: string; color?: string }): Promise<FilterDto> { return this.request('POST', '/api/v1/filters', { body }) }
  /** phase 3's search: param `q` (NOT `query`), limit ≤ 50, results are {task, matched_in} wrappers */
  async searchTasks(q: string): Promise<TaskDto[]> {
    const hits = await this.listAll<SearchHitDto>('/api/v1/search', { q, limit: 50 })
    return hits.map((hit) => hit.task)
  }
}
```

- [ ] **Step 7: `src/lib/context.ts` (verbatim)** — mockable io, command context, error-to-exit-code wrapper.

```ts
import { DEFAULT_PARSE_CONTEXT_SETTINGS, dateInTz, type ParseContext } from '@opendoist/core'
import type { Command } from 'commander'
import { ApiClient } from './api'
import { type Connection, resolveConnection } from './config'
import { ApiError, AuthError, CliError } from './errors'

/** All process output goes through io so tests can capture it (vi.spyOn). */
export const io = {
  out(text: string): void {
    process.stdout.write(`${text}\n`)
  },
  err(text: string): void {
    process.stderr.write(`${text}\n`)
  },
}

export interface FmtOpts {
  color: boolean
  /** YYYY-MM-DD in the user's timezone */
  today: string
  timezone: string
}
export interface CommandContext {
  api: ApiClient
  baseUrl: string
  json: boolean
  connection: Connection
  /** ISO instant · IANA zone (system) */
  now: string
  timezone: string
  fmt: FmtOpts
}

export function globalOpts(command: Command): { json: boolean } {
  return { json: command.optsWithGlobals<{ json?: boolean }>().json === true }
}

export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function shouldColor(): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true
  return process.stdout.isTTY === true
}

/** Throws AuthError (exit 2) when no credentials are resolvable. */
export function createContext(command: Command): CommandContext {
  const { json } = globalOpts(command)
  const connection = resolveConnection()
  if (connection === null)
    throw new AuthError(
      'not logged in: no server URL/token found',
      'run `opendoist login`, or set OPENDOIST_URL and OPENDOIST_TOKEN',
    )
  const now = new Date().toISOString()
  const timezone = systemTimezone()
  const api = new ApiClient(connection.url, connection.token)
  const fmt: FmtOpts = { color: !json && shouldColor(), today: dateInTz(now, timezone), timezone }
  return { api, baseUrl: connection.url, json, connection, now, timezone, fmt }
}

/** ParseContext for core parsers: system clock + timezone, product-default week settings. */
export function coreParseContext(ctx: { now: string; timezone: string }): ParseContext {
  return { now: ctx.now, timezone: ctx.timezone, ...DEFAULT_PARSE_CONTEXT_SETTINGS }
}

/** Wrap every commander .action() handler: maps CliError → output + exit code (0/1/2). */
export function runAction<A extends unknown[]>(
  fn: (...args: [...A, Command]) => Promise<void>,
): (...args: [...A, Command]) => Promise<void> {
  return async (...args) => {
    const command = args[args.length - 1] as Command
    const { json } = globalOpts(command)
    try {
      await fn(...args)
    } catch (error) {
      const e = error instanceof CliError ? error : new CliError(error instanceof Error ? error.message : String(error))
      if (json) {
        const status = e instanceof ApiError ? { status: e.status } : {}
        io.out(JSON.stringify({ ok: false, error: { code: e.code, message: e.message, ...status } }))
      } else {
        io.err(`error: ${e.message}`)
        if (e.hint !== null) io.err(`hint: ${e.hint}`)
      }
      process.exitCode = e.exitCode
    }
  }
}
```

- [ ] **Step 8: `src/lib/prompt.ts` (verbatim)** — prompts go to stderr so `--json` stdout stays clean; tests mock `prompter`.

```ts
import { createInterface } from 'node:readline/promises'

export const prompter = {
  async ask(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return (await rl.question(`${question} `)).trim()
    } finally {
      rl.close()
    }
  },
  async confirm(question: string): Promise<boolean> {
    return /^y(es)?$/i.test(await prompter.ask(`${question} [y/N]`))
  },
}
```

- [ ] **Step 9: `src/lib/format.ts` — typed STUB (verbatim; Task B replaces wholesale, signatures FROZEN)**

```ts
// REPLACED WHOLESALE BY TASK B — minimal typed stand-ins so dependent tasks compile and test.
import type { Priority } from '@opendoist/core'
import type { FilterDto, LabelDto, ProjectDto, SectionDto, TaskDto } from './api'
import type { FmtOpts } from './context'

export interface TaskTableOpts {
  showProject?: boolean
  projectNames?: ReadonlyMap<string, string>
}
export function jsonOut(value: unknown): string { return JSON.stringify(value, null, 2) }
export function relativeDate(date: string, today: string): string { return date === today ? 'today' : date }
export function priorityLabel(priority: Priority, fmt: FmtOpts): string { return `p${priority}` }
export function dueLabel(task: TaskDto, fmt: FmtOpts): string {
  return task.due === null ? '' : `${task.due.date}${task.due.time === null ? '' : ` ${task.due.time}`}`
}
export function taskLine(task: TaskDto, fmt: FmtOpts): string { return `${task.id}  ${task.content}` }
export function taskTable(tasks: TaskDto[], fmt: FmtOpts, opts: TaskTableOpts = {}): string {
  return tasks.map((task) => taskLine(task, fmt)).join('\n')
}
export function groupHeader(text: string, fmt: FmtOpts): string { return text }
export function projectTable(projects: ProjectDto[], fmt: FmtOpts): string {
  return projects.map((p) => `${p.id}  ${p.name}`).join('\n')
}
export function sectionTable(sections: SectionDto[], projectNames: ReadonlyMap<string, string>, fmt: FmtOpts): string {
  return sections.map((s) => `${s.id}  ${s.name}`).join('\n')
}
export function labelTable(labels: LabelDto[], fmt: FmtOpts): string {
  return labels.map((l) => `${l.id}  ${l.name}`).join('\n')
}
export function filterTable(filters: FilterDto[], fmt: FmtOpts): string {
  return filters.map((f) => `${f.id}  ${f.name}  ${f.query}`).join('\n')
}
```

- [ ] **Step 10: `src/program.ts` + `src/index.ts` + command stubs (verbatim)**

`src/program.ts`:

```ts
import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { registerAddCommand } from './commands/add'
import { registerAuthCommands } from './commands/auth'
import { registerLabelFilterCommands } from './commands/labels'
import { registerMutateCommands } from './commands/mutate'
import { registerOpenCommand } from './commands/open'
import { registerProjectCommands } from './commands/projects'
import { registerSearchCommand } from './commands/search'
import { registerViewCommands } from './commands/views'

export const CLI_VERSION: string = pkg.version

export function buildProgram(): Command {
  const program = new Command('opendoist')
  program
    .description('OpenDoist CLI — self-hosted, keyboard-first task manager\nTip: alias od=opendoist')
    .version(CLI_VERSION, '-V, --version')
    .option('--json', 'stable machine-readable JSON on stdout (exit codes: 0 ok, 1 error, 2 auth)')
    .exitOverride()
  registerAuthCommands(program)
  registerAddCommand(program)
  registerViewCommands(program)
  registerMutateCommands(program)
  registerProjectCommands(program)
  registerLabelFilterCommands(program)
  registerSearchCommand(program)
  registerOpenCommand(program)
  return program
}
```

`src/index.ts`:

```ts
#!/usr/bin/env node
import { CommanderError } from 'commander'
import { buildProgram } from './program'

try {
  await buildProgram().parseAsync(process.argv)
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode // --help/--version → 0 via exitOverride; usage errors → 1
  } else {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
```

Each of the 8 `src/commands/*.ts` stubs is exactly (adjust the function name + task letter per file — auth→C, add→D, views→E, mutate→F, projects→G, labels→H, search→I, open→J):

```ts
// REPLACED WHOLESALE BY TASK C
import type { Command } from 'commander'

export function registerAuthCommands(program: Command): void {}
```

- [ ] **Step 11: `src/test/harness.ts` (verbatim — FROZEN; all command tests use it)**

```ts
import { vi } from 'vitest'
import type { ProjectDto, TaskDto } from '../lib/api'
import { io } from '../lib/context'
import { buildProgram } from '../program'

export interface CliRun {
  code: number
  stdout: string
  stderr: string
  lines: string[]
}
/** Run the CLI in-process with captured io; returns exit code + output. */
export async function runCli(argv: string[]): Promise<CliRun> {
  const out: string[] = []
  const errLines: string[] = []
  const outSpy = vi.spyOn(io, 'out').mockImplementation((text) => void out.push(text))
  const errSpy = vi.spyOn(io, 'err').mockImplementation((text) => void errLines.push(text))
  const prevExit = process.exitCode
  process.exitCode = undefined
  try {
    await buildProgram().parseAsync(['node', 'opendoist', ...argv])
  } catch (error) {
    const ce = error as { exitCode?: number }
    process.exitCode = typeof ce.exitCode === 'number' ? ce.exitCode : 1
  } finally {
    outSpy.mockRestore()
    errSpy.mockRestore()
  }
  const code = typeof process.exitCode === 'number' ? process.exitCode : 0
  process.exitCode = prevExit
  return { code, stdout: out.join('\n'), stderr: errLines.join('\n'), lines: out }
}

export interface RouteDef {
  method: string
  path: string
  status?: number
  body?: unknown
  /** all listed params must match exactly */
  query?: Record<string, string>
  /** consume this route after its first match (for pagination sequences) */
  once?: boolean
}
export interface RecordedCall {
  method: string
  url: URL
  body: unknown
  headers: Record<string, string>
}
const JSON_HEADERS = { 'content-type': 'application/json' }
/** Installs a fetch mock (vi.stubGlobal). Call vi.unstubAllGlobals() in afterEach. */
export function installMockFetch(routes: RouteDef[]): RecordedCall[] {
  const calls: RecordedCall[] = []
  const live = [...routes]
  vi.stubGlobal('fetch', async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    calls.push({
      method,
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    const index = live.findIndex(
      (r) =>
        r.method === method &&
        r.path === url.pathname &&
        (r.query === undefined || Object.entries(r.query).every(([k, v]) => url.searchParams.get(k) === v)),
    )
    if (index === -1) {
      const problem = { title: 'not found', detail: `no mock for ${method} ${url.pathname}${url.search}` }
      return new Response(JSON.stringify(problem), { status: 404, headers: JSON_HEADERS })
    }
    const route = live[index] as RouteDef
    if (route.once === true) live.splice(index, 1)
    const status = route.status ?? 200
    if (status === 204) return new Response(null, { status })
    return new Response(JSON.stringify(route.body ?? {}), { status, headers: JSON_HEADERS })
  })
  return calls
}

export const TEST_URL = 'https://od.example.com'
/** Credentials via env; config path pointed at nowhere; colors off. Call vi.unstubAllEnvs() in afterEach. */
export function stubAuthEnv(url: string = TEST_URL): void {
  vi.stubEnv('OPENDOIST_URL', url)
  vi.stubEnv('OPENDOIST_TOKEN', 'od_testtoken123')
  vi.stubEnv('OPENDOIST_CONFIG_PATH', '/nonexistent/opendoist-test/config.json')
  vi.stubEnv('NO_COLOR', '1')
  vi.stubEnv('FORCE_COLOR', '')
}
/** Wrap a list in a single cursor page. */
export function page<T>(results: T[], nextCursor: string | null = null): { results: T[]; next_cursor: string | null } {
  return { results, next_cursor: nextCursor }
}

export function sampleTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'tsk_1', content: 'Submit report', description: '', project_id: 'prj_inbox',
    section_id: null, parent_id: null, priority: 4, due: null, deadline_date: null,
    duration_min: null, labels: [], child_order: 1, day_order: 1, uncompletable: false,
    completed_at: null, created_at: '2026-07-15T12:00:00Z', ...overrides,
  }
}
export function sampleProject(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: 'prj_inbox', name: 'Inbox', color: 'grey', parent_id: null, child_order: 0,
    is_favorite: false, is_archived: false, is_inbox: true, ...overrides,
  }
}
```

- [ ] **Step 12: Install & gate.** Run `cd /Users/pranav/developer/opendoist && pnpm install` (the ONLY install this phase). Then: `pnpm --filter opendoist typecheck` → exit 0; `pnpm --filter opendoist build` → `packages/cli/dist/index.js` exists; `node packages/cli/dist/index.js --version` → `0.1.0`; `--help` → usage text, exit 0 (subcommands appear as Tasks C–J land — registrar stubs register nothing yet); `pnpm lint` → clean (`pnpm lint:fix` for trivia). Do NOT commit.

---

### Task B: Formatters — tables, colors, dates (`format.ts` real implementation)

**Files:**
- Replace wholesale: `packages/cli/src/lib/format.ts`
- Test: `packages/cli/src/lib/format.test.ts`

**Interfaces:** Consumes `api.ts` DTOs, `context.ts` `FmtOpts`, `node:util` `styleText`, `cli-table3`, core's `IsoDateSchema` shapes. Produces the EXACT signatures frozen in Task A Step 9 — do not add/remove/rename exports; richer behavior only.

**Color rules (semantic → ANSI via `styleText`, only when `fmt.color`):**

| Semantic | ANSI style |
|---|---|
| priority p1 / p2 / p3 / p4 (label + checkbox `○`) | `red` / `yellow` / `blue` / `gray` |
| due: overdue (`due.date < fmt.today`) / today / tomorrow / within next 7 days / later | `red` / `green` / `yellow` / `blue` / `gray` |
| deadline chip `{Jul 30}` when past or today | `red` |
| group headers → `bold` · id column → `dim` | |

- [ ] **Step 1: tests first (`format.test.ts`).** Fixed `fmt: FmtOpts = { color: true, today: '2026-07-15', timezone: 'America/New_York' }` and a no-color twin. Cover:
  - `relativeDate`: `('2026-07-15','2026-07-15')→'today'`, `('2026-07-16',…)→'tomorrow'`, `('2026-07-17',…)→'Friday'` (within next 6 days → weekday name), `('2026-07-30',…)→'Jul 30'` (same year), `('2027-03-30',…)→'Mar 30 2027'`, past date → `'Jul 1'` style (still month-day).
  - `priorityLabel(1, color)` contains `[31m` (red) and text `p1`; with `color:false` equals `'p1'` exactly.
  - `dueLabel` on task due `2026-07-14` (overdue) contains red escape; `2026-07-15` green; includes time suffix `09:00` when `due.time='09:00'`; recurring due appends `↻` glyph? — NO: append the plain suffix `(recurring)` in dim, asserted by substring.
  - `taskLine` includes id, `○` checkbox, content, and `@label` / `#Project` absence (labels shown, project only via table opts).
  - `taskTable` with `showProject:true` + `projectNames` map renders project names; without opts renders no project column; empty array → `''`.
  - `projectTable` indents children two spaces per depth under their parent (build order: parents by `child_order`, then children), marks inbox with `(inbox)` and favorites with `★`.
  - `labelTable`/`filterTable`/`sectionTable` include name + color/query columns.
  - `jsonOut` is `JSON.stringify(value, null, 2)` exactly.
  - No trailing whitespace on any emitted line (regex check over output).
- [ ] **Step 2: implement.** `cli-table3` for `projectTable`/`sectionTable`/`labelTable`/`filterTable`/`taskTable` with compact style: `style: { head: [], border: [] }, chars` set to a borderless preset (header row separated by spaces, not box lines) — task lists must read like Todoist views, not SQL consoles. `taskLine` = `` `${paint('dim', id)} ${checkbox} ${content}${meta}` `` where meta pieces (each optional, space-separated, order fixed): priority (only if ≠4), due label, `{deadline}` chip, `#Project` (only when table opts request), `@label` list, `(recurring)`. Helper `paint(style, text)` gates on `fmt.color` and calls `styleText(style, text)` — `import { styleText } from 'node:util'`.
- [ ] **Step 3: verify.** `pnpm --filter opendoist exec vitest run src/lib/format.test.ts` → all pass. `pnpm --filter opendoist typecheck` → exit 0. `pnpm exec biome check packages/cli/src/lib` → clean.

---

### Task C: Auth commands — `login`, `logout`, `whoami` (+ config tests)

**Files:**
- Replace wholesale: `packages/cli/src/commands/auth.ts`
- Test: `packages/cli/src/commands/auth.test.ts`, `packages/cli/src/lib/config.test.ts`

**Interfaces:** Consumes `config.ts`, `api.ts` (`ApiClient`, `InfoDto`, `UserDto`), `context.ts` (`io`, `globalOpts`, `runAction`, `createContext`), `prompt.ts` (`prompter`), `format.ts` (`jsonOut`). Produces `registerAuthCommands(program: Command): void` registering `login`, `logout`, `whoami`.

**Behavior (frozen):**
- `opendoist login [--url <url>] [--token <token>]` — works WITHOUT existing credentials (never calls `createContext`):
  1. `url` = flag or `prompter.ask('Server URL (e.g. https://todo.example.com):')`, then `normalizeUrl`; `token` = flag or `prompter.ask('API token (Settings → Integrations, starts with od_):')`. Either empty → UsageError. Token not starting `od_` → stderr warning, continue.
  2. Probe `new ApiClient(url, null).info()` — NetworkError propagates (exit 1); response without a string `version` → `CliError('… does not look like an OpenDoist server')`. Then validate `new ApiClient(url, token).me()` — 401 → AuthError (exit 2) via the client.
  3. `writeConfigFile({ url, token })`; human output exactly two lines: `✓ logged in to <url> as <email> — OpenDoist v<version>` and `config: <path> (0600)`; `--json` → `jsonOut({ ok: true, url, version, user, config_path })`.
- `opendoist logout` — `deleteConfigFile()`; human `logged out (removed <path>)` or `no saved credentials`; when `process.env.OPENDOIST_TOKEN` is set add stderr `note: OPENDOIST_TOKEN is still set in your environment`; `--json` → `{ ok: true, removed: <bool> }`.
- `opendoist whoami` — `createContext` (exit 2 when unconfigured), then `api.me()` + `api.info()`; human three lines: `<email> (<name>)` / `server: <baseUrl> — OpenDoist v<version>` / `credentials: <source>` (env|config|mixed); `--json` → `{ url, version, token_source, user }`.

- [ ] **Step 1: `config.test.ts`** (uses `vi.stubEnv` + a scratch dir via `mkdtempSync(join(tmpdir(), 'od-cli-'))`): precedence table — env-only, file-only, both (env wins, source `'env'`), env URL + file token (`'mixed'`), neither → null; `normalizeUrl`: trailing slash stripped, `localhost:7968` → `http://localhost:7968`, `todo.example.com` → `https://…`, existing scheme untouched; `writeConfigFile` then `statSync(path).mode & 0o777 === 0o600` (guard `process.platform !== 'win32'`); `readConfigFile` on malformed JSON → null; `OPENDOIST_CONFIG_PATH` override respected.
- [ ] **Step 2: `auth.test.ts`** via harness (`installMockFetch`, `runCli`, mock `prompter` with `vi.spyOn(prompter, 'ask')`), config path stubbed into a scratch temp dir (NOT `stubAuthEnv` for login tests — login must run unauthenticated): login happy path (writes file, output contains `✓ logged in`, exit 0; recorded calls = GET `/api/v1/info` then GET `/api/v1/user` with `authorization: Bearer od_…`); login 401 → exit 2; login against non-OpenDoist JSON (`{}` body) → exit 1 with `does not look like`; `--json` login output parses and has `ok: true`; logout removes the file (exit 0) and reports `removed: false` when absent; whoami with `stubAuthEnv` → `token_source` is `env`, exit 0; whoami with no creds anywhere → exit 2.
- [ ] **Step 3: implement `auth.ts`**; every action wrapped in `runAction`.
- [ ] **Step 4: verify.** `pnpm --filter opendoist exec vitest run src/commands/auth.test.ts src/lib/config.test.ts` → all pass; typecheck + biome clean.

---

### Task D: `add` command + parser round-trip smoke

**Files:**
- Replace wholesale: `packages/cli/src/commands/add.ts`
- Test: `packages/cli/src/commands/add.test.ts`, `packages/cli/src/lib/parser-roundtrip.test.ts`

**Interfaces:** Consumes core `parseQuickAdd`, `context.ts` (`createContext`, `coreParseContext`, `io`, `runAction`), `api.ts` (`quickAdd`), `format.ts` (`taskLine`, `jsonOut`). Produces `registerAddCommand(program: Command): void`.

**Behavior (frozen):**
- `opendoist add <text...>` — variadic; `raw = text.join(' ')` (quotes optional: `opendoist add buy milk tom 4pm p2 #Chores` works).
- Local preview FIRST: `parseQuickAdd(raw, coreParseContext(ctx))`. If `preview.title === ''` → `UsageError('task title is empty after token extraction', 'quote literal text or remove stray tokens')` — and NO network call.
- Submit the RAW text unchanged: `api.quickAdd(raw)` (server re-parses authoritatively with the same core parser — that is the offline-identical contract; the CLI never sends parsed fields).
- Human output: line 1 `✓ added <taskLine(created)>`; line 2 (only when preview found tokens) `  parsed: <joined summary>` where summary lists in order: `p<N>` (≠4 only), `due <due.string>`, `deadline {<date>}`, `#<project>`, `/<section>`, `@<label>…`, `~<durationMin>min`, `<N> reminder(s)`, `uncompletable` — built from the SERVER response where present, preview otherwise.
- `--json` → `jsonOut(createdTaskDto)` verbatim.

- [ ] **Step 1: `add.test.ts`** (harness: `stubAuthEnv` + `installMockFetch`): POST body assertion — `add Submit report tom 4pm p1 #Work` records exactly one call `POST /api/v1/tasks/quick` with body `{ text: 'Submit report tom 4pm p1 #Work' }` (raw, unmodified); success human output contains `✓ added` and the returned content; `--json` output `JSON.parse`s deep-equal to the mocked TaskDto; empty-title input `add p1 #Work` → exit 1, zero recorded fetch calls; server 400 problem-json (`{title:'invalid', detail:'blah'}`) surfaces `blah` in stderr, exit 1; 401 → exit 2.
- [ ] **Step 2: `parser-roundtrip.test.ts`** — pins the CLI's local preview to core-golden behavior with fixed ctx `{ now: '2026-07-15T21:00:00Z', timezone: 'America/New_York', ...DEFAULT_PARSE_CONTEXT_SETTINGS }`. `test.each` rows (assert exactly the listed fields):

| input | title | priority | project | labels | due.date | due.time |
|---|---|---|---|---|---|---|
| `buy milk` | buy milk | 4 | null | [] | — (null due) | — |
| `Submit report tom 4pm p1 #Work` | Submit report | 1 | Work | [] | 2026-07-16 | 16:00 |
| `call mom every mon at 20:00` | call mom | 4 | null | [] | 2026-07-20 | 20:00 |
| `pay rent {aug 1} p2` | pay rent | 2 | null | [] | — | — |
| `email @family @work tod` | email | 4 | null | [family, work] | 2026-07-15 | null |
| `* Flight check-in // gate 30` | Flight check-in | 4 | null | [] | — | — |

  Also assert row 4 `deadline === '2026-08-01'`, row 6 `uncompletable === true` and `description === 'gate 30'`. AS-BUILT CHECK: run these against the real core first (`pnpm --filter @opendoist/core test` is green in repo); if any expectation disagrees with core's implemented goldens (e.g. `every mon` first-occurrence date), core's goldens win — update the table to match core and note it.
- [ ] **Step 3: implement `add.ts`.**
- [ ] **Step 4: verify.** `pnpm --filter opendoist exec vitest run src/commands/add.test.ts src/lib/parser-roundtrip.test.ts` → all pass; typecheck + biome clean.

---

### Task E: View commands — `list`, `today`, `upcoming`

**Files:**
- Replace wholesale: `packages/cli/src/commands/views.ts`
- Test: `packages/cli/src/commands/views.test.ts`

**Interfaces:** Consumes core `parseFilter`, `FilterSyntaxError`, `filterTasks`, `FilterTaskView`, `FilterContext`, `dateInTz`; `context.ts` (`coreParseContext`), `api.ts` (`listTasks`, `listProjects`, `listSections`), `format.ts` (`taskTable`, `groupHeader`, `relativeDate`, `jsonOut`). Produces `registerViewCommands(program: Command): void` registering `list`, `today`, `upcoming`.

**Behavior (frozen):** there is NO server filter endpoint — the CLI evaluates filter queries LOCALLY with core `parseFilter`/`filterTasks` over the full open-task set, exactly like the web app (phase 5 renders filter views client-side; core is bundled into the CLI so behavior is identical).
- Shared `validateQuery(query: string)` — `parseFilter(query)`; `FilterSyntaxError` → `UsageError('filter syntax error at position <N>: <msg>')`; `panes.length > 1` → `UsageError('comma multi-pane filters are not supported in the CLI', 'run each pane as its own command')`; returns the parsed filter.
- Shared `runFilter(ctx, query): Promise<TaskDto[]>` — validate first (no fetch on syntax errors); then fetch `api.listTasks()` + `api.listProjects()` + `api.listSections()` in parallel; map each `TaskDto` → core `FilterTaskView` (`dueDate`/`dueTime` from `task.due`, `isRecurring` from `due.is_recurring`, `projectName`/`sectionName` joined from the fetched lists, `createdAt` from `created_at`); build a `FilterContext` from `coreParseContext(ctx)` + the projects map; `filterTasks(parsed, views, fctx)[0]` (single pane) → map matched ids back to the fetched `TaskDto`s.
- Task sort inside every group (frozen): due date asc (nulls last) → due time asc (nulls last) → priority asc (1 first) → `child_order` asc.
- `opendoist list [query]` — without query: `api.listTasks()` + `api.listProjects()`, grouped by project (`is_inbox` first, then `child_order`), one `groupHeader('#<name>')` + `taskTable` per non-empty group. With query: `runFilter`, single group headed by the query, table with `showProject: true` + `projectNames` from `listProjects()`. `--json` → flat sorted `TaskDto[]` (grouping is presentational only).
- `opendoist today` — `runFilter(ctx, 'overdue | today')`; split client-side on `due.date < fmt.today` → groups `Overdue` (only if non-empty) and `Today`; both empty → `No tasks due today.`; `--json` → flat array, overdue first.
- `opendoist upcoming [--days <n>]` — n integer 1–30, default 7 (else UsageError); `runFilter(ctx, 'overdue | next <n> days')`; groups `Overdue`, then one per calendar day with tasks, headed `` `${relativeDate(day, fmt.today)} · ${day}` ``; `--json` → flat array.

- [ ] **Step 1: tests** (harness; freeze the local-evaluation contract): `today` fetches `GET /api/v1/tasks` + `/api/v1/projects` + `/api/v1/sections` and NOTHING else (assert recorded paths; there is no `/tasks/filter` call to assert); fixtures = one overdue task (`due.date: '2026-01-01'` — any past date is overdue vs the real system today), one dated-today task, one dated ~10 days out → stdout has the `Overdue` line before `Today` and the future task is EXCLUDED (proves core `filterTasks` ran); `upcoming --days 3` includes a today+2 task and excludes the +10 one; `upcoming --days 0` → exit 1, no fetch; bad filter `list "today &"` → exit 1, stderr contains `position`, ZERO fetch calls; multi-pane `list "today, tomorrow"` → exit 1, no fetch; plain `list` groups by project (two projects, header `#Inbox` before `#Work`); `--json` parses to an array in the frozen sort order; empty today → `No tasks due today.`. Compute today-relative fixture dates EXACTLY as the CLI does — `dateInTz(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone)` from `@opendoist/core` (+ its `addDaysIso` for offsets) — so tests are immune to UTC-vs-local drift.
- [ ] **Step 2: implement `views.ts`.**
- [ ] **Step 3: verify.** `pnpm --filter opendoist exec vitest run src/commands/views.test.ts` → all pass; typecheck + biome clean.

---

### Task F: Mutation commands — `done`, `reopen`, `rm`

**Files:**
- Replace wholesale: `packages/cli/src/commands/mutate.ts`
- Test: `packages/cli/src/commands/mutate.test.ts`

**Interfaces:** Consumes `context.ts`, `prompt.ts`, `api.ts` (`getTask`, `listTasks`, `listCompletedTasks`, `closeTask`, `reopenTask`, `deleteTask`), `format.ts` (`taskLine`, `dueLabel`, `jsonOut`). Produces `registerMutateCommands(program: Command): void` registering `done`, `reopen`, `rm`, each `<task>` argument + `-y, --yes` flag.

**Behavior (frozen):** shared resolver `resolveTask(ctx, ref, opts: { completedPool: boolean }): Promise<{ task: TaskDto; fuzzy: boolean }>`:
1. Exact-id attempt `api.getTask(ref)`; `ApiError` with `status === 404` → fall through to fuzzy; other errors propagate.
2. Fuzzy: pool = `opts.completedPool ? await api.listCompletedTasks() : await api.listTasks()` (completed listing is its own route `/api/v1/tasks/completed` — there is no `?completed=` param); matches = case-insensitive substring of `content`. 0 → `CliError('no task matching "<ref>"')`; ≥2 → print up to 10 candidates to stderr as `  <id>  <content>` then `CliError('ambiguous match — pass the task id')`; 1 → return `{ task, fuzzy: true }`.
- Confirmation: fuzzy matches always confirm (`prompter.confirm('<verb> "<content>" (<id>)?')`) unless `--yes`; `rm` confirms even on exact id unless `--yes`; declined → `CliError('aborted')` (exit 1, no mutation call).
- `done <task>` (active pool): `api.closeTask(id)`; when the resolved task had `due?.is_recurring === true`, re-fetch `api.getTask(id)` and, if still active with a due, append human `→ next occurrence: <dueLabel>` and JSON `next_due`. Human `✓ completed <content> (<id>)`; `--json` → `{ ok: true, id, action: 'closed', next_due?: DueDto }`.
- `reopen <task>` (COMPLETED pool): `api.reopenTask(id)`; `✓ reopened …`; JSON `action: 'reopened'`. · `rm <task>` (active pool): `api.deleteTask(id)`; `✓ deleted …`; JSON `action: 'deleted'`.

- [ ] **Step 1: tests** (harness + `vi.spyOn(prompter, 'confirm')`): exact id `done tsk_1` → calls GET `/api/v1/tasks/tsk_1` then POST `…/close`, no confirm; fuzzy `done report` (listTasks page with one match) + confirm true → close called; confirm false → exit 1 `aborted`, no POST; ambiguous (two matches) → exit 1, stderr lists both ids, no POST; `rm tsk_1` without `--yes` prompts even on exact id; `rm tsk_1 --yes` skips prompt, DELETE recorded; `reopen foo` fetches its fuzzy pool from `/api/v1/tasks/completed` (assert the recorded path; no `completed=` query param exists); recurring done: task fixture `due: { date: …, time: null, string: 'every day', is_recurring: true }`, mocked re-fetch returns advanced due → human output contains `next occurrence`, JSON contains `next_due`; `--json` for plain done equals `{ ok: true, id: 'tsk_1', action: 'closed' }`; 404-on-both-paths ref `done zzz` → exit 1 `no task matching`.
- [ ] **Step 2: implement `mutate.ts`.**
- [ ] **Step 3: verify.** `pnpm --filter opendoist exec vitest run src/commands/mutate.test.ts` → all pass; typecheck + biome clean.

---

### Task G: `projects` + `sections` (list + add)

**Files:**
- Replace wholesale: `packages/cli/src/commands/projects.ts`
- Test: `packages/cli/src/commands/projects.test.ts`

**Interfaces:** Consumes `context.ts`, `api.ts` (`listProjects`, `createProject`, `listSections`, `createSection`), `format.ts` (`projectTable`, `sectionTable`, `jsonOut`). Produces `registerProjectCommands(program: Command): void` registering `projects` (default action = list) with subcommand `projects add`, and `sections` with `sections add`.

**Behavior (frozen):**
- `opendoist projects` — `listProjects()`; exclude `is_archived`; human `projectTable` (tree order: inbox first, then roots by `child_order`, children indented beneath parents); `--json` → raw `ProjectDto[]` (archived excluded, same order).
- `opendoist projects add <name> [--color <name>] [--parent <projectRef>]` — `--parent` resolved against `listProjects()` by exact id, else case-insensitive unique name (0 → `CliError('no project named …')`, ≥2 → ambiguous CliError); POST body `{ name, color?, parent_id? }`; human `✓ created project <name> (<id>)`; `--json` → created DTO.
- `opendoist sections [--project <projectRef>]` — resolve ref (as above) when given and pass `project_id`; human `sectionTable` with project-name column (map from `listProjects()`); `--json` → `SectionDto[]`.
- `opendoist sections add <name> --project <projectRef>` — `--project` REQUIRED (commander `.requiredOption`); POST `{ name, project_id }`; outputs like projects add.

- [ ] **Step 1: tests** (harness): projects list human output has parent before indented child and `(inbox)` marker; archived project absent; `projects add Groceries --color green` POSTs `{ name: 'Groceries', color: 'green' }`; `projects add Sub --parent Work` resolves name→id from mocked list, POSTs `parent_id`; unknown parent → exit 1 no POST; `sections --project Work` sends `project_id` query param; `sections add Admin --project Work` POSTs `{ name: 'Admin', project_id: 'prj_work' }`; missing `--project` on sections add → exit 1 (commander requiredOption; assert code 1 via harness); `--json` outputs parse to arrays/objects.
- [ ] **Step 2: implement `projects.ts`.**
- [ ] **Step 3: verify.** `pnpm --filter opendoist exec vitest run src/commands/projects.test.ts` → all pass; typecheck + biome clean.

---

### Task H: `labels` + `filters` (list + add)

**Files:**
- Replace wholesale: `packages/cli/src/commands/labels.ts`
- Test: `packages/cli/src/commands/labels.test.ts`

**Interfaces:** Consumes `context.ts`, `api.ts` (`listLabels`, `createLabel`, `listFilters`, `createFilter`), core `parseFilter`/`FilterSyntaxError`, `format.ts` (`labelTable`, `filterTable`, `jsonOut`). Produces `registerLabelFilterCommands(program: Command): void` registering `labels` (+ `labels add`) and `filters` (+ `filters add`).

**Behavior (frozen):**
- `opendoist labels` — `labelTable` ordered by `item_order`; `--json` → `LabelDto[]`.
- `opendoist labels add <name> [--color <name>]` — POST `{ name, color? }`; `✓ created label @<name> (<id>)`.
- `opendoist filters` — `filterTable` (name + query + `★` favorites) by `item_order`; `--json` → `FilterDto[]`.
- `opendoist filters add <name> <query> [--color <name>]` — validate `parseFilter(query)` FIRST (`FilterSyntaxError` → `UsageError('filter syntax error at position <N>: <msg>')`; multi-pane IS allowed here — saved filters support panes); then POST `{ name, query, color? }`; `✓ created filter <name> (<id>)`.

- [ ] **Step 1: tests** (harness): labels list renders both fixtures; `labels add errands --color yellow` POST body exact; `filters add Urgent "(p1 | p2) & 14 days"` POSTs the raw query; multi-pane `filters add Split "#Inbox & no date, view all"` succeeds (POST recorded); invalid `filters add Bad "today &"` → exit 1, ZERO fetch calls, stderr contains `position`; `--json` outputs parse.
- [ ] **Step 2: implement `labels.ts`.**
- [ ] **Step 3: verify.** `pnpm --filter opendoist exec vitest run src/commands/labels.test.ts` → all pass; typecheck + biome clean.

---

### Task I: `search`

**Files:**
- Replace wholesale: `packages/cli/src/commands/search.ts`
- Test: `packages/cli/src/commands/search.test.ts`

**Interfaces:** Consumes `context.ts`, `api.ts` (`searchTasks`, `listProjects`), `format.ts` (`taskTable`, `jsonOut`). Produces `registerSearchCommand(program: Command): void`.

**Behavior (frozen):** `opendoist search <query...> [-n, --limit <n>]` — joined variadic query; limit default 30 (integer ≥1, validate → UsageError); `api.searchTasks(q)` (server FTS5), client-side slice to limit; human: `taskTable` with `showProject: true` (+ names from `listProjects()`), footer line `<shown> of <total> results` when truncated; zero results → `no results for "<q>"` (exit 0); `--json` → sliced `TaskDto[]`.

- [ ] **Step 1: tests** (harness): `search meeting notes` records GET `/api/v1/search` with query param `q === 'meeting notes'` (phase 3's param — NOT `query`); fixture pages contain `{task, matched_in}` wrapper hits (`page([{ task: sampleTask(...), matched_in: 'task' }])`) and the unwrapped task content appears in stdout; `--limit 1` with 2 fixtures shows one + footer `1 of 2 results`; zero results → exit 0 with `no results`; `--json` parses to array length 1 under limit 1; 401 → exit 2.
- [ ] **Step 2: implement `search.ts`.**
- [ ] **Step 3: verify.** `pnpm --filter opendoist exec vitest run src/commands/search.test.ts` → all pass; typecheck + biome clean.

---

### Task J: `open` (browser deep-link)

**Files:**
- Replace wholesale: `packages/cli/src/commands/open.ts`
- Test: `packages/cli/src/commands/open.test.ts`

**Interfaces:** Consumes `context.ts`, `api.ts` (`getTask`, `listTasks`), `format.ts` (`jsonOut`), `node:child_process` `spawn`. Produces `registerOpenCommand(program: Command): void` AND the mockable launcher (exported for tests):

```ts
export const launcher = {
  open(url: string): void {
    const [cmd, args] =
      process.platform === 'darwin'
        ? ['open', [url] as string[]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : ['xdg-open', [url]]
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  },
}
```

**Behavior (frozen):** `opendoist open [target]`:
- Target → path mapping: none → `/`; `inbox`/`today`/`upcoming` (case-insensitive) → `/inbox`, `/today`, `/upcoming`; anything else → task resolution (exact id via `getTask`, 404 → fuzzy over active `listTasks` requiring a UNIQUE match, 0/≥2 → CliError as Task F but never confirms) → `/task/<id>`.
- AS-BUILT CHECK: verify the web app's routes in `apps/web/src` at execution time (phase 4/5 output) — adjust the three view paths and the task path (`/task/:id` vs `/app/task/:id`) in ONE constant map at the top of `open.ts`.
- Human: prints `opening <fullUrl>` and calls `launcher.open(fullUrl)`. `--json`: prints `jsonOut({ url: fullUrl })` and does NOT launch (scripting-safe).

- [ ] **Step 1: tests** (harness + `vi.spyOn(launcher, 'open').mockImplementation(() => {})`): `open` → launcher called with `https://od.example.com/`; `open today` → `…/today`, no API calls recorded; `open tsk_1` (mock GET task) → `…/task/tsk_1`; `open report` fuzzy-unique → resolved id in URL; ambiguous → exit 1, launcher NOT called; `open today --json` → stdout parses to `{ url: '…/today' }` and launcher NOT called.
- [ ] **Step 2: implement `open.ts`.**
- [ ] **Step 3: verify.** `pnpm --filter opendoist exec vitest run src/commands/open.test.ts` → all pass; typecheck + biome clean.

---

### Task K: API-client behavior tests

**Files:**
- Test: `packages/cli/src/lib/api.test.ts`

**Interfaces:** Consumes `api.ts`, `errors.ts`, harness (`installMockFetch`, `page`, `sampleTask`). Tests only — MUST NOT edit `api.ts`; if a test reveals a genuine contract bug, mark it `test.fails` with a `// FIXME(Task N):` comment and report it in result notes for the integration gate to fix.

- [ ] **Step 1: write `api.test.ts`** against a direct `new ApiClient('https://od.example.com', 'od_tok')` (no CLI invocation):
  - Auth header: requests record `headers.authorization === 'Bearer od_tok'`; token `null` → no authorization key.
  - URL building: `request('GET', '/api/v1/tasks', { query: { project_id: 'p1', completed: undefined } })` → URL has `project_id=p1` and NO `completed` param.
  - 401 → rejects `AuthError` with `exitCode === 2` and hint mentioning `opendoist login`; 403 → AuthError.
  - Problem-JSON: 422 body `{ title: 'Unprocessable', detail: 'bad due string' }` → `ApiError` message contains `bad due string`, `status === 422`, `problem` preserved. Non-JSON error body (stub fetch directly: `Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } })`) → ApiError mentions `500`, no parse crash.
  - Network failure: fetch rejecting `new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') })` → `NetworkError` containing `cannot reach https://od.example.com`, hint mentions offline.
  - 204 → resolves `undefined` (closeTask path).
  - Pagination: two `once: true` routes on `/api/v1/tasks` — `page([t1], 'cur2')` then (query `{ cursor: 'cur2' }`) `page([t2], null)` → `listTasks()` resolves `[t1, t2]`, exactly 2 calls.
  - `quickAdd('x')` sends `content-type: application/json` and body `{ text: 'x' }`.
- [ ] **Step 2: verify.** `pnpm --filter opendoist exec vitest run src/lib/api.test.ts` → all pass; typecheck + biome clean.

---

### Task L: changesets + CLI README (npm-publish readiness)

**Files:**
- Create: `.changeset/config.json`, `.changeset/README.md`, `.changeset/opendoist-cli-initial.md`, `packages/cli/README.md`

- [ ] **Step 1: `.changeset/config.json` (verbatim):**

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [],
  "privatePackages": { "version": false, "tag": false }
}
```

(All workspace packages except `opendoist` are `"private": true`, so changesets versions/publishes only the CLI — per dossier §4.9/§6: tag-driven releases for the app, changesets ONLY for npm-published packages. If the schema URL's pinned version 404s at execution time, point it at the installed `@changesets/config` version.)

- [ ] **Step 2: `.changeset/README.md`** — 10 lines: what changesets is, `pnpm changeset` to add one, release flow: `pnpm changeset version && pnpm install && pnpm --filter opendoist build && pnpm --filter opendoist publish` (documented only — NEVER run publish in this phase).
- [ ] **Step 3: `.changeset/opendoist-cli-initial.md` (verbatim):**

```md
---
"opendoist": minor
---

Initial release of the OpenDoist CLI: login/logout/whoami, add (full Quick Add grammar, offline-identical to the web app), list/today/upcoming with filter queries, done/reopen/rm with fuzzy matching, projects/sections/labels/filters, search, open, and a global --json mode with stable exit codes (0 ok, 1 error, 2 auth).
```

- [ ] **Step 4: `packages/cli/README.md`** — the npm landing page; write it fully (no placeholders), sections in order:
  - `# opendoist` + one-liner; Install (`npm install -g opendoist`, Node ≥22, suggest `alias od=opendoist` in shell rc); Quickstart (`opendoist login` walkthrough — server URL + `od_…` token from Settings → Integrations — then `opendoist add "Submit report tom 4pm p1 #Work @email"`).
  - Command reference table: every command from this plan, one-line description + example.
  - Filters: 5 example queries (`today`, `overdue | today`, `(p1 | p2) & 14 days`, `#Work & no date`, `@home*`); note comma-panes unsupported in `list`.
  - Configuration: config path per-OS (Linux `~/.config/opendoist/config.json`, macOS `~/Library/Preferences/opendoist/config.json`, Windows `%APPDATA%\opendoist\Config\config.json`), chmod 600, env overrides `OPENDOIST_URL`/`OPENDOIST_TOKEN` (beat the file), `OPENDOIST_CONFIG_PATH`, `NO_COLOR`/`FORCE_COLOR`.
  - Scripting: per-command `--json` shape table, exit codes 0/1/2, example `opendoist today --json | jq '.[].content'`.
  - Docker: `docker exec -e OPENDOIST_TOKEN=od_… <container> opendoist today` (URL defaults to the in-container server). Priorities note: `p1` is highest (1–4; Todoist's API inverts this — ours does not). License AGPL-3.0-only + repo link.
- [ ] **Step 5: verify.** `pnpm exec biome check .changeset packages/cli/README.md` → clean (or excluded by Biome config — record which); `pnpm changeset status` → exits 0 listing the pending `opendoist` minor bump (if it needs a git baseline: `pnpm changeset status --since=HEAD` — record output).

---

### Task M: Dockerfile — bake the CLI into the server image

**Files:**
- Edit: `Dockerfile` (repo root)

AS-BUILT CHECK (do this FIRST — the Dockerfile is phase-3/9 output and may drift):
- Read the root `Dockerfile`. Identify (a) the pnpm build stage name (expect something like `build` or `builder` based on `FROM node:22-alpine AS <name>`), (b) the workspace root inside the stage (expect `/app`), (c) the runtime stage.
- If NO Dockerfile exists at execution time, do not invent one — record `skipped: no Dockerfile in repo` in result notes and stop; Task N re-checks.

- [ ] **Step 1: build-stage addition** — after the existing app build command(s), add (adjusting stage/paths per as-built):

```dockerfile
RUN pnpm --filter opendoist build
```

- [ ] **Step 2: runtime-stage addition** — before the final `CMD`/`ENTRYPOINT`:

```dockerfile
# OpenDoist CLI: `docker exec <container> opendoist …` (od = short alias)
COPY --from=build /app/packages/cli/dist/index.js /usr/local/lib/opendoist-cli/index.js
RUN printf '#!/bin/sh\nexec node /usr/local/lib/opendoist-cli/index.js "$@"\n' > /usr/local/bin/opendoist \
  && chmod +x /usr/local/bin/opendoist \
  && ln -s /usr/local/bin/opendoist /usr/local/bin/od
ENV OPENDOIST_URL=http://127.0.0.1:7968
```

Notes: the wrapper script (not a symlink to the JS file) avoids exec-bit/shebang fragility on alpine. `OPENDOIST_URL` here is CLI-only and does not collide with the server's `OPENDOIST_PUBLIC_URL`/`OPENDOIST_PORT`; users still pass `OPENDOIST_TOKEN` per exec. The single-file `dist/index.js` is fully self-contained (Task A bundling), so no `node_modules` is copied.

- [ ] **Step 3: verify.** `grep -c "opendoist-cli" Dockerfile` → ≥2; `grep -n "OPENDOIST_URL=http://127.0.0.1:7968" Dockerfile` → 1 hit. If the docker daemon is available AND the image already built pre-change, optionally `docker build -t opendoist-cli-check . && docker run --rm --entrypoint opendoist opendoist-cli-check --version` → prints `0.1.0`; otherwise record `docker build not run (no daemon)` — Task N and phase 10 cover it.

---

### Task N: Integration gate (SEQUENTIAL — after B–M)

**Files:** may touch anything needed to make the gate pass (smallest possible diffs); this is where server-drift reconciliation lands.

- [ ] **Step 1: AS-BUILT reconciliation.** With the full repo present:
  - Diff `api.ts`'s resource methods against `apps/server` routes (`grep -rn "createRoute\|\.openapi(" apps/server/src` or the server's route index). Fix paths, verbs, query-param names, and DTO field names in `api.ts` + `src/test/harness.ts` fixtures ONLY (commands are insulated by the client). The route table already encodes phase 3's contracts (no `/tasks/filter` route — views evaluate locally; completed listing at `/tasks/completed`; search param `q` with `{task, matched_in}` hits; `created_at`, not `added_at`); likely residual deltas: close/reopen paths, DTO casing (snake_case assumed), `/user` vs `/me`.
  - Check the web app's actual view/task routes for `open.ts`'s path map (Task J bullet).
  - Confirm core still exports `parseQuickAdd`, `parseFilter`, `FilterSyntaxError`, `dateInTz`, `DEFAULT_PARSE_CONTEXT_SETTINGS`; if `parseFilter` is still the phase-1-2 placeholder `export {}`, STOP (phases out of order) and report.
- [ ] **Step 2: full verify.** `pnpm install` (only if a manifest changed in Step 1), then `pnpm verify` (lint + typecheck + test + build across the workspace) → green. Fix failures with minimal diffs; record every fix.
- [ ] **Step 3: bundle self-containment.** `pnpm --filter opendoist build`, then:

```
cp packages/cli/dist/index.js "$SCRATCHPAD/od-standalone.mjs"
node "$SCRATCHPAD/od-standalone.mjs" --help
node "$SCRATCHPAD/od-standalone.mjs" --version
```

(`$SCRATCHPAD` = the session scratchpad dir, which has no `node_modules` ancestor.) Expected: help lists ALL commands — `login logout whoami add list today upcoming done reopen rm projects sections labels filters search open` — and version prints `0.1.0`. A `ERR_MODULE_NOT_FOUND` here means a dependency leaked to `dependencies`/external — fix the bundling, not the symptom.

- [ ] **Step 4: exit-code + JSON contract spot-checks (no server needed):**

```
env -u OPENDOIST_URL -u OPENDOIST_TOKEN node packages/cli/dist/index.js whoami; echo "exit=$?"   # exit=2 (no creds)
env -u OPENDOIST_URL -u OPENDOIST_TOKEN node packages/cli/dist/index.js whoami --json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.ok!==false||d.error.code!=='auth')process.exit(1)"
OPENDOIST_URL=http://127.0.0.1:1 OPENDOIST_TOKEN=od_x node packages/cli/dist/index.js today; echo "exit=$?"          # exit=1, stderr mentions cannot reach/offline
OPENDOIST_URL=http://127.0.0.1:1 OPENDOIST_TOKEN=od_x node packages/cli/dist/index.js list "today &"; echo "exit=$?" # exit=1, stderr contains `position` (validated before any fetch)
```

(When a saved config exists on the machine, prefix the first two with `OPENDOIST_CONFIG_PATH=/nonexistent` as well.)

- [ ] **Step 5: live end-to-end (conditional).** If `apps/server` exists and boots (per its phase-3 as-built docs — e.g. `OPENDOIST_DATA_DIR=$(mktemp -d) OPENDOIST_PORT=7968 pnpm --filter @opendoist/server dev`): create the first user + an `od_` token by the server's documented means (signup endpoint or its own test utilities). Then with `OPENDOIST_URL=http://127.0.0.1:7968 OPENDOIST_TOKEN=<token>` run: `whoami` (exit 0) → `add "Integration smoke tom 4pm p2 #Inbox"` (`✓ added`) → `list --json` (contains `Integration smoke`) → `printf 'y\n' | opendoist done "Integration smoke"` (exercises the fuzzy-confirm path, `✓ completed`) → `today` (exit 0). Kill the server. If token creation is not scriptable within ~15 minutes, record `live e2e skipped: <reason>` — the mocked suites remain the phase gate; phase 10 owns the full e2e story.
- [ ] **Step 6: coverage sanity.** `pnpm --filter opendoist exec vitest run --reporter=verbose` → confirm test files exist for: format, config, auth, add, parser-roundtrip, views, mutate, projects, labels, search, open, api (12 files, every command covered by mocked-fetch tests).
- [ ] **Step 7:** do not commit — report ready-for-checkpoint with all reconciliation notes.

## Self-Review (done)

- **Scope coverage vs. the phase-8 brief:** scaffold/commander/env-paths/tsdown/bin (A) · login/logout/whoami (C) · add = local core preview + raw `/tasks/quick` submit (D) · list/today/upcoming = client `parseFilter` validation + LOCAL core `filterTasks` evaluation over `GET /tasks` (+ projects/sections joins) + grouped output (E; no server filter endpoint exists) · done/reopen/rm id-or-fuzzy + confirmation (F) · projects/sections (G) · labels/filters incl. query validation (H) · search (I) · open (J) · global `--json` + exit codes 0/1/2 (A `runAction`, verified N) · cli-table3 + `styleText` priority/date colors (B) · offline + 401-hint UX (A/K) · changesets + npm metadata + CLI README (A+L) · Dockerfile COPY + symlink for `docker exec opendoist` (M) · vitest: parser round-trip (D), config precedence (C), formatters (B), mocked-fetch tests for every command (C–J).
- **Parallel safety:** B–M file sets are pairwise disjoint; all shared seams (`format.ts` signatures, harness, `api.ts`, `io`, `prompter`, `launcher`) frozen in Task A; command tests barred from snapshotting human tables so B cannot break C–J.
- **Drift management:** every server/web dependency sits behind `api.ts` + one path map in `open.ts`, with AS-BUILT CHECK bullets in A/J/M/N; core is consumed only through exports verified present today (`parseFilter` is the one still-placeholder phase-1-2 deliverable — hard STOP in Task N Step 1).
- **Decisions:** zero-`dependencies` package, full bundling (self-contained dist for npm + Docker) · snake_case wire assumption pending as-built · system timezone for CLI-local parsing · comma panes rejected in `list` but allowed in `filters add` · `open --json` prints URL without launching · `od` is a shell-alias/Docker-symlink, not an npm bin (collision-safe).
- **No TBD/TODO/placeholder text**; the only intentional stubs (format.ts + 8 registrars) are complete typed code from Task A, replaced wholesale by their owners.

