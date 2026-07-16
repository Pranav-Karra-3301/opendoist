# OpenDoist Phase 3: Server — DB, Auth, CRUD API, SSE, FTS, Docker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via a Workflow: Task A first (sequential), Tasks B–L in parallel (disjoint file sets, no commits, no `pnpm install`), Task M integrates.** Commits happen at integration checkpoints, not per-task, because tasks run concurrently in one working tree. Implementation agents run as Opus; integration/review agents as Fable.

**Goal:** A bootable `apps/server` — Hono 4 API on port 7968 with SQLite (Drizzle + better-sqlite3, migrations at boot, FTS5 search), better-auth (password + argon2id, `od_` API keys with scopes, generic OIDC from env, optional TOTP, registration auto-lock), full CRUD REST under `/api/v1` (tasks incl. `/tasks/quick` + recurrence advance-on-complete, projects, sections, labels, filters, comments + attachments, user/settings, activities, search), OpenAPI + Scalar docs, SSE event stream with replay, `GET /api/health` + `GET /api/v1/info`, and a multi-arch Docker image published to GHCR.

**Architecture:** `apps/server` imports `@opendoist/core` for all parsing/recurrence logic (server never re-implements grammar). Every route is zod-typed via `@hono/zod-openapi` so the OpenAPI doc is a build artifact of the code. Task A freezes every contract (config, secrets, Drizzle schema + generated migrations, DTO schemas, helpers, auth instance, app assembly, event bus, test harness) and stubs one file per router; parallel tasks replace their stub file(s) wholesale and add colocated integration tests that run against a real temp-dir SQLite through `app.request()` (no listening socket needed).

**Tech Stack:** Hono 4.12 + @hono/node-server 2 + @hono/zod-openapi 1.5 (zod 4) + @scalar/hono-api-reference · Drizzle 0.45.x + drizzle-kit 0.31 + better-sqlite3 12 · better-auth 1.6 + @node-rs/argon2 · pino 9 · tsx (dev **and** prod runtime — no server build step) · Vitest 4 (pool: forks) · node:22-alpine Docker.

**Reference documents (read before your task):**
- Spec: `docs/superpowers/specs/2026-07-15-opendoist-design.md` (§2.1 entities, §3.2 server, §3.5 deploy/config/ops, §3.6 timezones)
- Dossier: `docs/superpowers/research/2026-07-15-opendoist-research.md` (§3.1–3.3 stack/patterns, §4.2–4.6 docker/config/migrations/health/first-run, §1.9 Todoist API shapes)
- Frozen core contract: `packages/core/src/types.ts` — authoritative; do not assume engine internals beyond exported signatures.

## Global Constraints

- Priorities stored **1 = highest (p1) … 4 = default**. (Todoist's API inverts; our importer maps — phase 9.)
- Server port **7968**; env prefix **`OPENDOIST_`**; API tokens prefixed **`od_`** with scopes `read`/`read_write`; one `/data` volume.
- API JSON is **snake_case** (Todoist-compatible field names); ids are opaque nanoid strings; cursor pagination `{results, next_cursor}`; errors are RFC 9457 problem JSON (`application/problem+json`). One deliberate exception: the `/user/settings` document is a camelCase client-preferences blob (see Task A Step 10). Every list endpoint — paginated or not — returns the `{results, next_cursor}` envelope (unpaginated ones with `next_cursor: null`), never a bare array.
- Dates: calendar dates `YYYY-MM-DD` strings, wall-clock times `HH:mm`, instants ISO-8601 UTC strings; user timezone lives in `user_settings` (spec §3.6). No `Date` objects in API payloads.
- Radii 5px/10px only; Kale `#4c7a45` default accent; focus ring `#1f60c2` (web-phase invariants — do not add UI here).
- TypeScript `strict`, no `any` (Biome `noExplicitAny: error`), `verbatimModuleSyntax`; Biome formatting (single quotes, semicolons as-needed, width 100).
- Tests colocated `src/**/*.test.ts`, run by Vitest; every route has integration tests on a temp SQLite database.
- License AGPL-3.0. Conventional commit messages (integration checkpoints only).
- **Parallel-execution rules:** builders touch ONLY their listed files; never run `pnpm install` (Task A declares all deps and installs once); never `git commit`. Builders MAY run `pnpm --filter @opendoist/server test`, `pnpm typecheck`, `pnpm lint`.
- If a catalog version fails to resolve (this repo uses pnpm `minimumReleaseAge`), set it to the latest published version (`pnpm view <pkg> version`), add an entry to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` if pnpm demands it, and record the change in your result notes.
- Reminders/push/channels/rambles **tables and routes are NOT in this phase** (phases 6–7). `POST /tasks/quick` parses reminder tokens but does not persist them yet — response shape will not change when phase 6 adds persistence.

---

### Task A: Server scaffold + frozen contracts (SEQUENTIAL — everything depends on this)

**Files:**
- Edit: `pnpm-workspace.yaml` (append catalog entries — touch nothing else in it)
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/drizzle.config.ts`
- Create: `apps/server/src/config.ts`, `src/secrets.ts`, `src/logger.ts`, `src/index.ts`, `src/app.ts`, `src/auth.ts`
- Create: `apps/server/src/db/schema.ts`, `src/db/auth-schema.ts`, `src/db/db.ts`
- Create: `apps/server/src/lib/ids.ts`, `src/lib/problem.ts`, `src/lib/pagination.ts`, `src/lib/activity.ts`, `src/lib/parse-context.ts`
- Create: `apps/server/src/events/bus.ts`
- Create: `apps/server/src/services/task-read.ts`, `src/services/task-write.ts`
- Create: `apps/server/src/api/schemas.ts`
- Create STUBS (replaced wholesale by Tasks B–I): `apps/server/src/api/routes/{tasks,task-actions,projects,sections,labels,filters,comments,attachments,user,activities,search,events}.ts`
- Create: `apps/server/src/test/helpers.ts`, `apps/server/src/boot.test.ts`
- Generated: `apps/server/drizzle/*` (via drizzle-kit; committed)

**AS-BUILT CHECK (do these before writing code):**
- `grep -n "export function parseQuickAdd" packages/core/src/quick-add/parse.ts` → must show `parseQuickAdd(input: string, ctx: ParseContext): ParsedQuickAdd`.
- `grep -n "export { nextOccurrence }" packages/core/src/recurrence/index.ts` and confirm `nextOccurrence(spec, { after: { date, time }, ctx })` in `engine.ts`.
- `grep -rn "export function parseFilter" packages/core/src/filter/` → if ABSENT (phase 2 unfinished), STOP and report to the orchestrator; do not improvise.
- Confirm root `package.json` still has the `verify` script and `pnpm-workspace.yaml` catalog matches phase 1–2's list before appending.

- [ ] **Step 1: Catalog + manifests.** Append to the `catalog:` map in `pnpm-workspace.yaml`:

```yaml
  hono: ^4.12.30
  '@hono/node-server': ^2.0.9
  '@hono/zod-openapi': ^1.5.1
  '@scalar/hono-api-reference': ^0.11.10
  drizzle-orm: ^0.45.2
  drizzle-kit: ^0.31.10
  better-sqlite3: ^12.11.1
  '@types/better-sqlite3': ^7.6.13
  better-auth: ^1.6.23
  '@node-rs/argon2': ^2.0.2
  pino: ^9.13.1
  pino-pretty: ^13.1.2
  tsx: ^4.20.6
```

`apps/server/package.json`:

```json
{
  "name": "@opendoist/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "OPENDOIST_DATA_DIR=./data tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "node -e \"console.log('server: tsx-run workspace package, no build step')\"",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@opendoist/core": "workspace:*",
    "hono": "catalog:",
    "@hono/node-server": "catalog:",
    "@hono/zod-openapi": "catalog:",
    "@scalar/hono-api-reference": "catalog:",
    "drizzle-orm": "catalog:",
    "better-sqlite3": "catalog:",
    "better-auth": "catalog:",
    "@node-rs/argon2": "catalog:",
    "pino": "catalog:",
    "nanoid": "catalog:",
    "zod": "catalog:",
    "tsx": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:",
    "drizzle-kit": "catalog:",
    "@types/better-sqlite3": "catalog:",
    "@types/node": "catalog:",
    "pino-pretty": "catalog:"
  }
}
```

`apps/server/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "drizzle.config.ts"] }`
`apps/server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'], pool: 'forks', testTimeout: 20000 } })
```

`apps/server/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/db/schema.ts', './src/db/auth-schema.ts'],
  out: './drizzle',
  dbCredentials: { url: './data/opendoist.db' },
})
```

- [ ] **Step 2: `src/config.ts` (frozen, verbatim).** All `OPENDOIST_*` env vars, all optional (spec §3.5):

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const bool = (v: string | undefined, dflt: boolean) =>
  v === undefined ? dflt : ['1', 'true', 'yes'].includes(v.toLowerCase())

export const ConfigSchema = z.object({
  publicUrl: z.string().url().nullable(),
  port: z.number().int().min(1).max(65535),
  dataDir: z.string().min(1),
  webDistDir: z.string().nullable(),
  allowRegistration: z.boolean(),
  disableUpdateCheck: z.boolean(),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  trustProxy: z.boolean(),
  uploadMaxMb: z.number().int().min(1),
  backupRetention: z.number().int().min(1),
  backupIncludeAttachments: z.boolean(),
  backupCron: z.string(),
  oidc: z.object({ issuer: z.string(), clientId: z.string(), clientSecret: z.string(), name: z.string() }).nullable(),
  stt: z.object({ provider: z.string(), baseUrl: z.string().nullable(), model: z.string().nullable(), apiKey: z.string().nullable() }).nullable(),
  llm: z.object({ provider: z.string(), baseUrl: z.string().nullable(), model: z.string().nullable(), apiKey: z.string().nullable() }).nullable(),
  version: z.string(),
})
export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }
  const o = (k: string) => env[`OPENDOIST_OIDC_${k}`]
  const oidc =
    o('ISSUER') && o('CLIENT_ID') && o('CLIENT_SECRET')
      ? { issuer: o('ISSUER') as string, clientId: o('CLIENT_ID') as string, clientSecret: o('CLIENT_SECRET') as string, name: o('NAME') ?? 'OIDC' }
      : null
  const ai = (p: 'STT' | 'LLM') =>
    env[`OPENDOIST_${p}_PROVIDER`]
      ? { provider: env[`OPENDOIST_${p}_PROVIDER`] as string, baseUrl: env[`OPENDOIST_${p}_BASE_URL`] ?? null, model: env[`OPENDOIST_${p}_MODEL`] ?? null, apiKey: env[`OPENDOIST_${p}_API_KEY`] ?? null }
      : null
  return ConfigSchema.parse({
    publicUrl: env.OPENDOIST_PUBLIC_URL ?? null,
    port: Number(env.OPENDOIST_PORT ?? 7968),
    dataDir: env.OPENDOIST_DATA_DIR ?? '/data',
    webDistDir: env.OPENDOIST_WEB_DIST ?? null,
    allowRegistration: bool(env.OPENDOIST_ALLOW_REGISTRATION, false),
    disableUpdateCheck: bool(env.OPENDOIST_DISABLE_UPDATE_CHECK, false),
    logLevel: env.OPENDOIST_LOG_LEVEL ?? 'info',
    trustProxy: bool(env.OPENDOIST_TRUST_PROXY, false),
    uploadMaxMb: Number(env.OPENDOIST_UPLOAD_MAX_MB ?? 25),
    backupRetention: Number(env.OPENDOIST_BACKUP_RETENTION ?? 14),
    backupIncludeAttachments: bool(env.OPENDOIST_BACKUP_INCLUDE_ATTACHMENTS, true),
    backupCron: env.OPENDOIST_BACKUP_CRON ?? '0 3 * * *',
    oidc,
    stt: ai('STT'),
    llm: ai('LLM'),
    version: env.OPENDOIST_VERSION ?? `${pkg.version}-dev`,
  })
}
```

- [ ] **Step 3: `src/secrets.ts` (frozen, verbatim).** Zero-required-env boot (dossier §4.12.3): auto-generate into `<dataDir>/secrets.json`, chmod 600, idempotent (existing keys preserved, missing keys filled). VAPID keys are generated now with node:crypto (P-256, base64url raw) so `secrets.json` is complete from first boot; phase 6's `web-push` consumes them as-is.

```ts
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const SecretsSchema = z.object({
  sessionSecret: z.string().min(32),
  vapidPublicKey: z.string(),
  vapidPrivateKey: z.string(),
  encryptionKey: z.string().min(32),
})
export type Secrets = z.infer<typeof SecretsSchema>

function generateVapid(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ format: 'jwk' })
  const priv = privateKey.export({ format: 'jwk' })
  const b64uToBuf = (s: string) => Buffer.from(s, 'base64url')
  const raw = Buffer.concat([Buffer.from([4]), b64uToBuf(pub.x as string), b64uToBuf(pub.y as string)])
  return { publicKey: raw.toString('base64url'), privateKey: b64uToBuf(priv.d as string).toString('base64url') }
}

/** Creates dataDir (+ attachments/, backups/) and loads-or-creates secrets.json (mode 600). */
export function ensureDataDirAndSecrets(dataDir: string): Secrets {
  mkdirSync(join(dataDir, 'attachments'), { recursive: true })
  mkdirSync(join(dataDir, 'backups'), { recursive: true })
  const file = join(dataDir, 'secrets.json')
  const existing: Partial<Secrets> = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<Secrets>)
    : {}
  const vapid =
    existing.vapidPublicKey && existing.vapidPrivateKey
      ? { publicKey: existing.vapidPublicKey, privateKey: existing.vapidPrivateKey }
      : generateVapid()
  const secrets = SecretsSchema.parse({
    sessionSecret: existing.sessionSecret ?? randomBytes(32).toString('base64url'),
    vapidPublicKey: vapid.publicKey,
    vapidPrivateKey: vapid.privateKey,
    encryptionKey: existing.encryptionKey ?? randomBytes(32).toString('base64url'),
  })
  writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
  return secrets
}
```

- [ ] **Step 4: `src/db/schema.ts` (frozen).** Drizzle sqlite-core. Conventions: text ids (`newId()` app-side), timestamps as ISO text with `$defaultFn`, booleans `integer({ mode: 'boolean' })`, soft delete via `deleted_at` text nullable. Use a shared `const timestamps = { createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull() }` spread. Tables (spec §2.1) — every column below, exactly:

- `projects`: `id` PK, `userId` (`user_id`, notNull, refs `user.id`), `name` notNull, `description` notNull default `''`, `color` notNull default `'charcoal'`, `parentId` nullable self-ref, `childOrder` int notNull default 0, `isFavorite`/`isArchived`/`isCollapsed` bool default false, `isInbox` bool notNull default false, `viewPrefs` text nullable (JSON), `deletedAt` nullable, timestamps. Index on `userId`.
- `sections`: `id` PK, `userId`, `projectId` notNull refs projects, `name`, `sectionOrder` int default 0, `isArchived`/`isCollapsed` bool default false, `deletedAt`, timestamps. Index `projectId`.
- `tasks`: `id` PK, `userId`, `projectId` notNull, `sectionId` nullable, `parentId` nullable self-ref, `childOrder` int default 0, `content` notNull, `description` notNull default `''`, `priority` int notNull default 4, `dueDate` nullable, `dueTime` nullable, `dueString` nullable, `recurrence` text nullable (JSON `RecurrenceSpec`), `deadlineDate` nullable, `durationMin` int nullable, `dayOrder` int default 0, `isCollapsed` bool default false, `uncompletable` bool default false, `completedAt` nullable, `deletedAt` nullable, timestamps. Indexes: `projectId`, `sectionId`, `parentId`, `dueDate`, `completedAt`.
- `labels`: `id` PK, `userId`, `name` notNull (unique index on `(userId, name)`), `color` default `'charcoal'`, `itemOrder` int default 0, `isFavorite` bool default false, `deletedAt`, timestamps.
- `taskLabels` (`task_labels`): `taskId` refs tasks (cascade delete), `labelId` refs labels (cascade delete), composite PK `(taskId, labelId)`.
- `filters`: `id` PK, `userId`, `name`, `query` notNull, `color` default `'charcoal'`, `itemOrder` int default 0, `isFavorite` bool default false, `deletedAt`, timestamps.
- `comments`: `id` PK, `userId`, `taskId` notNull refs tasks, `content` notNull, `attachmentId` nullable refs attachments, `deletedAt`, timestamps. Index `taskId`.
- `attachments`: `id` PK, `userId`, `fileName` notNull, `fileSize` int notNull, `fileType` notNull, `filePath` notNull (relative to `<dataDir>/attachments`), `createdAt`.
- `activityLog` (`activity_log`): `id` PK, `userId`, `eventType` notNull, `entityType` notNull, `entityId` notNull, `projectId` nullable, `payload` text nullable (JSON), `at` notNull. Indexes: `at`, `(entityType, entityId)`.
- `dayStats` (`day_stats`): `userId` + `date` composite PK, `completedCount` int notNull default 0, `goalMet` bool notNull default false.
- `userSettings` (`user_settings`): `userId` PK refs `user.id`, `settings` text notNull (JSON, validated by `SettingsSchema`), `updatedAt` notNull.

- [ ] **Step 5: `src/db/auth-schema.ts` (frozen).** Hand-written better-auth 1.6 tables for the Drizzle adapter — property names camelCase (better-auth model fields), column names snake_case. Tables/fields per better-auth core + twoFactor + apiKey plugin docs:

- `user`: `id` PK, `name` text notNull, `email` notNull unique, `emailVerified` bool notNull default false, `image` nullable, `twoFactorEnabled` bool nullable, `createdAt`/`updatedAt` notNull (ISO text with `$defaultFn`).
- `session`: `id` PK, `expiresAt` notNull, `token` notNull unique, `ipAddress` nullable, `userAgent` nullable, `userId` notNull refs user (cascade), `createdAt`/`updatedAt`.
- `account`: `id` PK, `accountId` notNull, `providerId` notNull, `userId` notNull refs user (cascade), `accessToken`/`refreshToken`/`idToken` nullable, `accessTokenExpiresAt`/`refreshTokenExpiresAt` nullable, `scope` nullable, `password` nullable, `createdAt`/`updatedAt`.
- `verification`: `id` PK, `identifier` notNull, `value` notNull, `expiresAt` notNull, `createdAt`/`updatedAt`.
- `twoFactor` (`two_factor`): `id` PK, `secret` notNull, `backupCodes` notNull, `userId` notNull refs user (cascade).
- `apikey`: `id` PK, `name` nullable, `start` nullable, `prefix` nullable, `key` notNull, `userId` notNull refs user (cascade), `refillInterval` int nullable, `refillAmount` int nullable, `lastRefillAt` nullable, `enabled` bool default true, `rateLimitEnabled` bool default false, `rateLimitTimeWindow` int nullable, `rateLimitMax` int nullable, `requestCount` int default 0, `remaining` int nullable, `lastRequest` nullable, `expiresAt` nullable, `permissions` text nullable, `metadata` text nullable, `createdAt`/`updatedAt`.

Date-ish better-auth fields (`expiresAt`, `createdAt`, …) MUST be `integer({ mode: 'timestamp_ms' })` so the adapter's `Date` values round-trip. If any better-auth test in Task J fails with "column X doesn't exist / field missing", the error names the field — add it here, regenerate migrations, note it.

- [ ] **Step 6: `src/db/db.ts` (frozen).** Boot order per spec §3.2:

```ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { join } from 'node:path'
import * as authSchema from './auth-schema'
import * as schema from './schema'

export const fullSchema = { ...schema, ...authSchema }
export type Db = ReturnType<typeof openDb>['db']

export function openDb(file: string) {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: fullSchema })
  migrate(db, { migrationsFolder: join(import.meta.dirname, '../../drizzle') })
  return { db, sqlite }
}
```

- [ ] **Step 7: Generate migrations.** After Step 12's install: `pnpm --filter @opendoist/server db:generate` → `drizzle/0000_*.sql`. Then `pnpm --filter @opendoist/server exec drizzle-kit generate --custom --name fts5` and fill the custom migration with EXACTLY:

```sql
CREATE VIRTUAL TABLE tasks_fts USING fts5(content, description, content='tasks', content_rowid='rowid');
--> statement-breakpoint
CREATE TRIGGER tasks_fts_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, content, description) VALUES (new.rowid, new.content, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER tasks_fts_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, content, description) VALUES ('delete', old.rowid, old.content, old.description);
END;
--> statement-breakpoint
CREATE TRIGGER tasks_fts_au AFTER UPDATE OF content, description ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, content, description) VALUES ('delete', old.rowid, old.content, old.description);
  INSERT INTO tasks_fts(rowid, content, description) VALUES (new.rowid, new.content, new.description);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE comments_fts USING fts5(content, content='comments', content_rowid='rowid');
--> statement-breakpoint
CREATE TRIGGER comments_fts_ai AFTER INSERT ON comments BEGIN
  INSERT INTO comments_fts(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER comments_fts_ad AFTER DELETE ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER comments_fts_au AFTER UPDATE OF content ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO comments_fts(rowid, content) VALUES (new.rowid, new.content);
END;
```

Commit the whole `drizzle/` folder (journal + SQL). Soft-deleted rows stay indexed — search filters `deleted_at IS NULL` at query time (Task H).

- [ ] **Step 8: Small frozen libs.**

`src/lib/ids.ts`: `import { nanoid } from 'nanoid'` → `export const newId = () => nanoid(16)` and `export const nowIso = () => new Date().toISOString()`.

`src/lib/problem.ts` (RFC 9457):

```ts
import type { Context } from 'hono'
export interface Problem {
  type: string; title: string; status: number; detail?: string; errors?: unknown
}
export function problem(c: Context, status: number, title: string, detail?: string, extra?: Record<string, unknown>) {
  return c.json(
    { type: `https://opendoist.dev/problems/${title.toLowerCase().replaceAll(' ', '-')}`, title, status, ...(detail ? { detail } : {}), ...extra },
    status as never,
    { 'content-type': 'application/problem+json' },
  )
}
```

`src/lib/pagination.ts`:

```ts
import { z } from '@hono/zod-openapi'
export const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export function encodeCursor(v: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url')
}
export function decodeCursor(s: string): Record<string, string | number> | null {
  try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, string | number> }
  catch { return null }
}
/** Boolean query params: NEVER z.coerce.boolean() (any non-empty string is truthy). */
export const queryBool = (dflt: boolean) =>
  z.enum(['true', 'false']).default(dflt ? 'true' : 'false').transform((v) => v === 'true')
```

Rule for all list endpoints: fetch `limit + 1` rows keyset-ordered; if extra row exists, `next_cursor = encodeCursor(keys of last returned row)` else `null`. Invalid cursor → 400 problem `invalid cursor`. Unpaginated "return all" endpoints (GET /projects, /sections, /labels, /filters) still respond with the same `{results: [...], next_cursor: null}` envelope — phase 4's `apiAllPages` and phase 8's `listAll` hard-require that shape and would throw on a bare array.

`src/lib/activity.ts`: `export const ActivityEventTypes = ['task_added','task_updated','task_completed','task_uncompleted','task_deleted','project_added','project_updated','project_archived','project_unarchived','project_deleted','section_added','section_updated','section_deleted','label_added','label_updated','label_deleted','filter_added','filter_updated','filter_deleted','comment_added','comment_updated','comment_deleted'] as const` + `logActivity(db, row: { userId, eventType, entityType, entityId, projectId?, payload? })` inserting with `newId()`/`nowIso()`.

`src/lib/parse-context.ts`: `export function parseContextFor(settings: Settings, now = nowIso()): ParseContext` mapping `{ now, timezone: settings.timezone, weekStart, nextWeekDay, weekendDay, smartDate }` (import `ParseContext` type from `@opendoist/core`, `Settings` from `../api/schemas`).

- [ ] **Step 9: `src/events/bus.ts` (frozen, complete implementation).**

```ts
export interface ServerEvent {
  id: number
  type: string          // `${entity}.${verb}` e.g. 'task.completed'
  entity: 'task' | 'project' | 'section' | 'label' | 'filter' | 'comment' | 'settings'
  ids: string[]
  at: string
}
type Listener = (e: ServerEvent) => void

export class EventBus {
  private seq = 0
  private ring: ServerEvent[] = []
  private listeners = new Set<Listener>()
  constructor(private capacity = 256) {}
  publish(e: Omit<ServerEvent, 'id' | 'at'>): ServerEvent {
    const event: ServerEvent = { ...e, id: ++this.seq, at: new Date().toISOString() }
    this.ring.push(event)
    if (this.ring.length > this.capacity) this.ring.shift()
    for (const l of this.listeners) l(event)
    return event
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  since(lastId: number): ServerEvent[] {
    return this.ring.filter((e) => e.id > lastId)
  }
}
```

- [ ] **Step 10: `src/api/schemas.ts` (frozen — all DTOs).** Import `z` from `@hono/zod-openapi` (NOT plain zod) so `.openapi()` metadata works. Define exactly:

```ts
export const PALETTE = ['berry_red','red','orange','yellow','olive_green','lime_green','green','mint_green','teal','sky_blue','light_blue','blue','grape','violet','lavender','magenta','salmon','charcoal','grey','taupe'] as const
export const ColorSchema = z.enum(PALETTE)
export const IdSchema = z.string().min(1)
export const DueDtoSchema = z.object({ date: z.string(), time: z.string().nullable(), string: z.string(), is_recurring: z.boolean(), recurrence: z.unknown().nullable() })
export const TaskDtoSchema = z.object({
  id: IdSchema, project_id: IdSchema, section_id: IdSchema.nullable(), parent_id: IdSchema.nullable(),
  child_order: z.number().int(), content: z.string(), description: z.string(),
  priority: z.number().int().min(1).max(4), due: DueDtoSchema.nullable(), deadline_date: z.string().nullable(),
  duration_min: z.number().int().nullable(), day_order: z.number().int(), labels: z.array(z.string()),
  is_collapsed: z.boolean(), uncompletable: z.boolean(), completed_at: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
})
export const ProjectDtoSchema = z.object({
  id: IdSchema, name: z.string(), description: z.string(), color: ColorSchema, parent_id: IdSchema.nullable(),
  child_order: z.number().int(), is_favorite: z.boolean(), is_archived: z.boolean(), is_collapsed: z.boolean(),
  is_inbox: z.boolean(), view_prefs: z.unknown().nullable(), created_at: z.string(), updated_at: z.string(),
})
export const SectionDtoSchema = z.object({ id: IdSchema, project_id: IdSchema, name: z.string(), section_order: z.number().int(), is_archived: z.boolean(), is_collapsed: z.boolean(), created_at: z.string(), updated_at: z.string() })
export const LabelDtoSchema = z.object({ id: IdSchema, name: z.string(), color: ColorSchema, item_order: z.number().int(), is_favorite: z.boolean(), created_at: z.string(), updated_at: z.string() })
export const FilterDtoSchema = z.object({ id: IdSchema, name: z.string(), query: z.string(), color: ColorSchema, item_order: z.number().int(), is_favorite: z.boolean(), created_at: z.string(), updated_at: z.string() })
export const AttachmentDtoSchema = z.object({ id: IdSchema, file_name: z.string(), file_size: z.number().int(), file_type: z.string(), file_url: z.string() })
export const CommentDtoSchema = z.object({ id: IdSchema, task_id: IdSchema, content: z.string(), attachment: AttachmentDtoSchema.nullable(), created_at: z.string(), updated_at: z.string() })
export const ActivityDtoSchema = z.object({ id: IdSchema, event_type: z.string(), entity_type: z.string(), entity_id: IdSchema, project_id: IdSchema.nullable(), payload: z.unknown().nullable(), at: z.string() })
/** CANONICAL user-settings wire document for GET/PATCH /api/v1/user/settings.
 *  DELIBERATE exception to the snake_case rule: this is a client-owned preferences document
 *  persisted verbatim in user_settings.settings, so keys are camelCase — phase 4 parses it as-is,
 *  phase 5 re-homes this EXACT schema in @opendoist/core as UserSettingsSchema, and phase 6 reuses
 *  autoReminderMinutes. Decisions frozen here: 8 themes + separate autoDark (NO 'system' theme value
 *  — spec §2.5), timeFormat default '12h', dateFormat 'MDY' | 'DMY' default 'MDY'.
 *  Later phases may not re-key, re-default, or re-declare any field. */
export const ViewPrefsSchema = z.object({
  groupBy: z.enum(['none', 'project', 'priority', 'label', 'date']).default('none'),
  sortBy: z.enum(['manual', 'date', 'added', 'priority', 'alphabetical']).default('manual'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  filterBy: z.object({
    priority: z.number().int().min(1).max(4).nullable().default(null),
    label: z.string().nullable().default(null),
    due: z.enum(['has-date', 'no-date', 'overdue']).nullable().default(null),
  }).default({ priority: null, label: null, due: null }),
  showCompleted: z.boolean().default(false),
})
export const QUICK_ADD_CHIP_IDS = ['date', 'deadline', 'priority', 'reminders', 'labels', 'duration', 'description'] as const
export const SettingsSchema = z.object({
  homeView: z.string().default('today'),
  timezone: z.string().default('UTC'),
  dateFormat: z.enum(['MDY', 'DMY']).default('MDY'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
  weekStart: z.number().int().min(1).max(7).default(1),
  nextWeekDay: z.number().int().min(1).max(7).default(1),
  weekendDay: z.number().int().min(1).max(7).default(6),
  smartDate: z.boolean().default(true),
  theme: z.enum(['kale','todoist','dark','moonstone','tangerine','blueberry','lavender','raspberry']).default('kale'),
  autoDark: z.boolean().default(true),
  dailyGoal: z.number().int().min(0).max(100).default(5),
  weeklyGoal: z.number().int().min(0).max(700).default(25),
  daysOff: z.array(z.number().int().min(1).max(7)).default([6, 7]),
  vacationMode: z.boolean().default(false),
  karmaEnabled: z.boolean().default(true),
  /** minutes before a timed due for the automatic reminder; 0 = at due time; null = off (phase 6 consumes) */
  autoReminderMinutes: z.number().int().min(0).max(10080).nullable().default(30),
  notifications: z.object({
    push: z.boolean().default(true), ntfy: z.boolean().default(false),
    gotify: z.boolean().default(false), webhook: z.boolean().default(false),
  }).default({ push: true, ntfy: false, gotify: false, webhook: false }),
  sidebar: z.object({
    showInbox: z.boolean().default(true), showToday: z.boolean().default(true),
    showUpcoming: z.boolean().default(true), showFiltersLabels: z.boolean().default(true),
    showReporting: z.boolean().default(true), showCounts: z.boolean().default(true),
  }).default({ showInbox: true, showToday: true, showUpcoming: true, showFiltersLabels: true, showReporting: true, showCounts: true }),
  quickAdd: z.object({
    chips: z.array(z.object({ id: z.enum(QUICK_ADD_CHIP_IDS), visible: z.boolean() }))
      .default(QUICK_ADD_CHIP_IDS.map((id) => ({ id, visible: true }))),
    labeled: z.boolean().default(true),
  }).default({ chips: QUICK_ADD_CHIP_IDS.map((id) => ({ id, visible: true })), labeled: true }),
  /** keyed by view key ('today', 'project:<id>', …); PATCH semantics: per-key replace */
  viewPrefs: z.record(z.string(), ViewPrefsSchema).default({}),
})
export type Settings = z.infer<typeof SettingsSchema>
export const DueInputSchema = z.object({
  string: z.string().optional(), date: z.string().optional(), time: z.string().optional(),
}).nullable()
export const CreateTaskSchema = z.object({
  content: z.string().min(1), description: z.string().default(''),
  project_id: IdSchema.optional(), section_id: IdSchema.nullable().optional(), parent_id: IdSchema.nullable().optional(),
  child_order: z.number().int().optional(), priority: z.number().int().min(1).max(4).default(4),
  due: DueInputSchema.optional(), deadline_date: z.string().nullable().optional(),
  duration_min: z.number().int().min(1).max(1440).nullable().optional(), labels: z.array(z.string()).default([]),
  uncompletable: z.boolean().optional(),
})
export const UpdateTaskSchema = CreateTaskSchema.partial().extend({ day_order: z.number().int().optional(), is_collapsed: z.boolean().optional() })
export const InfoDtoSchema = z.object({
  version: z.string(), first_run: z.boolean(), registration_open: z.boolean(),
  auth_providers: z.object({ password: z.boolean(), oidc: z.object({ name: z.string() }).nullable() }),
  features: z.object({ stt: z.boolean(), llm: z.boolean(), push: z.boolean() }),
  available_importers: z.array(z.string()),
})
```

Due-input semantics (used by Tasks B/C): if `due.string` present → parse with `resolveNaturalDate`/`parseRecurrenceText` from core against the user's `ParseContext`; else use explicit `date`/`time`; `due: null` clears. Persist `due_string` always (recurring re-parse guarantee, spec §2.2).

- [ ] **Step 11: `src/auth.ts` (frozen).** better-auth wiring per spec §3.2. **DECISION:** generic OIDC-from-env is implemented with better-auth's built-in `genericOAuth` plugin (deterministic env config, no DB seeding) instead of `@better-auth/sso` — same product behavior (issuer/client/secret env → SSO button via `/info`); `@better-auth/sso` is deferred to whenever Settings-managed multi-provider lands. Record this deviation in the checkpoint notes.

```ts
import { hash, verify } from '@node-rs/argon2'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { apiKey, genericOAuth, twoFactor } from 'better-auth/plugins'
import { count } from 'drizzle-orm'
import type { Config } from './config'
import type { Db } from './db/db'
import * as authSchema from './db/auth-schema'
import { projects, userSettings } from './db/schema'
import { newId, nowIso } from './lib/ids'
import { SettingsSchema } from './api/schemas'

const ARGON2 = { memoryCost: 65536, timeCost: 3, parallelism: 4 }

export function createAuth(db: Db, config: Config, sessionSecret: string) {
  const baseURL = config.publicUrl ?? `http://localhost:${config.port}`
  return betterAuth({
    baseURL,
    basePath: '/api/auth',
    secret: sessionSecret,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ hash: h, password }) => verify(h, password, ARGON2),
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const [row] = await db.select({ n: count() }).from(authSchema.user)
            if ((row?.n ?? 0) > 0 && !config.allowRegistration)
              throw new APIError('FORBIDDEN', { message: 'Registration is closed on this instance' })
            return { data: user }
          },
          after: async (user) => {
            const now = nowIso()
            await db.insert(projects).values({
              id: newId(), userId: user.id, name: 'Inbox', isInbox: true, childOrder: 0,
              createdAt: now, updatedAt: now,
            })
            await db.insert(userSettings).values({
              userId: user.id, settings: JSON.stringify(SettingsSchema.parse({})), updatedAt: now,
            })
          },
        },
      },
    },
    plugins: [
      twoFactor(),
      apiKey({ defaultPrefix: 'od_', apiKeyHeaders: ['x-api-key'], enableMetadata: true }),
      ...(config.oidc
        ? [genericOAuth({ config: [{
            providerId: 'oidc',
            discoveryUrl: `${config.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
            clientId: config.oidc.clientId,
            clientSecret: config.oidc.clientSecret,
            scopes: ['openid', 'profile', 'email'],
          }] })]
        : []),
    ],
  })
}
export type Auth = ReturnType<typeof createAuth>
```

If better-auth's installed types reject an option name above (minor-version drift), fix to the installed signature with the same behavior and note it. API-key permissions: keys are created via `auth.api.createApiKey` with `permissions: { opendoist: ['read'] }` or `{ opendoist: ['read', 'read_write'] }` — the ONLY two shapes.

- [ ] **Step 12: `src/app.ts` + middleware (frozen assembly).** Exports:

```ts
export interface AppDeps { config: Config; db: Db; sqlite: DatabaseType; secrets: Secrets; bus: EventBus; auth: Auth; logger: Logger }
export interface AuthInfo { userId: string; via: 'session' | 'api-key'; scope: 'read' | 'read_write' }
export type AppEnv = { Variables: { auth: AuthInfo | null; requestId: string; deps: AppDeps } }
export function createApp(deps: AppDeps): OpenAPIHono<AppEnv>
```

Assembly order inside `createApp` (exact):
1. Root `new OpenAPIHono<AppEnv>({ defaultHook })` where `defaultHook` returns 400 problem JSON `{ title: 'validation failed', errors: result.error.issues }` when `!result.success`.
2. `app.use('*', ...)`: set `requestId` (nanoid(8)), set `deps`, pino request log line on completion (level from config; honor `trustProxy` for client ip via `x-forwarded-for`).
3. `app.get('/api/health', (c) => c.json({ status: 'ok' }))`.
4. `app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw))`.
5. Auth resolver on `/api/v1/*`: if `Authorization: Bearer od_…` → `auth.api.verifyApiKey({ body: { key } })`; when valid set `auth = { userId: key.userId, via: 'api-key', scope: permissions.opendoist?.includes('read_write') ? 'read_write' : 'read' }`; else `auth.api.getSession({ headers: c.req.raw.headers })` → `{ userId, via: 'session', scope: 'read_write' }`; else `null`.
6. `app.get('/api/v1/info', …)` (PUBLIC, before the guard): build `InfoDto` — `first_run` = user count 0 (query `authSchema.user`), `registration_open` = `first_run || config.allowRegistration`, `auth_providers.oidc` = `config.oidc && { name: config.oidc.name }`, `features` = `{ stt: !!config.stt, llm: !!config.llm, push: false }`, `available_importers: []`.
7. Guard on `/api/v1/*` (all other v1 paths): `auth == null` → 401 problem `unauthorized`; then for methods other than GET/HEAD, `scope === 'read'` → 403 problem `insufficient scope`.
8. Mount routers in THIS order (path-shadowing: quick/close/reopen/completed before `:id` matters across files): `taskActionsRoutes, tasksRoutes, projectsRoutes, sectionsRoutes, labelsRoutes, filtersRoutes, commentsRoutes, attachmentsRoutes, userRoutes, activitiesRoutes, searchRoutes, eventsRoutes` — each is `app.route('/api/v1', xRoutes())` where route files declare their own sub-paths (`/tasks`, `/projects`, …) and read `deps`/`auth` from context vars.
9. `app.doc('/api/v1/openapi.json', { openapi: '3.1.0', info: { title: 'OpenDoist API', version: deps.config.version } })` + register security schemes `cookieAuth` (apiKey/cookie `better-auth.session_token`) and `bearerAuth` (http bearer, format `od_…`) on `app.openAPIRegistry`.
10. `app.get('/api/v1/docs', Scalar({ url: '/api/v1/openapi.json', pageTitle: 'OpenDoist API' }))`.
11. Static SPA (only when `config.webDistDir` set and exists): `serveStatic({ root })` from `@hono/node-server/serve-static` for `/*`, plus GET fallback rewriting non-`/api` paths to `index.html`. `/api/*` never falls through — unknown `/api` path → 404 problem.

`src/logger.ts`: pino to stdout, `level: config.logLevel`; export `createLogger(config)`. `src/index.ts` boot (frozen): `loadConfig()` → `ensureDataDirAndSecrets(config.dataDir)` → `openDb(join(dataDir, 'opendoist.db'))` (PRAGMAs + `migrate()` inside) → `createAuth` → `new EventBus()` → `createApp` → `serve({ fetch: app.fetch, port, hostname: '0.0.0.0' })` → log `opendoist v{version} listening on :{port}`; SIGINT/SIGTERM → `server.close()` + `sqlite.close()`.

- [ ] **Step 13: Frozen services.** `src/services/task-read.ts`: `taskToDto(row, labels: string[]): TaskDto` (assemble `due` from `dueDate/dueTime/dueString/recurrence`; `is_recurring = recurrence !== null`) and `tasksToDtos(db, rows)` (single `inArray` query over `task_labels` joined to `labels`, grouped). `src/services/task-write.ts`:

```ts
export interface CreateTaskInput { /* mirrors CreateTaskSchema, camelCase, plus resolved due fields */
  content: string; description: string; projectId: string | null; sectionId: string | null
  parentId: string | null; childOrder: number | null; priority: 1 | 2 | 3 | 4
  dueDate: string | null; dueTime: string | null; dueString: string | null; recurrence: RecurrenceSpec | null
  deadlineDate: string | null; durationMin: number | null; labels: string[]; uncompletable: boolean
}
export function inboxProjectId(db: Db, userId: string): string
export function resolveLabelIds(db: Db, userId: string, names: string[]): string[]  // case-insensitive match, auto-create missing (item_order append), returns ids
export function createTask(db: Db, userId: string, input: CreateTaskInput): typeof tasks.$inferSelect  // defaults projectId→inbox, childOrder→max(sibling)+1, uncompletable from leading '* ' if not explicit, inserts task + task_labels rows
export function getSettings(db: Db, userId: string): Settings  // parse userSettings.settings through SettingsSchema
```

Complete implementations (they are contracts shared by Tasks B and C — no TODOs). `createTask` does NOT log activity or publish events (callers do).

- [ ] **Step 14: Route stubs.** Each of the 12 files in `src/api/routes/` gets the same 4-line stub (replaced wholesale by Tasks B–I):

```ts
import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../../app'
// implemented by Task <X> — stub so Task A boots
export const <name>Routes = () => new OpenAPIHono<AppEnv>()
```

Export names: `taskActionsRoutes, tasksRoutes, projectsRoutes, sectionsRoutes, labelsRoutes, filtersRoutes, commentsRoutes, attachmentsRoutes, userRoutes, activitiesRoutes, searchRoutes, eventsRoutes`.

- [ ] **Step 15: `src/test/helpers.ts` (frozen — the harness every router task uses).**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export interface TestApp {
  app: OpenAPIHono<AppEnv>; deps: AppDeps; dataDir: string; cookie: string; userId: string
  request(path: string, init?: RequestInit): Promise<Response>       // raw, no auth header
  get(path: string): Promise<Response>                                // cookie-authed
  post(path: string, body?: unknown): Promise<Response>
  patch(path: string, body?: unknown): Promise<Response>
  del(path: string): Promise<Response>
  close(): void                                                       // sqlite.close() + rmSync(dataDir)
}
export async function createTestApp(opts?: { env?: Record<string, string>; signup?: boolean }): Promise<TestApp>
```

Implementation: `mkdtempSync(join(tmpdir(), 'opendoist-'))` as data dir; `loadConfig({ OPENDOIST_DATA_DIR: dir, OPENDOIST_LOG_LEVEL: 'silent', ...opts?.env })`; full boot pipeline (secrets → openDb → auth → bus → createApp). When `signup !== false`: POST `/api/auth/sign-up/email` with `{ name: 'Test', email: 'test@example.com', password: 'password1234' }`, capture `set-cookie` into `cookie`, resolve `userId` via `/api/auth/get-session` (send cookie). Authed verbs send `{ cookie, 'content-type': 'application/json' }` and use `app.request()`. Also export `export async function json<T>(res: Response): Promise<T>`.

- [ ] **Step 16: `src/boot.test.ts`.** Tests: (1) health returns 200 `{status:'ok'}`; (2) fresh instance `GET /api/v1/info` → `first_run: true`, `registration_open: true`, `available_importers: []`; (3) after signup `first_run: false` and (no `OPENDOIST_ALLOW_REGISTRATION`) `registration_open: false`; (4) `GET /api/v1/openapi.json` → 200 with `info.title === 'OpenDoist API'`; (5) `GET /api/v1/docs` → 200 HTML; (6) unauthenticated `GET /api/v1/tasks` → 401 with `content-type: application/problem+json` (the guard runs before routing, so this passes while routers are stubs); (7) secrets.json exists in temp dir with all four keys.

- [ ] **Step 17: Install & gate.** `cd /Users/pranav/developer/opendoist && pnpm install` (once). Run Step 7 migration generation. Then: `pnpm --filter @opendoist/server test` → boot tests pass; `pnpm typecheck` clean; `pnpm lint` clean (`pnpm lint:fix` for trivia). Smoke boot: `OPENDOIST_DATA_DIR=/tmp/od-smoke pnpm --filter @opendoist/server exec tsx src/index.ts &` then `curl -fsS localhost:7968/api/health` → `{"status":"ok"}`; kill it; `rm -rf /tmp/od-smoke`. Do NOT commit.

---

### Task B: Tasks CRUD router

**Files:** Replace `apps/server/src/api/routes/tasks.ts`; Create `apps/server/src/api/routes/tasks.test.ts`

**AS-BUILT CHECK:** Read `src/api/schemas.ts`, `src/services/task-read.ts`, `src/services/task-write.ts`, `src/test/helpers.ts` as Task A actually wrote them; match signatures exactly.

Routes (all under `/tasks`, all zod-openapi `createRoute`, security `[{cookieAuth:[]},{bearerAuth:[]}]`):

| Method+Path | Request | Response | Behavior |
|---|---|---|---|
| GET `/tasks` | query: `ListQuerySchema` + `project_id?`, `section_id?`, `parent_id?`, `label?` (name) | 200 `{results: TaskDto[], next_cursor}` | Open tasks only (`completed_at IS NULL AND deleted_at IS NULL`), keyset order `(child_order, id)`, filters ANDed; `label` joins task_labels |
| GET `/tasks/completed` | query: `ListQuerySchema` + `project_id?` | 200 list | `completed_at IS NOT NULL`, keyset order `(completed_at DESC, id)`. **Register BEFORE `/tasks/{id}`** |
| POST `/tasks` | `CreateTaskSchema` | 201 TaskDto | Resolve due input (Step 10 semantics, ctx from `getSettings`+`parseContextFor`); `createTask` service; `logActivity task_added`; bus `task.created` |
| GET `/tasks/{id}` | — | 200 TaskDto / 404 problem | 404 when missing, deleted, or other user's |
| PATCH `/tasks/{id}` | `UpdateTaskSchema` | 200 TaskDto | Partial update; `labels` present = replace-set via `resolveLabelIds`; `due` handling incl. `null` clear; bumps `updated_at`; `logActivity task_updated` (payload = changed keys); bus `task.updated` |
| DELETE `/tasks/{id}` | — | 204 | Soft delete: set `deleted_at` on the task AND all descendants (recursive CTE or loop); `logActivity task_deleted`; bus `task.deleted` with all ids |
| POST `/tasks/{id}/move` | `{ project_id?, section_id?, parent_id? }` (at least one) | 200 TaskDto | Moving project moves whole subtree (descendants follow project_id, keep section null); `child_order` = append in destination; 400 problem if `parent_id` would create a cycle; `logActivity task_updated` payload `{moved: true}`; bus `task.updated` |
| POST `/tasks/reorder` | `{ items: [{ id, child_order }] (min 1) }` | 204 | Batch update child_order; ids must all belong to user else 404; bus `task.updated` with ids |

**Tests (tasks.test.ts, each a real HTTP round-trip via createTestApp):** create-minimal (defaults: inbox project, priority 4, child_order 0) · create with `due: { string: 'tomorrow 4pm' }` → due.date = tomorrow-in-UTC-ctx, time '16:00', `is_recurring: false` · create with labels `['home','errands']` auto-creates labels then `GET /labels`-independent check via task DTO · content `'* Read-only ritual'` → `uncompletable: true` · list pagination: create 3, `limit=2` → 2 results + non-null cursor; follow cursor → 1 + null · project_id filter · PATCH priority+labels replace-set · PATCH `due: null` clears all due fields · DELETE cascades to subtask (child 404s after) · move to new project carries subtask · reorder swaps order · cycle move → 400 · foreign task id → 404 · invalid cursor → 400 problem · POST with read-scope API key → 403 (create key via `deps.auth.api.createApiKey({ body: { name: 't', permissions: { opendoist: ['read'] } }, headers })` then send `Authorization: Bearer <key>`).

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/api/routes/tasks.test.ts` → all pass. `pnpm typecheck && pnpm lint` clean.

---

### Task C: Task actions router — Quick Add, close/reopen with recurrence

**Files:** Replace `apps/server/src/api/routes/task-actions.ts`; Create `apps/server/src/services/quick-resolve.ts`, `apps/server/src/api/routes/task-actions.test.ts`

**AS-BUILT CHECK:** `grep -n "nextOccurrence" packages/core/src/recurrence/engine.ts` — confirm signature `nextOccurrence(spec, { after: { date, time }, ctx })` returns `{date, time} | null`. Confirm `parseQuickAdd` return type fields against `packages/core/src/types.ts` (`ParsedQuickAdd`). Read Task A's services for exact helper signatures.

`src/services/quick-resolve.ts` (used only by this task): `resolveProject(db, userId, name)` / `resolveSection(db, userId, projectId, name)` — case-insensitive match on non-deleted rows; when absent, CREATE (project: palette `charcoal`, child_order append; section: section_order append) and return `{ id, created: boolean }`.

Routes:

| Method+Path | Request | Response | Behavior |
|---|---|---|---|
| POST `/tasks/quick` | `{ text: z.string().min(1) }` | 201 TaskDto | `parseQuickAdd(text, parseContextFor(getSettings(db, userId)))` → map: title→content, description, priority, durationMin, deadline, due (date/time/string=matched token text? NO — persist `due_string` = the raw due token text from `parsed.due.string`), recurrence; `#project`/`/section` resolved via quick-resolve (auto-create); labels via `resolveLabelIds`; uncompletable from parse. Parsed `reminders` are NOT persisted in this phase (phase 6) — ignore them silently. `logActivity task_added` payload `{ via: 'quick' }`; bus `task.created` |
| POST `/tasks/{id}/close` | body `{ complete_series: z.boolean().default(false) }` (optional body) | 200 TaskDto | See completion rules below |
| POST `/tasks/{id}/reopen` | — | 200 TaskDto | Only for tasks with `completed_at != null` (else 409 problem `not completed`); sets `completed_at = null`, reopens completed ancestors chain; decrements that completion-date's `day_stats.completed_count` (floor 0); `logActivity task_uncompleted`; bus `task.uncompleted` |

**Completion rules (spec §2.2, exact):** Let `settings = getSettings`, `ctx = parseContextFor(settings)`, `todayTz = dateInTz(ctx.now, ctx.timezone)` (import `dateInTz` from core).
1. `uncompletable: true` → 409 problem `task is uncompletable`.
2. Non-recurring (`recurrence` null) OR `complete_series: true`: set `completed_at = nowIso()` on task and every open descendant; one `logActivity task_completed` per closed task; `day_stats` upsert `(userId, todayTz) completed_count + 1` (count the root only); bus `task.completed` with all closed ids.
3. Recurring occurrence complete: `after = spec.anchor === 'completion' ? { date: todayTz, time: task.dueTime } : { date: task.dueDate, time: task.dueTime }`; `next = nextOccurrence(spec, { after, ctx })`. If `next === null` (past `until`) → fall through to rule 2 (final completion). Else update `due_date/due_time` to `next` (keep `due_string`, `recurrence`), `completed_at` stays null; `logActivity task_completed` payload `{ recurring: true, next_due: next.date }`; `day_stats` +1; bus `task.completed` then `task.updated` (same id).

**Tests:** quick minimal `'buy milk'` → inbox, p4 · full `'Submit report tom 4pm p1 #Work /Admin @email {july 30} // context'` → project 'Work' auto-created, section 'Admin', label 'email', priority 1, due date/time correct, deadline `…-07-30`, description 'context' (freeze `ctx.now` by seeding settings timezone 'UTC'; assert dates relative to real now: compute expected in the test with core's own helpers, never hardcode today) · quick reuses existing project case-insensitively (`#work` → same id, no duplicate) · uncompletable close → 409 · non-recurring close sets `completed_at`, closes open subtask, day_stats row = 1 · reopen clears, day_stats back to 0 · recurring `'water plants every day'` close → `completed_at` null, due advanced +1 day, `is_recurring` still true · `every!`-anchored (create via quick `'stretch every! 3 days'`) close → due = today+3 · `complete_series: true` on recurring → really completed · close on 404/foreign id → 404.

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/api/routes/task-actions.test.ts` green; typecheck + lint clean.

---

### Task D: Projects + Sections routers

**Files:** Replace `apps/server/src/api/routes/projects.ts`, `apps/server/src/api/routes/sections.ts`; Create tests `projects.test.ts`, `sections.test.ts` (same dir)

Projects routes: GET `/projects` (query `include_archived` via `queryBool(false)`; NO pagination — return all, ordered `(parent_id, child_order)`, in the standard `{results: [...], next_cursor: null}` envelope); POST `/projects` `{ name, description?, color?, parent_id?, is_favorite? }` → 201 (child_order append among siblings); GET `/projects/{id}`; PATCH `/projects/{id}` (name/description/color/parent_id/is_favorite/is_collapsed/view_prefs; reparenting to own descendant → 400); DELETE `/projects/{id}` → 204 soft-delete project + its sections + its tasks (subtree of child projects too); POST `/projects/{id}/archive` and `/unarchive` → 200 ProjectDto (archives descendants' `is_archived` too); POST `/projects/reorder` `{ items: [{id, child_order}] }` → 204. **Inbox rules:** `is_inbox` project → DELETE and archive → 403 problem `inbox is undeletable`; PATCH allowed for `is_collapsed`/`view_prefs` only (400 otherwise). Activities: `project_added/updated/archived/unarchived/deleted`; bus `project.*`.

Sections routes: GET `/sections` (query `project_id` OPTIONAL — omitted returns ALL of the user's sections ordered `(project_id, section_order)`, with the param that project's sections ordered `section_order`; phase 4's `useSections()` and phase 8's bare `opendoist sections` call this with no param; `{results, next_cursor: null}` envelope); POST `/sections` `{ project_id, name }` → 201 append; PATCH `/sections/{id}` (name/section_order/is_archived/is_collapsed); DELETE `/sections/{id}` → 204 soft-delete; tasks in the section move to `section_id = null` (stay in project); POST `/sections/reorder` → 204. Activities `section_*`; bus `section.*`.

**Tests:** signup seeds Inbox (GET /projects contains `is_inbox: true`) · GET /projects responds `{results, next_cursor: null}` (envelope, not a bare array) · inbox delete → 403, archive → 403 · create/reparent/cycle-400 · archive cascades to child project · delete cascades: child project's tasks 404 afterward · reorder persists · sections: bare GET /sections (no `project_id`) returns sections across projects, `project_id` narrows, create appends order, delete nulls task section_id (create task in section via POST /tasks first), reorder works · foreign/404 cases.

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/api/routes/projects.test.ts src/api/routes/sections.test.ts` green; typecheck + lint clean.

---

### Task E: Labels + Filters routers

**Files:** Replace `apps/server/src/api/routes/labels.ts`, `apps/server/src/api/routes/filters.ts`; Create tests `labels.test.ts`, `filters.test.ts`

**AS-BUILT CHECK:** `grep -n "export function parseFilter" packages/core/src/filter/*.ts` — must exist and be exported from `@opendoist/core` (phase 2 integration finished it). If absent, STOP and report.

Labels: GET `/labels` (all, ordered item_order, `{results, next_cursor: null}` envelope); POST `/labels` `{ name, color?, is_favorite? }` → 201; duplicate name (case-insensitive, per user) → 409 problem `label exists`; PATCH `/labels/{id}` (rename also checks 409); DELETE `/labels/{id}` → 204 (soft-delete label + hard-delete its `task_labels` junction rows); POST `/labels/reorder` → 204. Activities `label_*`; bus `label.*`.

Filters: GET `/filters` (same envelope); POST `/filters` `{ name, query, color?, is_favorite? }` → 201 — validate `query` with core `parseFilter(query)`; on `FilterSyntaxError` → 400 problem `invalid filter query` with `{ position }` extra; PATCH `/filters/{id}` (query revalidated when present); DELETE → 204 soft; POST `/filters/reorder` → 204. Activities `filter_*`; bus `filter.*`.

**Tests:** label CRUD + 409 duplicate (`'Home'` then `'home'`) · label delete removes it from a task's DTO labels (create task with the label, delete label, re-GET task → `labels: []`) · reorder · filter valid query `'(today | overdue) & #Work'` saves · invalid `'today &'` → 400 with numeric `position` · PATCH to invalid query → 400, row unchanged · filter CRUD round-trip.

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/api/routes/labels.test.ts src/api/routes/filters.test.ts` green; typecheck + lint clean.

---

### Task F: Comments + Attachments (upload/serve)

**Files:** Replace `apps/server/src/api/routes/comments.ts`, `apps/server/src/api/routes/attachments.ts`; Create tests `comments.test.ts`, `attachments.test.ts`

Attachments: POST `/attachments` — multipart form (`file` field required) via `await c.req.parseBody()`; reject non-File → 400; `file.size > config.uploadMaxMb * 1024 * 1024` → 413 problem `upload too large`; sanitize filename (basename only, strip `/\` and null bytes, non-empty fallback `'file'`); write to `<dataDir>/attachments/<attachmentId>/<fileName>` (mkdir recursive); insert row (`filePath` = `<attachmentId>/<fileName>`); 201 AttachmentDto with `file_url = /api/v1/attachments/{id}/{file_name}`. GET `/attachments/{id}/{filename}` — 404 unless row exists, belongs to user, and filename matches; stream file with stored `file_type` content-type and `Content-Disposition: attachment; filename="…"` (inline for `image/*`); path traversal in param → 404 (sanitization makes it unmatchable).

Comments: GET `/comments?task_id=` (required; ordered created_at asc; ListQuery pagination keyset `(created_at, id)`); POST `/comments` `{ task_id, content (min 1), attachment_id? }` → 201 CommentDto (attachment joined; 400 if attachment_id unknown/foreign); PATCH `/comments/{id}` `{ content }`; DELETE → 204 soft. Activities `comment_added/updated/deleted` with `projectId` = task's project; bus `comment.*` (+ include the task id in `ids[1]` so clients can refresh the task's comment count: `ids: [commentId, taskId]`).

**Tests:** upload text file via `new FormData()` + `new File(['hello world'], 'notes.txt', { type: 'text/plain' })` through `app.request` → 201, file exists on disk under temp dataDir · download round-trips bytes + content-type · oversize (set env `OPENDOIST_UPLOAD_MAX_MB: '1'`, upload 1.5MB Uint8Array) → 413 · filename `'../../evil.txt'` sanitized (stored as `evil.txt`, no file outside attachments dir) · comment CRUD on a task, attachment attached appears in DTO · comments list pagination · foreign task → 404 · comment on deleted task → 404.

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/api/routes/comments.test.ts src/api/routes/attachments.test.ts` green; typecheck + lint clean.

---

### Task G: User/Settings + Activities routers

**Files:** Replace `apps/server/src/api/routes/user.ts`, `apps/server/src/api/routes/activities.ts`; Create tests `user.test.ts`, `activities.test.ts`

User: GET `/user` → `{ id, name, email, two_factor_enabled: boolean, created_at }` (from better-auth `user` table); PATCH `/user` `{ name?: string.min(1) }` → 200 (email/password changes go through better-auth's own `/api/auth/*` endpoints — do not reimplement; document in route description). GET `/user/settings` → 200 Settings (via `getSettings`; the canonical camelCase document from Task A Step 10); PATCH `/user/settings` — body = `SettingsSchema.partial()`, EXTRA validation: `timezone` must satisfy `Intl.supportedValuesOf('timeZone')` membership → else 400 problem `invalid timezone`; merge onto stored (SHALLOW at top level; inside `viewPrefs` replace per-key: `{...stored.viewPrefs, ...patch.viewPrefs}` — phase 5 depends on these exact semantics), persist, bus `settings.updated` (`ids: [userId]`), return merged.

Activities: GET `/activities` query = ListQuery + `event_type?` (enum from `ActivityEventTypes`) + `entity_type?` + `project_id?` + `since?`/`until?` (ISO date strings, compared against `at`); ordered `(at DESC, id)` keyset pagination; 200 `{results: ActivityDto[], next_cursor}`. Read-only (no POST).

**Tests:** GET /user matches signup name/email · PATCH name persists · settings defaults exactly `SettingsSchema.parse({})` on fresh user · PATCH `{ timezone: 'America/New_York', dailyGoal: 3 }` merges (other fields untouched) · PATCH `{ viewPrefs: { today: { groupBy: 'priority' } } }` replaces only the `today` key, leaving other viewPrefs keys intact · bad timezone `'Mars/Olympus'` → 400 · settings PATCH publishes `settings.updated` (subscribe on `deps.bus`) · activities: perform create/update/complete/delete task sequence then list → event_types in DESC-time order, filter by `event_type=task_completed` returns 1, `project_id` filter works, pagination cursor works, foreign user's rows never leak.

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/api/routes/user.test.ts src/api/routes/activities.test.ts` green; typecheck + lint clean.

---

### Task H: Search router (FTS5)

**Files:** Replace `apps/server/src/api/routes/search.ts`; Create `apps/server/src/api/routes/search.test.ts`

**AS-BUILT CHECK:** Read the FTS migration Task A generated (`apps/server/drizzle/*fts5*.sql`) — table/column names there are authoritative (`tasks_fts(content, description)`, `comments_fts(content)`, rowid-joined).

Route: GET `/search` query `{ q: z.string().min(1), limit: z.coerce.number().int().min(1).max(50).default(20), cursor?: string, include_completed: queryBool(false) }` → 200 `{ results: [{ task: TaskDto, matched_in: 'task' | 'comment' }], next_cursor }`.

Implementation (raw SQL through `deps.sqlite.prepare` — Drizzle has no FTS bindings): sanitize `q` into an FTS5 prefix query — split on whitespace, strip `"'*():^-`, drop empties, each term becomes `"term"*`, join with spaces; empty after sanitize → 200 empty results. Query A: `SELECT t.id, bm25(tasks_fts) AS rank FROM tasks_fts JOIN tasks t ON t.rowid = tasks_fts.rowid WHERE tasks_fts MATCH ? AND t.user_id = ? AND t.deleted_at IS NULL {AND t.completed_at IS NULL unless include_completed}`. Query B: same via `comments_fts JOIN comments c … JOIN tasks t ON t.id = c.task_id` (comment + task not deleted). Merge: task-matches win over comment-matches for the same task id; order by rank asc then id; offset-cursor `encodeCursor({ offset })`, slice `limit + 1`. Map to DTOs via `tasksToDtos`.

**Tests:** seed via API: tasks `'Buy groceries'` (description `'almond milk'`), `'Review budget spreadsheet'`, task with comment `'discussed groceries strategy'`; search `groceries` → 2 results, the direct task ranked with `matched_in: 'task'`, the comment one `matched_in: 'comment'` · prefix `grocer` matches · description match (`almond`) works · completed task excluded by default, included with `include_completed=true` (complete via `/close`) · soft-deleted task never returned · updated content is re-indexed (PATCH content then search new term) · injection input `'groceries" OR 1=1 --'` and `'*'` return 200 (no 500) · pagination with `limit=1` walks all results.

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/api/routes/search.test.ts` green; typecheck + lint clean.

---

### Task I: SSE events endpoint

**Files:** Replace `apps/server/src/api/routes/events.ts`; Create `apps/server/src/api/routes/events.test.ts`

Route: GET `/events` (authed like everything else — cookie or `od_` bearer; register in OpenAPI with a `text/event-stream` 200 description). Implementation via `streamSSE` from `hono/streaming`:
1. Replay: `Last-Event-ID` header (or `?last_event_id=` query, header wins) parsed as int → for each `bus.since(lastId)` event, `writeSSE({ event: 'sync', id: String(e.id), data: JSON.stringify({ type, entity, ids, at }) })`.
2. Subscribe: `bus.subscribe` pushes live events in the same shape; unsubscribe in `stream.onAbort` AND in a `finally`.
3. Heartbeat: every 25s `writeSSE({ event: 'ping', data: '' })`; loop `while (!stream.aborted)` with `await stream.sleep(...)`; queue live events through an array + wake pattern (no unbounded promises): keep a local queue filled by the subscriber, drained each loop tick (sleep 250ms between drains, heartbeat counter every 100 ticks).
4. Errors mid-stream don't hit `onError` (dossier §3.1 caveat) — wrap the loop body in try/catch, log, break.

**Tests** (SSE over `app.request` — read the body stream with a `ReadableStream` reader + `TextDecoder`, with hard timeouts):
- unauthenticated → 401 before any stream.
- open stream, then `deps.bus.publish({ type: 'task.created', entity: 'task', ids: ['x1'] })` → within 2s the raw text contains `event: sync`, `id: 1`, and the JSON payload; cancel reader.
- replay: publish 3 events BEFORE connecting, connect with `Last-Event-ID: 1` → first two frames received are ids 2 and 3.
- ring-buffer unit check (in the same file): publish 300 events on a fresh `EventBus(256)` → `since(0).length === 256`, first id 45.
- a real mutation emits: open stream, POST `/tasks` via helper → `task.created` frame arrives.

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/api/routes/events.test.ts` green (no hanging handles — reader.cancel() everywhere); typecheck + lint clean.

---

### Task J: Auth + info integration tests

**Files:** Create `apps/server/src/auth.test.ts`, `apps/server/src/api/info.test.ts` (tests only — if auth wiring itself is broken, fix `src/auth.ts`/`src/app.ts` ONLY if no other task lists them, which none do; keep diffs minimal and note them)

`auth.test.ts`:
- signup → 200, `set-cookie` contains `better-auth.session_token`; `GET /api/auth/get-session` with cookie returns the user.
- password is argon2id: read `account` row for the user directly from `deps.db` → `password` starts with `$argon2id$`.
- sign-in wrong password → 4xx from better-auth; correct password → fresh session cookie authenticates. IMPORTANT: routers may still be stubs while this task runs — test ONLY `/api/health`, `/api/v1/info`, `/api/auth/*`, and Task A's guard semantics: authed GET `/api/v1/__nonexistent` → 404 problem; unauthenticated → 401 problem.
- registration lock: second signup (different email) → 4xx (better-auth surfaces the FORBIDDEN APIError); with `createTestApp({ env: { OPENDOIST_ALLOW_REGISTRATION: 'true' } })` second signup succeeds.
- first-user seeding: after signup, `projects` table has exactly one `is_inbox` row and `user_settings` has defaults.
- API keys: `deps.auth.api.createApiKey({ body: { name: 'cli', permissions: { opendoist: ['read'] } }, headers: <cookie headers> })` → returned key starts `od_`; GET `/api/v1/info` trivially public, so assert via guard: GET `/api/v1/__x` with `Authorization: Bearer <od key>` → 404 (authenticated), POST `/api/v1/__x` with read-only key → 403 problem `insufficient scope`; read_write key → 404; garbage `Bearer od_nope` → 401.
- TOTP: `POST /api/auth/two-factor/enable` with body `{ password }` via cookie → 200 with `totpURI` (assert string contains `otpauth://`). (Full verify-code flow is web-phase; enable proves the plugin is mounted.)
- OIDC: `createTestApp({ env: { OPENDOIST_OIDC_ISSUER: 'https://id.example.com', OPENDOIST_OIDC_CLIENT_ID: 'x', OPENDOIST_OIDC_CLIENT_SECRET: 'y', OPENDOIST_OIDC_NAME: 'Example' }, signup: false })` → `/api/v1/info` shows `auth_providers.oidc.name === 'Example'`. (No live OIDC round-trip — provider is fake.)

`info.test.ts`: exact-shape snapshot of `/api/v1/info` against `InfoDtoSchema.parse` pre/post signup; `features` all false except push false too; version string non-empty; `OPENDOIST_VERSION=9.9.9` env → version `'9.9.9'`.

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/auth.test.ts src/api/info.test.ts` green; typecheck + lint clean.

---

### Task K: Platform unit tests (config, secrets, helpers, bus, db)

**Files:** Create `apps/server/src/config.test.ts`, `apps/server/src/secrets.test.ts`, `apps/server/src/lib/pagination.test.ts`, `apps/server/src/lib/problem.test.ts`, `apps/server/src/db/db.test.ts`

- `config.test.ts`: empty env → every default (port 7968, dataDir `/data`, uploadMaxMb 25, retention 14, cron `0 3 * * *`, version ends `-dev`); full env override round-trip incl. `OPENDOIST_TRUST_PROXY=1` truthiness table (`1/true/yes/TRUE` true; `0/false/no` false); OIDC only materializes when issuer+id+secret all present; bad `OPENDOIST_PORT=abc` → throws zod error.
- `secrets.test.ts`: fresh tmpdir → creates `attachments/`, `backups/`, `secrets.json` mode `0o600` (check `statSync(...).mode & 0o777`); all four keys present; VAPID public key decodes from base64url to 65 bytes starting `0x04`, private key 32 bytes; second call returns IDENTICAL values (idempotent); file with only `sessionSecret` pre-seeded → preserved, others filled.
- `pagination.test.ts`: encode/decode round-trip; `decodeCursor('!!!not-b64json')` → null; ListQuerySchema defaults limit 50, caps at 200 (201 → zod fail).
- `problem.test.ts`: build a throwaway Hono app with a route calling `problem(c, 404, 'not found', 'task missing')` → status 404, `content-type: application/problem+json`, body has `type/title/status/detail`.
- `db.test.ts`: `openDb` on a tmp file → `pragma journal_mode` returns `wal`, `foreign_keys` 1, `busy_timeout` 5000; migrations created tables — `sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()` includes all of: projects, sections, tasks, labels, task_labels, filters, comments, attachments, activity_log, day_stats, user_settings, user, session, account, verification, two_factor, apikey, tasks_fts, comments_fts; inserting + updating a task row through raw SQL keeps `tasks_fts` in sync (`SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'unicorn'`).

**Verify:** `pnpm --filter @opendoist/server exec vitest run src/config.test.ts src/secrets.test.ts src/lib src/db/db.test.ts` green; typecheck + lint clean.

---

### Task L: Docker packaging + GHCR workflow

**Files:** Create `Dockerfile` (repo root), `.dockerignore`, `.github/workflows/docker.yml`

**AS-BUILT CHECK:** confirm `apps/web/package.json` build script outputs to `apps/web/dist` (`vite build` default); confirm server start is `tsx src/index.ts` and migrations live in `apps/server/drizzle` (they must be COPYed); confirm `pnpm-lock.yaml` exists at root.

`Dockerfile` (multi-stage node:22-alpine, spec §3.5 + dossier §4.2):

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @opendoist/web build
RUN pnpm --filter @opendoist/server --prod deploy /out/server

FROM node:22-alpine AS runtime
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=build /out/server ./server
COPY --from=build /app/apps/web/dist ./web-dist
ARG OPENDOIST_VERSION=nightly
ENV NODE_ENV=production \
    OPENDOIST_VERSION=${OPENDOIST_VERSION} \
    OPENDOIST_DATA_DIR=/data \
    OPENDOIST_WEB_DIST=/app/web-dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 7968
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:7968/api/health || exit 1
WORKDIR /app/server
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
```

Notes baked into the task: `pnpm deploy` produces a self-contained `node_modules` (workspace `@opendoist/core` copied in — tsx loads its TS sources fine); better-sqlite3 and @node-rs/argon2 ship musl prebuilds — if `pnpm install` tries to compile, add `RUN apk add --no-cache python3 make g++` to the build stage only and note it. `apk add wget` is belt-and-braces (busybox wget exists but GNU wget's `--no-verbose` behavior matches Karakeep's healthcheck exactly).

`.dockerignore`:

```
.git
node_modules
**/node_modules
**/dist
data
**/data
docs
assets
*.md
.github
```

(`**/dist` is safe: web dist is built inside the image.)

`.github/workflows/docker.yml` — Karakeep-template (dossier §4.2/§4.9): name `Docker`; triggers `push: branches: [main]` (→ `nightly`), `release: types: [published]` (→ `X.Y.Z`, `X.Y`, `latest`), `workflow_dispatch`. `env: IMAGE: ghcr.io/pranav-karra-3301/opendoist`. Job `build` matrix `include: [{runner: ubuntu-latest, arch: amd64}, {runner: ubuntu-24.04-arm, arch: arm64}]`, `runs-on: ${{ matrix.runner }}`, `permissions: { contents: read, packages: write }`; steps: checkout → `docker/setup-buildx-action@v3` → `docker/login-action@v3` (registry ghcr.io, user `${{ github.actor }}`, password `GITHUB_TOKEN`) → compute `VERSION` step (release: tag without `v`; else `nightly`) → `docker/build-push-action@v6` with `push: true`, `tags: ${{ env.IMAGE }}:${{ steps.version.outputs.version }}-${{ matrix.arch }}`, `build-args: OPENDOIST_VERSION=${{ steps.version.outputs.version }}`, `cache-from: type=registry,ref=${{ env.IMAGE }}-build-cache:${{ matrix.arch }}`, `cache-to: type=registry,ref=${{ env.IMAGE }}-build-cache:${{ matrix.arch }},mode=max`. Job `merge` (needs build, ubuntu-latest, same permissions + login): `docker buildx imagetools create -t $IMAGE:$VERSION $IMAGE:$VERSION-amd64 $IMAGE:$VERSION-arm64`; on release additionally `-t $IMAGE:latest -t $IMAGE:${VERSION%.*}`. No QEMU anywhere.

**Verify:** `docker build -t opendoist:phase3 .` then `docker run -d --rm -p 7968:7968 --name od-test opendoist:phase3`, `sleep 3 && curl -fsS localhost:7968/api/health` → `{"status":"ok"}`, `curl -fsS localhost:7968/api/v1/info | grep -o '"first_run":true'`, `docker stop od-test`. If no Docker daemon is available on this machine, state in your notes that image verification is deferred to the integration gate / CI.

---

### Task M: Integration gate (SEQUENTIAL — after B–L)

**Files:** may touch anything needed to make the gate pass (smallest possible diffs); no route stubs may remain (grep `-r "stub so Task A boots" apps/server/src` → empty).

- [ ] **Step 1:** `pnpm install` (only if any manifest changed), then `pnpm verify` (lint + typecheck + test + build across the workspace) → green. Fix failures with minimal diffs; record every fix.
- [ ] **Step 2: End-to-end scenario against a live server.** Boot: `OPENDOIST_DATA_DIR=/tmp/od-e2e pnpm --filter @opendoist/server exec tsx src/index.ts &`. Then with curl (cookie jar `-c/-b /tmp/od-e2e.cookies`):
  1. `POST /api/auth/sign-up/email` `{name, email, password}` → 200; second signup different email → failure (registration locked).
  2. `GET /api/v1/info` → `first_run:false`.
  3. `POST /api/v1/tasks/quick` `{"text":"Pay rent tomorrow 9am p2 #Bills @finance {aug 1}"}` → 201; assert due.time `"09:00"`, priority 2, deadline `-08-01` suffix, project auto-created (GET /api/v1/projects has `Bills`).
  4. `POST /api/v1/tasks/quick` `{"text":"water plants every day"}` → close it via `/close` → due advanced one day, `completed_at` null.
  5. Open `curl -N -m 5 …/api/v1/events` in background, `POST /api/v1/tasks` a task, grep captured output for `event: sync` and `task.created`.
  6. `GET /api/v1/search?q=rent` → 1 result.
  7. Create `od_` API key via `POST /api/auth/api-key/create` (cookie) → use `Authorization: Bearer od_…` for `GET /api/v1/tasks` (200) and, if the key was read-only, `POST /api/v1/tasks` (403).
  8. `GET /api/v1/openapi.json` → contains paths `/api/v1/tasks`, `/api/v1/tasks/quick`, `/api/v1/search`, `/api/v1/events`; `GET /api/v1/docs` → 200 HTML.
  9. Kill server; re-boot with same DATA_DIR → data persists (`GET /api/v1/tasks` still lists), secrets.json unchanged (diff before/after).
- [ ] **Step 3:** Docker: if a daemon is available run Task L's verify block end-to-end (build, run, health, info). Otherwise mark "docker build unverified locally — CI will exercise it" in notes.
- [ ] **Step 4:** Cleanup `/tmp/od-e2e*`. Confirm no file outside `apps/server`, root Docker files, `.github/workflows/docker.yml`, and `pnpm-workspace.yaml`/`pnpm-lock.yaml` changed (`git status`). Do not commit — report ready-for-checkpoint.

## Self-Review (done)

- Spec §3.2 coverage: Hono+zod-openapi+Scalar (A), REST resources tasks/quick/projects/sections/labels/filters/comments/search/user-settings/activities/info/health (A–H), cursor pagination + nanoid ids + RFC 9457 (A, enforced per-router), SSE with Last-Event-ID ring buffer (A bus + I), Drizzle/better-sqlite3 boot order + FTS5 custom migration (A), soft-delete everywhere (schema + routers; 30-day purge job explicitly deferred to phase 9 nightly-jobs work), better-auth password/argon2id/api-key `od_` scopes/TOTP/registration-lock (A + J). Reminders/scheduler/channels/ics/ramble/backup-cron: later phases by design; `backupRetention`/`backupCron` config keys land now so the env surface is complete and documented once.
- Spec §3.5: port 7968, `/data` bootstrap with auto-generated secrets.json incl. VAPID (node:crypto, web-push-compatible), every listed env var in `loadConfig`, health+info endpoints, Dockerfile+HEALTHCHECK+SPA static serving, GHCR multi-arch workflow with version build-arg (L). Update-check job itself is phase 9 (`disableUpdateCheck` config lands now).
- Spec §3.6: wall-clock due + user-tz `ParseContext` from settings (A `parse-context.ts`), completion advance uses core `nextOccurrence` (C); DST correctness is core's tested responsibility.
- Deviations recorded: (1) generic OIDC via better-auth `genericOAuth` plugin instead of `@better-auth/sso` package — same env-driven behavior, no DB seeding, fewer moving parts; revisit when Settings-managed providers arrive. (2) `/tasks/quick` drops parsed reminder drafts until phase 6 (response shape stable). (3) Server runs under tsx in the image (no build step) — matches core's source-consumed pattern; revisit if cold-start matters.
- Parallel safety: 11 builder tasks (B–L) with strictly disjoint file lists; shared logic (task DTO mapping, createTask, label resolution, settings read) frozen in Task A services; router files are stub-replaced wholesale; mount order fixed in A so `/tasks/quick` never shadows.
- Placeholder scan: stubs are explicitly temporary (gate M greps them away); no TBD/TODO remains in frozen code.
