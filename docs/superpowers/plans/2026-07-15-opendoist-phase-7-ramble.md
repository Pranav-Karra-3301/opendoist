# OpenDoist Phase 7: Ramble — Voice Capture, STT Adapters, LLM Extraction, Review-Confirm UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This run executes via a Workflow: Task A first (sequential), Tasks B–M in parallel (disjoint file sets, no commits, no `pnpm install`), Task N integrates.** Commits happen at integration checkpoints, not per-task, because tasks run concurrently in one working tree. Implementation agents run as Opus; integration/review agents as Fable.

**Goal:** A working voice→tasks pipeline: hold-to-record in Quick Add → multipart upload → pluggable STT (openai-compatible / Deepgram / ElevenLabs) → optional openai-compatible LLM extraction into structured task drafts (or `none` passthrough) → review-confirm screen that creates real tasks through the same code path as `POST /tasks/quick` and then deletes the audio. Provider config = instance env defaults overridable per-user in Settings → Integrations, API keys AES-GCM-encrypted at rest.

**Architecture:** All Ramble server code lives in `apps/server/src/rambles/` (schemas, provider adapters, pipeline service, routes, confirm mapping, provider-config resolution) plus one crypto helper in `apps/server/src/lib/`. STT and extraction are two independent provider slots behind tiny interfaces; adapters are injectable (`fetchImpl`) so every network call is unit-tested against request-shape mocks. The pipeline is a status machine persisted on the `rambles` row (`uploaded → transcribed → extracted → confirmed`, `failed` + `failed_stage` at any stage; each stage retryable without re-recording). Web code lives in `apps/web/src/ramble/` + one Settings section; the API client + polling hooks are frozen in Task A so all three web tasks consume without edits.

**Tech Stack:** No new dependencies. Node 22 globals cover everything: `fetch`/`FormData`/`Blob`/`File` (adapters), `node:crypto` (AES-256-GCM), Hono `c.req.parseBody()` (multipart). Web: MediaRecorder + AnalyserNode + XMLHttpRequest (upload progress), existing TanStack Query 5 / Zustand / `@opendoist/core`.

**Reference documents (already in repo, read before your task):**
- Spec: `docs/superpowers/specs/2026-07-15-opendoist-design.md` — §3.2 "Ramble" bullet, §2.5 Integrations settings, §3.5 env vars
- Dossier: `docs/superpowers/research/2026-07-15-opendoist-research.md` — §5.7 (capture snippet, provider table, JSON schema, interface sketch, Speaches/whisper.cpp commands)

## Global Constraints

- Priorities stored **1 = highest (p1) … 4 = default**. The LLM extraction prompt uses the same convention.
- Server port **7968**; env prefix **`OPENDOIST_`**; API tokens prefix `od_`; all Ramble data under the `/data` volume (`rambles/` for audio, key material in `/data/secrets.json`).
- Radii 5px/10px only; Kale `#4c7a45` default accent; focus ring always `#1f60c2`; Lucide icons only.
- TypeScript `strict`, no `any` (Biome `noExplicitAny: error`), `verbatimModuleSyntax`; Biome formatting (single quotes, semicolons as-needed).
- Tests colocated `src/**/*.test.ts`, run by Vitest.
- RFC 9457 problem-JSON errors; opaque nanoid ids; routes zod-typed via the repo's established `@hono/zod-openapi` pattern.
- **Recorded deviation (frozen):** the rambles/integrations wire format is **camelCase** JSON (`audioMime`, `durationSec`, `extractedTasks`, `failedStage`, `hasApiKey`, …) — an intentional exception to phase 3's snake_case convention, mirrored end-to-end by Task A's frozen schemas on both server and web (no mapping layer). `GET /rambles` is a single page (limit 50) but still returns the standard `{results, next_cursor: null}` envelope. Do not re-case in later phases without updating both sides.
- Parallel-execution rules: builders touch ONLY their listed files; never run `pnpm install` (Task A declares everything; this phase adds **zero** new deps); never `git commit`.
- **AS-BUILT rule:** Phases 3–6 were built from separate plans and may have drifted. Every "AS-BUILT CHECK:" bullet below is mandatory: inspect the repo at execution time and adapt names/paths to what actually exists — but NEVER change the contracts frozen in Task A (schemas, interfaces, route paths, wire formats).

### Shared AS-BUILT map (Task A verifies and records; all tasks read Task A's notes)

Task A MUST resolve each of these against the real repo and write the answers into `apps/server/src/rambles/AS_BUILT.md` (a plain bullet list, deleted at Task N) so parallel builders don't re-derive them:

1. Server package name + script names (`pnpm --filter @opendoist/server …`, `db:generate` or equivalent drizzle-kit script, how migrations are emitted and applied at boot).
2. Drizzle schema file path (expected `apps/server/src/db/schema.ts`), id/timestamp column conventions (nanoid text pk? ISO-text vs integer-ms timestamps?), and the users table export name for FKs.
3. Auth middleware: how a handler reads the authenticated user id (e.g. `c.get('userId')` or `c.var.user.id`).
4. Problem-JSON error helper (name + import path) and how existing routes return 4xx.
5. The `POST /api/v1/tasks/quick` handler: which service function actually creates the task from a `ParsedQuickAdd` (name, signature, whether it publishes SSE + activity events), and the helper that builds a core `ParseContext` from user settings.
6. `/data/secrets.json` accessor module from phase 3 (`ensureDataDirAndSecrets` — it generates `sessionSecret`, VAPID keys, AND `encryptionKey` at first boot; phase 6 added a VAPID accessor) — extend, don't duplicate, never regenerate existing fields.
7. Env/config module (where `OPENDOIST_*` vars are read; `UPLOAD_MAX_MB` default 25).
8. `GET /api/v1/info` handler location (feature flags `stt`/`llm` must reflect env-level config).
9. SSE bus publish helper (`{type, entity, ids}` shape) if rambles events are one import away.
10. Web: Quick Add component path; settings page registration mechanism; app-root layout (for mounting the review dialog); shared fetch/api util; toast helper; existing chip editors (scheduler/priority/label pickers) reusable in the review screen.

---

### Task A: Contracts, DB migration, provider interfaces, web API client (SEQUENTIAL — everything depends on this)

**Files:**
- Edit: `apps/server/src/db/schema.ts` (AS-BUILT path) — add `rambles` + `provider_settings` tables; run the as-built migration-generation script
- Create: `apps/server/src/rambles/AS_BUILT.md` (answers to the shared AS-BUILT map above)
- Create: `apps/server/src/rambles/schemas.ts`, `apps/server/src/rambles/types.ts`, `apps/server/src/rambles/test-audio.ts`
- Create: `apps/server/src/rambles/providers/types.ts`, `apps/server/src/rambles/providers/registry.ts`
- Create (typed stubs, replaced wholesale by B–H): `apps/server/src/rambles/providers/stt-openai-compatible.ts`, `…/stt-deepgram.ts`, `…/stt-elevenlabs.ts`, `…/extractor-none.ts`, `…/extractor-openai-compatible.ts`, `apps/server/src/rambles/confirm.ts`, `apps/server/src/rambles/provider-config.ts`, `apps/server/src/lib/secret-crypto.ts`
- Create: `apps/web/src/api/rambles.ts`, `apps/web/src/ramble/store.ts`
- Test: `apps/server/src/rambles/schemas.test.ts`

**Interfaces (produces — FROZEN for Tasks B–N):** everything in this task. Parallel tasks implement against these signatures without editing them.

- [ ] **Step 0: AS-BUILT sweep.** Resolve all 10 items in the shared map; write `AS_BUILT.md`. If a stated assumption below conflicts with the repo (e.g. timestamps are integer-ms), adapt the *column types/helpers* to repo convention but keep names and semantics.

- [ ] **Step 1: DB tables** (append to the as-built schema file; follow its column-type conventions):

```ts
export const rambleStatuses = ['uploaded', 'transcribed', 'extracted', 'confirmed', 'failed'] as const
export const rambleFailedStages = ['transcribe', 'extract'] as const

export const rambles = sqliteTable('rambles', {
  id: text('id').primaryKey(), // nanoid, as-built id helper
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status', { enum: rambleStatuses }).notNull().default('uploaded'),
  /** relative to DATA_DIR, e.g. 'rambles/<id>.webm'; null after confirm/discard deletes the file */
  audioPath: text('audio_path'),
  audioMime: text('audio_mime').notNull(),
  audioBytes: integer('audio_bytes').notNull(),
  durationSec: real('duration_sec'),
  transcript: text('transcript'),
  /** JSON string: ExtractedTask[] (schemas.ts) */
  extractedJson: text('extracted_json'),
  error: text('error'),
  failedStage: text('failed_stage', { enum: rambleFailedStages }),
  createdAt: /* as-built timestamp convention */,
  updatedAt: /* as-built timestamp convention */,
})

export const providerSettings = sqliteTable('provider_settings', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  sttProvider: text('stt_provider', { enum: ['openai-compatible', 'deepgram', 'elevenlabs'] }),
  sttBaseUrl: text('stt_base_url'),
  sttModel: text('stt_model'),
  sttApiKeyEnc: text('stt_api_key_enc'),   // secret-crypto envelope, never plaintext
  llmProvider: text('llm_provider', { enum: ['openai-compatible'] }),
  llmBaseUrl: text('llm_base_url'),
  llmModel: text('llm_model'),
  llmApiKeyEnc: text('llm_api_key_enc'),
  updatedAt: /* as-built timestamp convention */,
})
```

Generate the migration with the as-built drizzle-kit script and verify it applies on a scratch DB (as-built boot `migrate()` covers runtime).

- [ ] **Step 2: `apps/server/src/rambles/schemas.ts` (verbatim; adjust only import paths):**

```ts
import { z } from 'zod'

/** One extracted task. `due` is the SPOKEN phrase ('tomorrow 5pm', 'every friday') — never ISO;
 *  the server parses it with core resolveNaturalDate/parseQuickAdd at confirm time. */
export const ExtractedTaskSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().nullable(),
  due: z.string().nullable(),
  priority: z.number().int().min(1).max(4).nullable(), // 1 = highest, matches OpenDoist storage
  labels: z.array(z.string()).default([]),
})
export type ExtractedTask = z.infer<typeof ExtractedTaskSchema>
export const ExtractedTasksSchema = z.object({ tasks: z.array(ExtractedTaskSchema) })

/** JSON Schema sent to openai-compatible LLMs (dossier §5.7). Zod above is the authoritative validator. */
export const EXTRACTED_TASKS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          notes: { type: ['string', 'null'] },
          due: {
            type: ['string', 'null'],
            description: "natural-language date phrase as spoken, e.g. 'tomorrow 5pm'; null if none",
          },
          priority: { type: ['integer', 'null'], minimum: 1, maximum: 4 },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'notes', 'due', 'priority', 'labels'],
      },
    },
  },
  required: ['tasks'],
} as const

export const RambleStatusSchema = z.enum(['uploaded', 'transcribed', 'extracted', 'confirmed', 'failed'])
export type RambleStatus = z.infer<typeof RambleStatusSchema>

/** API shape of a ramble row (audio path intentionally not exposed). */
export const RambleSchema = z.object({
  id: z.string(),
  status: RambleStatusSchema,
  audioMime: z.string(),
  audioBytes: z.number().int(),
  durationSec: z.number().nullable(),
  transcript: z.string().nullable(),
  extractedTasks: z.array(ExtractedTaskSchema).nullable(),
  error: z.string().nullable(),
  failedStage: z.enum(['transcribe', 'extract']).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type RambleDto = z.infer<typeof RambleSchema>

export const RambleListSchema = z.object({ results: z.array(RambleSchema), next_cursor: z.string().nullable().default(null) })
export const ConfirmRambleSchema = z.object({ tasks: z.array(ExtractedTaskSchema).min(1).max(50) })
export const ConfirmRambleResponseSchema = z.object({ createdTaskIds: z.array(z.string()) })

export const SttProviderIdSchema = z.enum(['openai-compatible', 'deepgram', 'elevenlabs'])
export const LlmProviderIdSchema = z.enum(['openai-compatible'])

/** apiKey: string = set (encrypt), null = clear, undefined/absent = keep stored value. */
const KeyPatch = z.union([z.string().min(1), z.null()]).optional()
const SlotPatch = <T extends z.ZodTypeAny>(provider: T) =>
  z.object({
    provider: provider.nullable(),
    baseUrl: z.string().max(500).nullable(),
    model: z.string().max(200).nullable(),
    apiKey: KeyPatch,
  })
export const IntegrationsPutSchema = z.object({
  stt: SlotPatch(SttProviderIdSchema).optional(),
  llm: SlotPatch(LlmProviderIdSchema).optional(),
})
const SlotView = <T extends z.ZodTypeAny>(provider: T) =>
  z.object({
    provider: provider.nullable(),
    baseUrl: z.string().nullable(),
    model: z.string().nullable(),
    hasApiKey: z.boolean(),
    /** where the effective config comes from: user row > env > none */
    source: z.enum(['user', 'env', 'none']),
  })
export const IntegrationsGetSchema = z.object({
  stt: SlotView(SttProviderIdSchema),
  llm: SlotView(LlmProviderIdSchema),
})
export const ProviderTestRequestSchema = z.object({
  /** optional candidate config to test BEFORE saving; apiKey absent → fall back to stored/env key */
  candidate: SlotPatch(z.string()).optional(),
})
export const ProviderTestResponseSchema = z.object({ ok: z.boolean(), detail: z.string().nullable() })
```

- [ ] **Step 3: `apps/server/src/rambles/providers/types.ts` (verbatim):**

```ts
import type { ExtractedTask } from '../schemas'

export interface SttAudio { data: Buffer; mimeType: string; filename: string }
export interface SttOptions { language?: string; prompt?: string }
export interface SttResult { text: string; language?: string; durationSec?: number }

export interface SttProvider {
  readonly id: 'openai-compatible' | 'deepgram' | 'elevenlabs'
  transcribe(audio: SttAudio, opts?: SttOptions): Promise<SttResult>
}

export interface ExtractorContext { now: string; timezone: string; knownLabels: string[] }
export interface TaskExtractor {
  readonly id: 'none' | 'openai-compatible'
  extract(transcript: string, ctx: ExtractorContext): Promise<{ tasks: ExtractedTask[] }>
}

/** Thrown by adapters on non-2xx or malformed responses; message is safe to store in rambles.error. */
export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ProviderError'
  }
}

export type FetchLike = typeof fetch

export interface ResolvedSttConfig {
  provider: 'openai-compatible' | 'deepgram' | 'elevenlabs'
  baseUrl: string | null
  model: string | null
  apiKey: string | null
}
export interface ResolvedLlmConfig {
  provider: 'openai-compatible'
  baseUrl: string | null
  model: string | null
  apiKey: string | null
}
```

- [ ] **Step 4: `apps/server/src/rambles/providers/registry.ts` (verbatim):**

```ts
import { createDeepgramStt } from './stt-deepgram'
import { createElevenLabsStt } from './stt-elevenlabs'
import { createNoneExtractor } from './extractor-none'
import { createOpenAiCompatibleExtractor } from './extractor-openai-compatible'
import { createOpenAiCompatibleStt } from './stt-openai-compatible'
import type { FetchLike, ResolvedLlmConfig, ResolvedSttConfig, SttProvider, TaskExtractor } from './types'

export function createSttProvider(cfg: ResolvedSttConfig, fetchImpl: FetchLike = fetch): SttProvider {
  switch (cfg.provider) {
    case 'openai-compatible':
      return createOpenAiCompatibleStt(cfg, fetchImpl)
    case 'deepgram':
      return createDeepgramStt(cfg, fetchImpl)
    case 'elevenlabs':
      return createElevenLabsStt(cfg, fetchImpl)
  }
}

/** null LLM config → 'none' passthrough extractor (whole transcript becomes one task). */
export function createExtractor(cfg: ResolvedLlmConfig | null, fetchImpl: FetchLike = fetch): TaskExtractor {
  return cfg === null ? createNoneExtractor() : createOpenAiCompatibleExtractor(cfg, fetchImpl)
}
```

- [ ] **Step 5: `apps/server/src/rambles/types.ts` — service + port contracts (verbatim; import `Due`, `Priority`, `ParseContext` from `@opendoist/core`, row/DTO types from `./schemas`, provider types from `./providers/types`):**

```ts
/** Draft ready for creation — same fields the /tasks/quick path produces from ParsedQuickAdd. */
export interface TaskDraft {
  content: string
  description: string | null
  due: Due | null
  priority: Priority
  labels: string[]
}

/** Adapter over the as-built task-creation service used by POST /tasks/quick.
 *  MUST go through the same service (SSE publish + activity log + auto-reminder come for free). */
export type CreateTaskPort = (userId: string, draft: TaskDraft) => Promise<{ id: string }>

export interface RambleServiceDeps {
  db: /* as-built drizzle instance type */
  dataDir: string
  /** null → STT unconfigured → uploads rejected 409 */
  resolveStt: (userId: string) => Promise<SttProvider | null>
  resolveExtractor: (userId: string) => Promise<TaskExtractor>
  createTask: CreateTaskPort
  listLabelNames: (userId: string) => Promise<string[]>
  /** true (default) = upload kicks transcribe→extract asynchronously; tests set false and drive stages */
  autoRun?: boolean
  now?: () => Date
}

export interface RambleService {
  create(userId: string, audio: { data: Buffer; mimeType: string; filename: string }): Promise<RambleDto>
  get(userId: string, id: string): Promise<RambleDto | null>
  list(userId: string, limit?: number): Promise<RambleDto[]>
  /** valid from status 'uploaded' or failed@transcribe; else ConflictError */
  runTranscribe(userId: string, id: string): Promise<RambleDto>
  /** valid from 'transcribed', 'extracted', or failed@extract; else ConflictError */
  runExtract(userId: string, id: string): Promise<RambleDto>
  /** valid from 'extracted' (or 'transcribed' when extractor id === 'none' ran); creates tasks from the
   *  EDITED items in the request, sets status 'confirmed', persists final items, deletes the audio file. */
  confirm(userId: string, id: string, items: ExtractedTask[], ctx: ParseContext): Promise<{ createdTaskIds: string[] }>
  /** hard-deletes row + audio file (rambles are transient capture state, not user-visible tasks) */
  discard(userId: string, id: string): Promise<void>
}

export function createRambleService(deps: RambleServiceDeps): RambleService // implemented by Task F
```

(In Task A, `createRambleService` lives in this file as a typed stub that throws `new Error('implemented by Task F')`; Task F moves the real implementation into `service.ts` and re-exports it here — final shape: `types.ts` holds interfaces only plus `export { createRambleService } from './service'`.)

- [ ] **Step 6: `apps/server/src/rambles/test-audio.ts` (verbatim):**

```ts
/** 0.25 s of 16 kHz mono 16-bit silence as a valid WAV container (~8 KB). Used by provider test endpoints. */
export function makeTestWav(): Buffer {
  const sampleRate = 16000
  const samples = sampleRate / 4
  const dataSize = samples * 2
  const b = Buffer.alloc(44 + dataSize)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + dataSize, 4)
  b.write('WAVE', 8)
  b.write('fmt ', 12)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(sampleRate, 24)
  b.writeUInt32LE(sampleRate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(dataSize, 40)
  return b
}
```

- [ ] **Step 7: Typed stubs** for the 8 files listed above. Each exports exactly the frozen factory/function signatures used elsewhere and throws `new Error('implemented by Task <X>')` in the body (or returns a rejected promise), with a one-line `// implemented by Task <X>` header comment. Frozen stub signatures:

```ts
// stt-openai-compatible.ts (Task B)
export function createOpenAiCompatibleStt(cfg: ResolvedSttConfig, fetchImpl?: FetchLike): SttProvider
// stt-deepgram.ts (Task C)
export function createDeepgramStt(cfg: ResolvedSttConfig, fetchImpl?: FetchLike): SttProvider
// stt-elevenlabs.ts (Task D)
export function createElevenLabsStt(cfg: ResolvedSttConfig, fetchImpl?: FetchLike): SttProvider
// extractor-none.ts (Task E)
export function createNoneExtractor(): TaskExtractor
// extractor-openai-compatible.ts (Task E)
export function createOpenAiCompatibleExtractor(cfg: ResolvedLlmConfig, fetchImpl?: FetchLike): TaskExtractor
// confirm.ts (Task G)
export function buildTaskDrafts(items: ExtractedTask[], ctx: ParseContext): TaskDraft[]
// provider-config.ts (Task H)
export interface ProviderEnv { sttProvider?: string; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string; llmProvider?: string; llmBaseUrl?: string; llmModel?: string; llmApiKey?: string }
export function readProviderEnv(env?: NodeJS.ProcessEnv): ProviderEnv // reads OPENDOIST_STT_* / OPENDOIST_LLM_*
export function resolveSttConfig(db: Db, userId: string, env: ProviderEnv): Promise<ResolvedSttConfig | null>
export function resolveLlmConfig(db: Db, userId: string, env: ProviderEnv): Promise<ResolvedLlmConfig | null>
export function getIntegrationsView(db: Db, userId: string, env: ProviderEnv): Promise<z.infer<typeof IntegrationsGetSchema>>
export function saveIntegrations(db: Db, userId: string, patch: z.infer<typeof IntegrationsPutSchema>): Promise<void>
// lib/secret-crypto.ts (Task H)
export function getEncryptionKey(): Buffer // 32 bytes: Buffer.from(secrets.encryptionKey, 'base64url') — phase 3's ensureDataDirAndSecrets already wrote the field as randomBytes(32).toString('base64url') at first boot; NEVER hex-decode (hex silently truncates a base64url string) and NEVER (re)generate/rewrite it here
export function encryptSecret(plaintext: string, key?: Buffer): string  // 'v1:<iv b64>:<tag b64>:<ct b64>' AES-256-GCM, random 12-byte IV
export function decryptSecret(envelope: string, key?: Buffer): string   // throws on bad format/auth-tag
```

- [ ] **Step 8: `apps/web/src/api/rambles.ts` (complete code).** Self-contained client + hooks; if `AS_BUILT.md` names a shared web fetch util, use it for JSON calls but KEEP the exported names/signatures below verbatim. XHR (not fetch) for upload so progress events work.

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type RambleStatus = 'uploaded' | 'transcribed' | 'extracted' | 'confirmed' | 'failed'
export interface ExtractedTask {
  title: string
  notes: string | null
  due: string | null
  priority: 1 | 2 | 3 | 4 | null
  labels: string[]
}
export interface Ramble {
  id: string
  status: RambleStatus
  audioMime: string
  audioBytes: number
  durationSec: number | null
  transcript: string | null
  extractedTasks: ExtractedTask[] | null
  error: string | null
  failedStage: 'transcribe' | 'extract' | null
  createdAt: string
  updatedAt: string
}
export interface IntegrationSlot {
  provider: string | null
  baseUrl: string | null
  model: string | null
  hasApiKey: boolean
  source: 'user' | 'env' | 'none'
}
export interface Integrations { stt: IntegrationSlot; llm: IntegrationSlot }
export interface IntegrationSlotPatch {
  provider: string | null
  baseUrl: string | null
  model: string | null
  apiKey?: string | null
}

const BASE = '/api/v1'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as { detail?: string; title?: string } | null
    throw new Error(problem?.detail ?? problem?.title ?? `request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** Multipart upload with progress callback (0..100). Field name MUST be 'audio'. */
export function uploadRamble(
  blob: Blob,
  mimeType: string,
  onProgress: (pct: number) => void,
): Promise<Ramble> {
  const ext = mimeType.includes('mp4') ? 'm4a' : 'webm'
  const fd = new FormData()
  fd.append('audio', blob, `ramble.${ext}`)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/rambles`)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as Ramble)
      else {
        try {
          const p = JSON.parse(xhr.responseText) as { detail?: string }
          reject(new Error(p.detail ?? `upload failed (${xhr.status})`))
        } catch {
          reject(new Error(`upload failed (${xhr.status})`))
        }
      }
    }
    xhr.onerror = () => reject(new Error('upload failed (network)'))
    xhr.send(fd)
  })
}

export const rambleKeys = {
  all: ['rambles'] as const,
  one: (id: string) => ['rambles', id] as const,
  integrations: ['settings', 'integrations'] as const,
}

const PENDING: RambleStatus[] = ['uploaded', 'transcribed']

/** Polls every 1.5 s while the pipeline is running; stops on extracted/confirmed/failed. */
export function useRamble(id: string | null) {
  return useQuery({
    queryKey: rambleKeys.one(id ?? 'none'),
    enabled: id !== null,
    queryFn: () => json<Ramble>(`/rambles/${id}`),
    refetchInterval: (q) => (q.state.data && PENDING.includes(q.state.data.status) ? 1500 : false),
  })
}

export function useRambleList() {
  return useQuery({
    queryKey: rambleKeys.all,
    queryFn: async () => (await json<{ results: Ramble[] }>('/rambles')).results,
  })
}

export function useRetryStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: 'transcribe' | 'extract' }) =>
      json<Ramble>(`/rambles/${id}/${stage}`, { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData(rambleKeys.one(r.id), r),
  })
}

export function useConfirmRamble() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, tasks }: { id: string; tasks: ExtractedTask[] }) =>
      json<{ createdTaskIds: string[] }>(`/rambles/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ tasks }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rambleKeys.all })
      void qc.invalidateQueries({ queryKey: ['tasks'] }) // AS-BUILT CHECK: match the repo's task query-key root
    },
  })
}

export function useDiscardRamble() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => json<void>(`/rambles/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rambleKeys.all }),
  })
}

export function useIntegrations() {
  return useQuery({ queryKey: rambleKeys.integrations, queryFn: () => json<Integrations>('/settings/integrations') })
}

export function useSaveIntegrations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { stt?: IntegrationSlotPatch; llm?: IntegrationSlotPatch }) =>
      json<void>('/settings/integrations', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rambleKeys.integrations }),
  })
}

export function testIntegration(
  kind: 'stt' | 'llm',
  candidate?: IntegrationSlotPatch,
): Promise<{ ok: boolean; detail: string | null }> {
  return json(`/settings/integrations/${kind}/test`, {
    method: 'POST',
    body: JSON.stringify(candidate ? { candidate } : {}),
  })
}
```

- [ ] **Step 9: `apps/web/src/ramble/store.ts` (verbatim):**

```ts
import { create } from 'zustand'

interface RambleUiState {
  /** ramble currently recording/uploading/being reviewed; null = closed */
  activeRambleId: string | null
  reviewOpen: boolean
  openReview: (id: string) => void
  setActive: (id: string | null) => void
  closeReview: () => void
}

export const useRambleStore = create<RambleUiState>((set) => ({
  activeRambleId: null,
  reviewOpen: false,
  openReview: (id) => set({ activeRambleId: id, reviewOpen: true }),
  setActive: (id) => set({ activeRambleId: id }),
  closeReview: () => set({ reviewOpen: false, activeRambleId: null }),
}))
```

- [ ] **Step 10: `schemas.test.ts`:** ExtractedTaskSchema rejects priority 0/5 and empty title, applies `labels` default; ConfirmRambleSchema rejects empty task list; IntegrationsPutSchema: apiKey absent→undefined, null and string both accepted; EXTRACTED_TASKS_JSON_SCHEMA has `additionalProperties: false` at both levels and `required` listing all five item fields (guards against drift from the dossier).
- [ ] **Step 11: Gate.** `pnpm --filter @opendoist/server typecheck && pnpm --filter @opendoist/server exec vitest run src/rambles/schemas.test.ts` clean; `pnpm --filter @opendoist/web typecheck` clean; `pnpm lint` clean. Migration file exists and applies. (AS-BUILT CHECK: exact filter names per `AS_BUILT.md`.)

---

### Task B: STT adapter — openai-compatible

**Files:**
- Replace stub: `apps/server/src/rambles/providers/stt-openai-compatible.ts`
- Test: `apps/server/src/rambles/providers/stt-openai-compatible.test.ts`

**Interfaces:** Consumes `providers/types.ts`. Produces `createOpenAiCompatibleStt(cfg, fetchImpl?)` (frozen). One implementation covers OpenAI (`gpt-4o-mini-transcribe`), Speaches, whisper.cpp server, Groq, LocalAI — differing only by `baseUrl`/`model`.

**Request contract (each row is a test using an injected mock `fetchImpl` that captures the Request/args and returns a canned Response):**
- URL: `${baseUrl without trailing slash}/audio/transcriptions`; defaults: baseUrl `https://api.openai.com/v1`, model `gpt-4o-mini-transcribe`.
- Method POST; body is `FormData` with entries: `file` = `File` built via `new File([cfg-audio Buffer], filename, { type: mimeType })`, `model` = cfg model, `response_format` = `'json'`; plus `language` and `prompt` entries only when provided in opts. Do NOT set a content-type header (fetch sets the multipart boundary).
- Header `Authorization: Bearer <apiKey>` only when `cfg.apiKey` is non-null (Speaches/whisper.cpp need none).
- 2xx → parse `{ text: string }` → `SttResult { text }` (trimmed). Non-2xx → throw `ProviderError` with `openai-compatible STT ${status}: <first 300 chars of body>` and `status`. Missing/non-string `text` → `ProviderError('openai-compatible STT: response missing text')`.

- [ ] **Step 1:** Write tests first: default URL + model; custom baseUrl with trailing slash stripped (`http://speaches:8000/v1/` → `…/v1/audio/transcriptions`); FormData entries exact (assert `body.get('model')`, `body.get('file')` is a `File` with `.name === 'ramble.webm'` and `.type === 'audio/webm'`); no auth header when apiKey null, header present when set; language/prompt passthrough; 401 → ProviderError with status 401; missing `text` → ProviderError; happy path returns trimmed text.
- [ ] **Step 2:** Implement (~50 lines). **Step 3:** Verify: `pnpm --filter @opendoist/server exec vitest run src/rambles/providers/stt-openai-compatible.test.ts` → all pass; typecheck + lint clean.

---

### Task C: STT adapter — Deepgram

**Files:**
- Replace stub: `apps/server/src/rambles/providers/stt-deepgram.ts`
- Test: `apps/server/src/rambles/providers/stt-deepgram.test.ts`

**Interfaces:** Consumes `providers/types.ts`. Produces `createDeepgramStt(cfg, fetchImpl?)` (frozen).

**Request contract (dossier §5.7; each row a mock-fetch test):**
- URL: `${baseUrl ?? 'https://api.deepgram.com'}/v1/listen?model=<model ?? 'nova-3'>&smart_format=true` (+`&language=<opts.language>` when provided; values URL-encoded).
- Method POST; headers `Authorization: Token <apiKey>` (apiKey null → throw `ProviderError('deepgram: API key required')` before any network call) and `Content-Type: <audio.mimeType>`; body = raw audio bytes (the Buffer, not FormData).
- 2xx → transcript at `.results.channels[0].alternatives[0].transcript`; duration at `.metadata.duration` (optional) → `SttResult { text, durationSec }`. Missing path → `ProviderError('deepgram: response missing transcript')`. Non-2xx → `ProviderError` with status + body snippet.

- [ ] **Step 1:** Tests: URL/query exact (model default and custom, language encoding `pt-BR`); Token auth header; raw-bytes body (assert `init.body` is the same bytes, content-type matches mime); response-path parse from the canned nova-3 JSON shape `{metadata:{duration:2.5},results:{channels:[{alternatives:[{transcript:'buy milk tomorrow'}]}]}}`; missing-key error; no-key error thrown without calling fetchImpl (assert zero calls); 402 → ProviderError status 402.
- [ ] **Step 2:** Implement (~40 lines). **Step 3:** Verify: `pnpm --filter @opendoist/server exec vitest run src/rambles/providers/stt-deepgram.test.ts` → all pass; typecheck + lint clean.

---

### Task D: STT adapter — ElevenLabs

**Files:**
- Replace stub: `apps/server/src/rambles/providers/stt-elevenlabs.ts`
- Test: `apps/server/src/rambles/providers/stt-elevenlabs.test.ts`

**Interfaces:** Consumes `providers/types.ts`. Produces `createElevenLabsStt(cfg, fetchImpl?)` (frozen).

**Request contract (dossier §5.7; each row a mock-fetch test):**
- URL: `${baseUrl ?? 'https://api.elevenlabs.io'}/v1/speech-to-text`.
- Method POST; header `xi-api-key: <apiKey>` (null key → `ProviderError('elevenlabs: API key required')`, no network call); body `FormData`: `file` = `File(audio.data, filename, {type: mimeType})`, `model_id` = model ?? `'scribe_v1'`; `language_code` entry only when opts.language provided.
- 2xx → `{ text, language_code? }` → `SttResult { text, language: language_code }`. Missing `text` → ProviderError. Non-2xx → ProviderError with status + body snippet.

- [ ] **Step 1:** Tests mirroring Task C's structure (URL, header name exactly `xi-api-key`, FormData entries `file`/`model_id` default + custom model, language_code passthrough, missing text, 401, no-key short-circuit).
- [ ] **Step 2:** Implement (~35 lines). **Step 3:** Verify: `pnpm --filter @opendoist/server exec vitest run src/rambles/providers/stt-elevenlabs.test.ts` → all pass; typecheck + lint clean.

---

### Task E: Task extractors — `none` passthrough + openai-compatible LLM

**Files:**
- Replace stubs: `apps/server/src/rambles/providers/extractor-none.ts`, `apps/server/src/rambles/providers/extractor-openai-compatible.ts`
- Test: `apps/server/src/rambles/providers/extractor-none.test.ts`, `apps/server/src/rambles/providers/extractor-openai-compatible.test.ts`

**Interfaces:** Consumes `providers/types.ts`, `schemas.ts` (`ExtractedTasksSchema`, `EXTRACTED_TASKS_JSON_SCHEMA`). Produces `createNoneExtractor()` and `createOpenAiCompatibleExtractor(cfg, fetchImpl?)` (frozen).

**`none` behavior (spec: single task, transcript to description):** title = transcript truncated to ≤80 chars at a word boundary with `…` appended when truncated (whole transcript if ≤80); empty/whitespace transcript → title `'Voice note'`; result `{ tasks: [{ title, notes: full transcript, due: null, priority: null, labels: [] }] }`. Never throws.

**LLM behavior:**
- URL `${baseUrl without trailing slash ?? 'https://api.openai.com/v1'}/chat/completions`; `Authorization: Bearer` only when apiKey set (Ollama needs none); model default `gpt-4o-mini`.
- Body: `{ model, temperature: 0, messages: [{role:'system', content: SYSTEM_PROMPT(ctx)}, {role:'user', content: transcript}], response_format: { type: 'json_schema', json_schema: { name: 'extracted_tasks', strict: true, schema: EXTRACTED_TASKS_JSON_SCHEMA } } }`.
- `SYSTEM_PROMPT` (exact, exported as `buildExtractionSystemPrompt(ctx: ExtractorContext): string`):

```
You split a voice-note transcript into discrete actionable tasks.
Rules:
- Imperative, concise titles.
- Never invent tasks that are not in the transcript.
- notes: extra context for that task from the transcript, else null.
- due: the date/time phrase EXACTLY as spoken (e.g. "tomorrow 5pm", "every friday"); null if none. Never convert to ISO dates or resolve relative dates yourself.
- priority: 1 (most urgent) to 4, only when the speaker signals urgency; else null.
- labels: choose only from the known labels list; else empty array.
- Respond with ONLY a JSON object matching the schema: {"tasks":[{"title","notes","due","priority","labels"}]}.
Known labels: <comma-joined ctx.knownLabels or 'none'>
Current datetime: <ctx.now> (<ctx.timezone>)
```

- Response handling: take `choices[0].message.content`; strip a single fenced ```` ```json … ``` ```` / ```` ``` … ``` ```` wrapper if present; `JSON.parse` → `ExtractedTasksSchema.parse`. **On any parse/validation failure, retry exactly once**: re-send with two extra messages appended — `{role:'assistant', content: <raw content>}` and `{role:'user', content: 'Your previous response failed validation: <first 500 chars of error>. Respond again with ONLY valid JSON matching the schema.'}`. Second failure → `ProviderError('llm extraction: invalid response after retry: …')`. Non-2xx HTTP → ProviderError immediately (no retry). Empty `tasks` array is VALID (nothing actionable said).

- [ ] **Step 1:** `extractor-none.test.ts`: long transcript truncates at word boundary with `…`; short transcript verbatim title; whitespace-only → `'Voice note'`; notes always full transcript.
- [ ] **Step 2:** `extractor-openai-compatible.test.ts` (mock fetchImpl): request body exact (temperature 0, strict json_schema block present, system prompt contains labels + now + timezone); happy path parses; content wrapped in ```` ```json ```` fences parses; invalid-first-then-valid → succeeds with exactly 2 fetch calls and 4 messages in the second body (assert corrective user message present); invalid-twice → ProviderError, exactly 2 calls; HTTP 500 → ProviderError, exactly 1 call; priority 7 in payload fails zod → triggers retry.
- [ ] **Step 3:** Implement both. **Step 4:** Verify: `pnpm --filter @opendoist/server exec vitest run src/rambles/providers/extractor-none.test.ts src/rambles/providers/extractor-openai-compatible.test.ts` → all pass; typecheck + lint clean.

---

### Task F: Ramble pipeline service + HTTP routes + integration test

**Files:**
- Create: `apps/server/src/rambles/service.ts`, `apps/server/src/rambles/routes.ts`
- Edit: `apps/server/src/rambles/types.ts` — ONLY to replace the `createRambleService` stub body with `export { createRambleService } from './service'` (interfaces untouched)
- Test: `apps/server/src/rambles/routes.integration.test.ts`

**Interfaces:** Consumes `types.ts` (RambleService contract), `schemas.ts`, `providers/types.ts`, `confirm.ts` (`buildTaskDrafts`, Task G), `provider-config.ts` (Task H), core `ParseContext`. Produces the implemented `RambleService` + `rambleRoutes` (a Hono sub-app or `registerRambleRoutes(app, service)` — match the as-built route-module pattern; Task N mounts it).

**AS-BUILT CHECK (before coding):** read `AS_BUILT.md` for (a) the task-creation service behind `/tasks/quick` — write the `CreateTaskPort` adapter around it so SSE/activity/auto-reminder behavior is identical to Quick Add; (b) the ParseContext-from-user-settings helper; (c) problem-JSON + auth-middleware idioms; (d) `UPLOAD_MAX_MB` config access; (e) integration-test harness from phase 3 (temp SQLite + app factory + authed request helper) — reuse it.

**Service semantics (each a test):**
- `create`: reject before persisting when `resolveStt` → null (throw a typed error the route maps to **409** problem `"No speech-to-text provider is configured"`). Write audio to `<dataDir>/rambles/<id>.<ext>` (`ext` from mime: webm→`webm`, mp4/m4a→`m4a`, mpeg→`mp3`, wav→`wav`, unknown→`bin`; create dir recursively; 0600). Insert row status `uploaded`. When `autoRun !== false`, fire `runTranscribe(...).then(r => r.status === 'transcribed' ? runExtract(...) : undefined)` detached with `.catch(() => {})` (stage errors are already persisted on the row — never unhandled-reject).
- `runTranscribe`: guard status ∈ {uploaded, failed@transcribe} else conflict error (route → 409). Read audio file; call provider `transcribe`; success → `{status:'transcribed', transcript, durationSec?, error:null, failedStage:null}`; failure → `{status:'failed', failedStage:'transcribe', error: message}` and return the row (do NOT rethrow).
- `runExtract`: guard status ∈ {transcribed, extracted, failed@extract}; requires transcript. Calls `resolveExtractor` then `extract(transcript, { now, timezone, knownLabels: await listLabelNames(userId) })` — AS-BUILT CHECK: user timezone from the same settings helper as (b). Success → `{status:'extracted', extractedJson: JSON.stringify(tasks), error:null, failedStage:null}`; failure → failed@extract. `none` extractor also lands on `extracted` (uniform client flow).
- `confirm`: guard status `extracted`; validate items (route already zod-validated); `buildTaskDrafts(items, ctx)`; create sequentially via `createTask` port collecting ids; then update row `{status:'confirmed', extractedJson: JSON.stringify(items), audioPath: null}` and `fs.unlink` the audio file (ENOENT tolerated). Returns `{ createdTaskIds }`. If any creation throws midway: persist nothing further, leave status `extracted`, rethrow (client may re-confirm; duplicate-task risk documented in route description).
- `discard`: any status; delete audio file if present + hard-delete row.
- All getters scope by `userId`; foreign ids → null/404. Row→DTO mapping parses `extractedJson` and never exposes `audioPath`.

**Routes (all behind as-built auth middleware, zod-typed, mounted under `/api/v1`):**

| Method+Path | Request | Response | Errors |
|---|---|---|---|
| `POST /rambles` | multipart, field `audio` (File) | 201 `RambleSchema` | 400 no/invalid file; 409 STT unconfigured; **413** when file bytes > `UPLOAD_MAX_MB`·2²⁰ |
| `GET /rambles` | — | 200 `RambleListSchema` (newest first, limit 50, `next_cursor: null`) | |
| `GET /rambles/:id` | — | 200 `RambleSchema` | 404 |
| `POST /rambles/:id/transcribe` | — | 200 `RambleSchema` (possibly status `failed`) | 404, 409 wrong status |
| `POST /rambles/:id/extract` | — | 200 `RambleSchema` | 404, 409 wrong status/no transcript |
| `POST /rambles/:id/confirm` | `ConfirmRambleSchema` | 200 `ConfirmRambleResponseSchema` | 404, 409 wrong status |
| `DELETE /rambles/:id` | — | 204 | 404 |

Multipart parsing: `const body = await c.req.parseBody()`; `body.audio` must be a `File`; bytes via `Buffer.from(await file.arrayBuffer())`; mime from `file.type` (fallback `application/octet-stream`); enforce the size cap from Content-Length AND actual byte length. Routes construct the service once with real deps: `resolveStt/resolveExtractor` from `provider-config.ts` + `registry.ts`, `createTask` = the port adapter from AS-BUILT (a), `dataDir` from as-built config.

- [ ] **Step 1: `routes.integration.test.ts`** — boot the as-built test app with the ramble routes mounted and a service built with `autoRun: false` plus **fake in-test providers** (`resolveStt` returns a stub whose `transcribe` resolves `'buy milk tomorrow and email sam on friday'` or throws when the test flips a flag; `resolveExtractor` returns a stub emitting 2 fixed ExtractedTasks, one with `due: 'tomorrow'`, one with `due: null, priority: 1`), temp `dataDir`. Flow tests: (1) upload tiny buffer → 201 status `uploaded`, audio file exists on disk; (2) POST transcribe → `transcribed` + transcript; (3) POST extract → `extracted` + 2 extractedTasks; (4) POST confirm with items (one title edited) → 200 with 2 ids, tasks exist in DB with correct content/priority/due date (tomorrow relative to test ctx), row `confirmed`, audio file GONE from disk; (5) failure path: STT stub throws → transcribe returns status `failed` + failedStage `transcribe` + error text, then flag off → retry transcribe → `transcribed`; (6) guards: extract while `uploaded` → 409; confirm while `transcribed` → 409; (7) upload with STT unconfigured (resolveStt → null) → 409; (8) oversized upload (set max 1 MB for test, send 1.5 MB) → 413; (9) GET foreign/unknown id → 404; (10) DELETE → 204, file gone, subsequent GET 404.
- [ ] **Step 2:** Implement `service.ts` then `routes.ts` until green.
- [ ] **Step 3:** Verify: `pnpm --filter @opendoist/server exec vitest run src/rambles/routes.integration.test.ts` → all pass; typecheck + lint clean. Note: this test goes green only after Tasks G+H land (stubs throw); if running before integration, mark ONLY the confirm-flow cases `describe.skip` with comment `// un-skipped at Task N` — everything not touching `buildTaskDrafts`/`provider-config` must pass standalone (fakes are injected, so only confirm depends on G).

---

### Task G: Confirm mapping — extracted items → task drafts (pure)

**Files:**
- Replace stub: `apps/server/src/rambles/confirm.ts`
- Test: `apps/server/src/rambles/confirm.test.ts`

**Interfaces:** Consumes `schemas.ts` (ExtractedTask), `types.ts` (TaskDraft), and from `@opendoist/core`: `parseQuickAdd`, `resolveNaturalDate`, `ParseContext`, `Due`, `Priority`. Produces `buildTaskDrafts(items, ctx)` (frozen). This is the "server parses the spoken due phrase" layer — the LLM never invents dates.

**Mapping rules (each a test; ctx = `{now:'2026-07-15T21:00:00Z', timezone:'America/New_York', weekStart:1, nextWeekDay:1, weekendDay:6, smartDate:true}`):**
- `content` = trimmed title, used literally — titles are NOT re-scanned for quick-add sigils (`#x` in a spoken title stays text).
- Due resolution for non-null `due` phrase, in order: (1) `parseQuickAdd(phrase, ctx).due` when non-null — captures times AND recurrences (`'every friday'` → Due with `recurrence` set, `'tomorrow 5pm'` → `{date:'2026-07-16', time:'17:00'}`); (2) else `resolveNaturalDate(phrase, ctx)` → date-only `Due { date, time, string: phrase, recurrence: null }`; (3) else **unparseable**: `due: null` and append to description: `Due (unparsed): <phrase>` on its own paragraph (joined to notes with `\n\n`).
- `description` = notes (null → omitted) ⊕ unparsed-due paragraph; both absent → null.
- `priority` = item.priority ?? 4 (already 1=highest — no inversion anywhere).
- `labels` = trimmed, empty strings dropped, case-insensitive dedupe keeping first spelling.
- Items pass through in order; function is total (never throws on schema-valid input).

- [ ] **Step 1:** Tests: `'tomorrow 5pm'` → date/time exact; `'every friday'` → recurrence non-null + next-occurrence date `2026-07-17`; `'in 3 weeks'` → `2026-08-05` date-only; `'when I feel like it'` → due null + `Due (unparsed): when I feel like it` in description; notes+unparsed join with blank line; priority null → 4; labels `['Home','home',' errands ']` → `['Home','errands']`; title `'call #dentist'` keeps literal content and no due/labels leak from title.
- [ ] **Step 2:** Implement (~60 lines). **Step 3:** Verify: `pnpm --filter @opendoist/server exec vitest run src/rambles/confirm.test.ts` → all pass; typecheck + lint clean.

---

### Task H: Secret crypto + provider-config resolution

**Files:**
- Replace stubs: `apps/server/src/lib/secret-crypto.ts`, `apps/server/src/rambles/provider-config.ts`
- Test: `apps/server/src/lib/secret-crypto.test.ts`, `apps/server/src/rambles/provider-config.test.ts`

**Interfaces:** Consumes the as-built secrets-file module (AS-BUILT CHECK item 6 — the `encryptionKey` field ALREADY EXISTS: phase 3's `ensureDataDirAndSecrets` generates it at first boot as `randomBytes(32).toString('base64url')` and preserves it on every subsequent boot; do NOT generate, rewrite, or re-encode it, and do NOT create a second secrets file) and the schema tables from Task A. Produces the frozen signatures from Task A Step 7.

**`secret-crypto.ts` semantics:** `getEncryptionKey()` = `Buffer.from(secrets.encryptionKey, 'base64url')` over the existing phase-3 field, asserting the result is exactly 32 bytes (throw otherwise) — NEVER `Buffer.from(value, 'hex')`: hex-decoding a base64url string silently truncates at the first non-hex character and yields a short/wrong AES key. AES-256-GCM via `node:crypto`; envelope `v1:<iv b64>:<tag b64>:<ciphertext b64>`; fresh random 12-byte IV per encryption; `key` parameter defaults to `getEncryptionKey()` (tests pass an explicit 32-byte key to avoid touching /data). `decryptSecret` throws on: wrong prefix, malformed base64, auth-tag failure (tampered ciphertext), wrong key.

**`provider-config.ts` semantics (slot-level override — a user row with non-null provider replaces the WHOLE env slot, no field merging):**
- `readProviderEnv`: reads `OPENDOIST_STT_PROVIDER/STT_BASE_URL/STT_MODEL/STT_API_KEY` and `OPENDOIST_LLM_PROVIDER/LLM_BASE_URL/LLM_MODEL/LLM_API_KEY` (AS-BUILT CHECK item 7: go through the as-built config module if it centralizes env; keep this function's signature regardless).
- `resolveSttConfig`: user row `sttProvider` non-null → `{provider, baseUrl, model, apiKey: sttApiKeyEnc ? decryptSecret(sttApiKeyEnc) : null}`; else env `sttProvider` valid (`SttProviderIdSchema`) → env slot; else null. Invalid provider string in env → log warning once, treat as unset. Same for `resolveLlmConfig` with `LlmProviderIdSchema`, plus: env/user value `'none'` → null (explicit passthrough).
- `getIntegrationsView`: per slot report effective `{provider, baseUrl, model, hasApiKey, source: 'user'|'env'|'none'}` — never any key material, encrypted or not.
- `saveIntegrations`: upsert the user's `provider_settings` row per provided slot; apiKey string → `encryptSecret`; null → clear column; undefined → keep; `provider: null` → clear all four columns of that slot (reverts to env). Sets `updatedAt`.

- [ ] **Step 1:** Crypto tests: roundtrip; envelope format regex `^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$`; two encryptions of same plaintext differ (IV uniqueness); flipping one ciphertext byte throws; wrong key throws; bad prefix throws; `getEncryptionKey` against a fixture secrets file whose `encryptionKey` is a known base64url string decodes to the expected 32 bytes (and a 16-byte value throws).
- [ ] **Step 2:** Config tests on the as-built temp-SQLite harness: env-only resolution; user wholesale override (user sets deepgram while env says openai-compatible → deepgram with NO env leakage of baseUrl/model); no user row + no env → null; key decrypts to original; save-then-resolve roundtrip incl. apiKey undefined=keep / null=clear; `provider: null` reverts slot to env; view masks keys + correct `source`; llm `'none'` → resolve null → registry yields the `none` extractor.
- [ ] **Step 3:** Verify: `pnpm --filter @opendoist/server exec vitest run src/lib/secret-crypto.test.ts src/rambles/provider-config.test.ts` → all pass; typecheck + lint clean.

---

### Task I: Integrations settings API + provider test endpoints

**Files:**
- Create: `apps/server/src/rambles/integrations-routes.ts`
- Test: `apps/server/src/rambles/integrations-routes.test.ts`

**Interfaces:** Consumes `schemas.ts` (Integrations* schemas), `provider-config.ts` (Task H, frozen), `registry.ts`, `test-audio.ts` (`makeTestWav`). Produces `integrationsRoutes` (same module pattern as Task F; Task N mounts under `/api/v1/settings/integrations`).

**Routes (authed, zod-typed):**
- `GET /settings/integrations` → 200 `IntegrationsGetSchema` via `getIntegrationsView`.
- `PUT /settings/integrations` body `IntegrationsPutSchema` → `saveIntegrations` → 204.
- `POST /settings/integrations/stt/test` body `ProviderTestRequestSchema` → build config: candidate (with provider validated against `SttProviderIdSchema`, apiKey absent → stored/env key via `resolveSttConfig`) else resolved config; unconfigured → 200 `{ok:false, detail:'No STT provider configured'}`. Call `createSttProvider(cfg).transcribe({data: makeTestWav(), mimeType:'audio/wav', filename:'test.wav'})` with a 15 s `AbortSignal.timeout` guard → `{ok:true, detail: text || '(empty transcript — connection OK)'}`; ProviderError/abort → `{ok:false, detail: message}` (always HTTP 200 — the failure is data, not a transport error).
- `POST /settings/integrations/llm/test` → same pattern; unconfigured/`none` → `{ok:true, detail:'Extraction disabled — rambles become a single task'}`; else `createExtractor(cfg).extract('Buy milk tomorrow and email Sam on Friday', {now, timezone:'UTC', knownLabels:[]})` → `{ok:true, detail:'Extracted N task(s)'}`.
- **AS-BUILT CHECK:** update the `GET /api/v1/info` feature flags (item 8) so `features.stt` / `features.llm` = env-level configured (`readProviderEnv` provider fields valid) — edit that handler only if the flags exist and are stale; record what you did.

- [ ] **Step 1:** Tests (as-built harness + mock fetch injected into route module via the same `fetchImpl` seam the registry exposes — add an optional `deps` param to the route factory for tests): GET default shape (all none); PUT stores encrypted key (assert DB column ≠ plaintext and decrypts correctly) then GET shows `hasApiKey: true`, `source: 'user'`, no key anywhere in response body (assert stringified body lacks the plaintext AND the envelope); stt/test with candidate → mock fetch receives the request, returns `{text:''}` → `{ok:true}`; stt/test provider error → `{ok:false, detail}` with HTTP 200; llm/test unconfigured → `{ok:true}` disabled message; PUT invalid provider id → 400 problem-JSON.
- [ ] **Step 2:** Implement. **Step 3:** Verify: `pnpm --filter @opendoist/server exec vitest run src/rambles/integrations-routes.test.ts` → all pass; typecheck + lint clean.

---

### Task J: Web — recorder hook + hold-to-record mic button in Quick Add

**Files:**
- Create: `apps/web/src/ramble/useRecorder.ts`, `apps/web/src/ramble/RambleButton.tsx`
- Edit: the as-built Quick Add component (AS-BUILT CHECK item 10 — likely `apps/web/src/quick-add/QuickAdd.tsx` or similar): ONLY add the `<RambleButton />` mount in the action-button row; no other Quick Add changes

**Interfaces:** Consumes `api/rambles.ts` (`uploadRamble`, `useIntegrations`), `ramble/store.ts` (`useRambleStore.openReview`). Produces the two components; no exports consumed by other tasks.

**`useRecorder` contract (dossier §5.7 capture snippet is the reference implementation):**
- `useRecorder(opts?: { maxDurationMs?: number }): { state: 'idle'|'requesting'|'recording'|'error', level: number, elapsedMs: number, error: string|null, start(): Promise<void>, stop(): Promise<{ blob: Blob; mimeType: string } | null>, cancel(): void }`.
- Mime pick order exactly: `audio/webm;codecs=opus` → `audio/mp4` → `audio/webm` via `MediaRecorder.isTypeSupported`; construct with `{ mimeType, audioBitsPerSecond: 48_000 }`; **`rec.start(1000)`** (1 s timeslice so data survives crashes); chunks accumulated from `ondataavailable` when `e.data.size > 0`.
- Level indicator: `AudioContext` + `AnalyserNode` (fftSize 256), RMS of `getByteTimeDomainData` normalized 0..1, updated via rAF ~15 fps; torn down (tracks stopped, context closed) on stop/cancel/unmount — no leaked mic indicator.
- **Max-duration guard:** default 10 min (`maxDurationMs = 600_000`); timer auto-stops recording (same path as manual stop). `getUserMedia` denial → state `error` with a friendly message.

**`RambleButton` behavior:**
- Lucide `Mic` icon button (5px radius, `text-secondary` → `text-primary` hover) in the Quick Add action row. Disabled with tooltip "Configure a speech-to-text provider in Settings → Integrations" when `useIntegrations()` reports `stt.source === 'none'` (while loading: enabled optimistically).
- **Hold-to-record:** `pointerdown` starts (with `setPointerCapture`), `pointerup`/`pointercancel` stops-and-uploads. A quick tap (<300 ms between down/up) toggles instead: first tap starts, next tap stops (keyboard/a11y path: Enter/Space toggle; `aria-pressed`; `Escape` cancels without uploading).
- While recording: button pulses with a ring scaled by `level` (accent color, 250 ms transitions honoring `prefers-reduced-motion`), `mm:ss` elapsed alongside, live region announces "Recording".
- On stop: `uploadRamble(blob, mimeType, setPct)` → linear progress bar in place of the timer; on 201 → `useRambleStore.getState().openReview(ramble.id)`; on error (409 unconfigured / 413 too large / network) → as-built toast with the problem detail, state back to idle. `cancel()` discards audio without uploading.

- [ ] **Step 1:** Implement `useRecorder` (guard `typeof MediaRecorder === 'undefined'` → error state for SSR/old browsers). **Step 2:** Implement `RambleButton` + mount in Quick Add. **Step 3:** Verify: `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build` → clean; `pnpm lint` clean. Manual check note for the gate: record → button pulses → release → progress → review dialog opens.

---

### Task K: Web — review-confirm screen

**Files:**
- Create: `apps/web/src/ramble/RambleReview.tsx`, `apps/web/src/ramble/RambleReviewRow.tsx`
- Edit: the as-built app-root layout (AS-BUILT CHECK item 10) — ONLY add `<RambleReview />` next to existing global dialogs/toasts

**Interfaces:** Consumes `api/rambles.ts` (`useRamble`, `useRetryStage`, `useConfirmRamble`, `useDiscardRamble`, `ExtractedTask`), `ramble/store.ts`, `@opendoist/core` (`resolveNaturalDate`, `parseQuickAdd`, `DEFAULT_PARSE_CONTEXT_SETTINGS`) for live due-phrase preview. Produces the dialog; nothing else consumes it.

**`RambleReview` (dialog, 10px radius, opens when `reviewOpen`):**
- Drives off `useRamble(activeRambleId)` polling. Render per status: `uploaded` → spinner "Transcribing…"; `transcribed` → spinner "Extracting tasks…"; `failed` → error text + a **Retry** button posting the `failedStage` (via `useRetryStage`) + Discard; `extracted` → review list; `confirmed` → brief success then auto-close.
- Review list: collapsible transcript block (13px `text-secondary`, `<details>`), then editable rows seeded from `extractedTasks` into local state.
- **Row editors (AS-BUILT CHECK: reuse the app's existing chip editors — scheduler popover, priority picker, label picker — if `AS_BUILT.md` locates them; otherwise use the fallback controls below, same data out):** title text input (required); notes textarea (auto-grow, 13px); **due chip** = text input holding the spoken phrase with live preview: `parseQuickAdd(phrase, ctx).due ?? resolveNaturalDate(phrase, ctx)` → show resolved date/time in date-semantic colors, or "won't parse — will be added to description" hint when null (ctx from browser: `now = new Date().toISOString()`, `timezone = Intl.DateTimeFormat().resolvedOptions().timeZone`, spread `DEFAULT_PARSE_CONTEXT_SETTINGS`); **priority picker** p1–p4 (flag colors `#d1453b/#eb8909/#246fe0/#999999`); **labels** chip input (add/remove plain strings). Per-row remove (X) + trailing "Add task" row.
- Footer: task count · **Discard** (secondary → `useDiscardRamble`, closes) · **Add N tasks** (primary, disabled while pending or when 0 rows/any empty title → `useConfirmRamble` with the EDITED rows; on success toast "N tasks added", close). Esc = plain close (keeps the ramble in `extracted` for later — list remains reachable; note this in the dialog's aria description).

- [ ] **Step 1:** Implement row component with controlled editors. **Step 2:** Implement dialog states + wiring. **Step 3:** Verify: `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build` → clean; `pnpm lint` clean.

---

### Task L: Web — Settings → Integrations (Voice & AI section)

**Files:**
- Create: `apps/web/src/settings/IntegrationsVoiceSettings.tsx`
- Edit: the as-built settings page/registry (AS-BUILT CHECK item 10) — ONLY register the new section on the existing Integrations page (create the page entry per the phase-5 pattern if Integrations doesn't exist yet; record what you did)

**Interfaces:** Consumes `api/rambles.ts` (`useIntegrations`, `useSaveIntegrations`, `testIntegration`, `IntegrationSlotPatch`). Produces the settings section.

**UI (two cards — "Speech-to-text" and "Task extraction (LLM)" — same skeleton):**
- Provider `<select>`: STT = Instance default (`null`) / OpenAI-compatible / Deepgram / ElevenLabs; LLM = Instance default / None (single task) / OpenAI-compatible. "Instance default" row shows the env-derived value from `source === 'env'` as helper text ("Using instance default: deepgram / nova-3"), or "Not configured" when `source === 'none'`.
- Fields when a provider is chosen: Base URL (placeholder `https://api.openai.com/v1`; hidden for deepgram/elevenlabs unless "Advanced" disclosure opened), Model (placeholder per provider: `gpt-4o-mini-transcribe` / `nova-3` / `scribe_v1` / `gpt-4o-mini`), API key (`type="password"`; when `hasApiKey`, placeholder `••••••••  (saved)` and an explicit "Clear key" ghost button → sends `apiKey: null`; empty input → omit `apiKey` = keep).
- Buttons per card: **Test** (calls `testIntegration(kind, dirty ? candidatePatch : undefined)`; result inline — green check + detail, or red `#d1453b` + detail; spinner while pending) and **Save** (PUT only the dirty slot; toast on success). Form state = local copy diffed against `useIntegrations()` data.
- Footer note: "Keys are stored encrypted on this server and never sent to the browser." Link "Self-hosting a local transcriber →" to the Task M docs page path.

- [ ] **Step 1:** Implement + register. **Step 2:** Verify: `pnpm --filter @opendoist/web typecheck && pnpm --filter @opendoist/web build` → clean; `pnpm lint` clean.

---

### Task M: Docs — voice pipeline + local sidecars

**Files:**
- Create: `docs/voice-ramble.md`
- Edit: docs index/README docs-links section ONLY if `AS_BUILT.md` shows a docs index exists (add one link line); otherwise no other file

**Content (all of it; keep runnable snippets exact):**
1. **How Ramble works** — 5-line pipeline diagram (record → upload → STT → optional LLM extraction → review-confirm), what's stored where (`/data/rambles/` audio deleted on confirm/discard, transcript+items kept on the row), statuses + per-stage retry.
2. **Configuration** — env table: `OPENDOIST_STT_PROVIDER` (`openai-compatible|deepgram|elevenlabs`), `OPENDOIST_STT_BASE_URL`, `OPENDOIST_STT_MODEL`, `OPENDOIST_STT_API_KEY`, `OPENDOIST_LLM_PROVIDER` (`openai-compatible|none`), `OPENDOIST_LLM_BASE_URL`, `OPENDOIST_LLM_MODEL`, `OPENDOIST_LLM_API_KEY`; note that Settings → Integrations overrides the whole slot per user and keys are AES-GCM-encrypted into the DB with a key from `/data/secrets.json`.
3. **Provider matrix** (dossier §5.7 table condensed): OpenAI `gpt-4o-mini-transcribe`, Deepgram `nova-3`, ElevenLabs `scribe_v1`, Speaches, whisper.cpp — model defaults + price ballparks + "no key needed" for local.
4. **Speaches sidecar** — compose example (service `speaches` from `ghcr.io/speaches-ai/speaches:latest-cpu`, port 8000, `hf-hub-cache` volume, joined to the opendoist compose network) + the three env lines pointing OpenDoist at it (`OPENDOIST_STT_PROVIDER=openai-compatible`, `OPENDOIST_STT_BASE_URL=http://speaches:8000/v1`, `OPENDOIST_STT_MODEL=Systran/faster-whisper-small`) + curl smoke test.
5. **whisper.cpp server** — the dossier run line (`--convert`, `--inference-path /v1/audio/transcriptions`, port 8080) + matching env lines; note `--convert` requires ffmpeg in that container.
6. **LLM extraction** — what the extractor does, `none` fallback behavior, Ollama example (`OPENDOIST_LLM_BASE_URL=http://ollama:11434/v1`, `OPENDOIST_LLM_MODEL=llama3.1:8b`, no key), note on strict-JSON + one retry.
7. **Troubleshooting** — 409 on upload = no STT configured; `failed` + error text on the ramble = check provider key/URL, use per-stage Retry; browser mic permission; iOS PWA note (webm/opus since Safari 18.4, mp4 fallback earlier).

- [ ] **Step 1:** Write the page. **Step 2:** Verify: `pnpm lint` clean (Biome formats md if configured; otherwise no-op); every code fence syntactically valid YAML/bash; env var names match Task H exactly (grep them against `provider-config.ts`).

---

### Task N: Integration gate (SEQUENTIAL — after B–M)

**Files:** may touch anything needed to make the gate pass (smallest possible diffs). Expected edits: mount `rambleRoutes` + `integrationsRoutes` in the as-built server app entry; delete `apps/server/src/rambles/AS_BUILT.md`; un-skip any `// un-skipped at Task N` blocks from Task F.

- [ ] **Step 1:** Mount both route modules under `/api/v1` following the as-built registration pattern; ensure OpenAPI doc at `/api/v1/openapi.json` now lists the ramble + integrations paths (Scalar UI renders them).
- [ ] **Step 2:** Un-skip Task F's confirm-flow tests. Run `pnpm verify` (lint + typecheck + test + build, all packages) → green. Fix failures with minimal diffs; record every fix in your result notes.
- [ ] **Step 3: End-to-end smoke (no external providers needed).** Script with a temp `DATA_DIR`:
  1. Start the built server on port 7968 with `OPENDOIST_STT_PROVIDER` unset → login with the as-built test/bootstrap user → `POST /api/v1/rambles` with a small file → expect **409** problem-JSON "No speech-to-text provider is configured".
  2. Restart with `OPENDOIST_STT_PROVIDER=openai-compatible OPENDOIST_STT_BASE_URL=http://127.0.0.1:9/v1` (unroutable) → upload → **201**; poll `GET /rambles/:id` until status `failed` with `failedStage: "transcribe"` and non-empty `error`; `POST /rambles/:id/transcribe` → 200 with status `failed` again (retry path works); `DELETE` → 204 and the file under `<DATA_DIR>/rambles/` is gone.
  3. `GET /api/v1/settings/integrations` → 200 with `stt.source: "env"`; `POST /api/v1/settings/integrations/llm/test` → `{ok:true}` disabled message.
  4. `GET /api/v1/info` → feature flags reflect STT configured true / LLM false.
- [ ] **Step 4:** Confirm-path proof without network: run the Task F integration suite verbose (`pnpm --filter @opendoist/server exec vitest run src/rambles --reporter=verbose`) — upload→transcribe→extract→confirm creates 2 tasks and deletes audio.
- [ ] **Step 5:** `pnpm --filter @opendoist/web build` → PWA bundle builds; if the phase-4/5 Playwright harness exists, add one smoke: Settings → Integrations renders and the mic button is disabled-with-tooltip when STT unconfigured (skip gracefully if the harness isn't there; note it).
- [ ] **Step 6:** Do not commit — report ready-for-checkpoint.

## Self-Review (done)

- Spec §3.2 Ramble coverage: multipart upload + status row (`uploaded → transcribed → extracted`, retryable stages, audio kept until confirm) → Tasks A/F; STT adapters openai-compatible/deepgram/elevenlabs → B/C/D; extractor `none` + openai-compatible with strict JSON schema, spoken-phrase due parsed by our core date layer, zod + one retry → E/G; encrypted keys from `/data/secrets.json` → H; hold-to-record → review/edit → confirm-save → J/K; Integrations settings + env defaults with per-user override → H/I/L; docs sidecar page → M. Required vitest coverage (adapter request shapes, extractor validation+retry, confirm-flow integration) → B–E, F, G.
- Deliberate decisions: statuses kept to the spec's five (no `transcribing`/`extracting` — `uploaded`/`transcribed` + polling spinner cover in-flight); "same path as /tasks/quick" implemented as the same task-creation *service* (with SSE/activity/auto-reminder) fed by parsed drafts rather than re-serializing to quick-add text (lossless for literal `#`/`@` in spoken titles); rambles hard-delete on discard (transient capture state — spec's soft-delete rule covers user-visible task entities); slot-level (not field-level) user override for provider config; provider test endpoints return `{ok:false}` with HTTP 200 so the UI can render failures as data; camelCase ramble/integrations wire format recorded as a frozen deviation from the snake_case rule (Global Constraints), with `GET /rambles` keeping the `{results, next_cursor: null}` envelope; `encryptionKey` is CONSUMED from phase 3's secrets (base64url decode), never generated here.
- Parallel safety: file lists are strictly disjoint; every cross-task import goes through a Task A frozen file (schemas/types/registry/stubs/web client/store); the only shared-file edits (app entry, Quick Add, root layout, settings registry, docs index) each have exactly one owner; zero new dependencies so no `pnpm install` anywhere.
- Placeholder scan: Task A stubs are explicitly temporary and each is replaced by a named task; `AS_BUILT.md` is deleted at Task N; no TBDs remain.
- Drift protection: 10-item AS-BUILT map resolved once in Task A and recorded for all builders; per-task AS-BUILT CHECK bullets at every point of contact with phase 3–6 output (schema conventions, auth/error idioms, quick-create service, secrets module, env module, info flags, web mount points, chip editors).


