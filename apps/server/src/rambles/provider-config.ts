import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Db } from '../db/db'
import { providerSettings } from '../db/schema'
import { nowIso } from '../lib/ids'
import { decryptSecret, encryptSecret } from '../lib/secret-crypto'
import type { ResolvedLlmConfig, ResolvedSttConfig } from './providers/types'
import {
  type IntegrationsGetSchema,
  type IntegrationsPutSchema,
  LlmProviderIdSchema,
  SttProviderIdSchema,
} from './schemas'

/** Flat OPENTASK_STT_* / OPENTASK_LLM_* env slot (instance-wide defaults). */
export interface ProviderEnv {
  sttProvider?: string
  sttBaseUrl?: string
  sttModel?: string
  sttApiKey?: string
  llmProvider?: string
  llmBaseUrl?: string
  llmModel?: string
  llmApiKey?: string
}

/**
 * Reads the instance-wide provider defaults from the environment. The env is the single source of
 * truth (`config.stt`/`config.llm` parse the same vars); this keeps the frozen flat shape so
 * `resolve*Config` stays independent of the config module. Empty strings pass through as-is and are
 * treated as "unset" by the resolvers.
 */
export function readProviderEnv(env: NodeJS.ProcessEnv = process.env): ProviderEnv {
  return {
    sttProvider: env.OPENTASK_STT_PROVIDER,
    sttBaseUrl: env.OPENTASK_STT_BASE_URL,
    sttModel: env.OPENTASK_STT_MODEL,
    sttApiKey: env.OPENTASK_STT_API_KEY,
    llmProvider: env.OPENTASK_LLM_PROVIDER,
    llmBaseUrl: env.OPENTASK_LLM_BASE_URL,
    llmModel: env.OPENTASK_LLM_MODEL,
    llmApiKey: env.OPENTASK_LLM_API_KEY,
  }
}

type ProviderRow = typeof providerSettings.$inferSelect

function getRow(db: Db, userId: string): ProviderRow | null {
  return db.select().from(providerSettings).where(eq(providerSettings.userId, userId)).get() ?? null
}

/**
 * Env values are strings, so a set-but-empty var (`OPENTASK_STT_API_KEY=`) arrives as ''. The
 * resolvers treat that as unset (the contract documented on `readProviderEnv`): '' → null, so an
 * adapter never emits a malformed empty credential (`Authorization: Bearer ` / `xi-api-key: ""`)
 * and the resolved config agrees with the view's `hasApiKey: Boolean(...)`.
 */
function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null
}

/** Warn at most once per (slot, invalid value) so a mis-set env var is visible but not spammy. */
const warnedInvalidProviders = new Set<string>()
function warnInvalidProvider(slot: 'stt' | 'llm', value: string): void {
  const key = `${slot}:${value}`
  if (warnedInvalidProviders.has(key)) return
  warnedInvalidProviders.add(key)
  console.warn(
    `[opentask] ignoring OPENTASK_${slot.toUpperCase()}_PROVIDER=${JSON.stringify(value)}: not a recognized provider; treating as unset`,
  )
}

/**
 * Effective STT config: a user row with a non-null `sttProvider` replaces the WHOLE env slot (no
 * field merging); otherwise a valid env provider; otherwise null (STT unconfigured → uploads 409).
 * An invalid env provider string is warned once and treated as unset.
 */
export async function resolveSttConfig(
  db: Db,
  userId: string,
  env: ProviderEnv,
): Promise<ResolvedSttConfig | null> {
  const row = getRow(db, userId)
  if (row?.sttProvider != null) {
    return {
      provider: row.sttProvider,
      baseUrl: row.sttBaseUrl,
      model: row.sttModel,
      apiKey: row.sttApiKeyEnc ? decryptSecret(row.sttApiKeyEnc) : null,
    }
  }
  const provider = env.sttProvider
  if (!provider) return null
  const parsed = SttProviderIdSchema.safeParse(provider)
  if (!parsed.success) {
    warnInvalidProvider('stt', provider)
    return null
  }
  return {
    provider: parsed.data,
    baseUrl: emptyToNull(env.sttBaseUrl),
    model: emptyToNull(env.sttModel),
    apiKey: emptyToNull(env.sttApiKey),
  }
}

/**
 * Effective LLM config: same slot-level resolution as STT, plus a `'none'` provider (env or, in
 * theory, user) resolves to null — the explicit passthrough that makes each ramble a single task.
 * null here → registry yields the `none` extractor.
 */
export async function resolveLlmConfig(
  db: Db,
  userId: string,
  env: ProviderEnv,
): Promise<ResolvedLlmConfig | null> {
  const row = getRow(db, userId)
  if (row?.llmProvider != null) {
    // The DB enum only permits 'openai-compatible', but guard 'none' defensively for passthrough.
    if ((row.llmProvider as string) === 'none') return null
    return {
      provider: row.llmProvider,
      baseUrl: row.llmBaseUrl,
      model: row.llmModel,
      apiKey: row.llmApiKeyEnc ? decryptSecret(row.llmApiKeyEnc) : null,
    }
  }
  const provider = env.llmProvider
  if (!provider || provider === 'none') return null
  const parsed = LlmProviderIdSchema.safeParse(provider)
  if (!parsed.success) {
    warnInvalidProvider('llm', provider)
    return null
  }
  return {
    provider: parsed.data,
    baseUrl: emptyToNull(env.llmBaseUrl),
    model: emptyToNull(env.llmModel),
    apiKey: emptyToNull(env.llmApiKey),
  }
}

type IntegrationsView = z.infer<typeof IntegrationsGetSchema>

function sttView(row: ProviderRow | null, env: ProviderEnv): IntegrationsView['stt'] {
  if (row?.sttProvider != null) {
    return {
      provider: row.sttProvider,
      baseUrl: row.sttBaseUrl,
      model: row.sttModel,
      hasApiKey: row.sttApiKeyEnc != null,
      source: 'user',
    }
  }
  const parsed = SttProviderIdSchema.safeParse(env.sttProvider)
  if (parsed.success) {
    // emptyToNull keeps the view in lockstep with resolveSttConfig for set-but-empty env vars.
    return {
      provider: parsed.data,
      baseUrl: emptyToNull(env.sttBaseUrl),
      model: emptyToNull(env.sttModel),
      hasApiKey: Boolean(env.sttApiKey),
      source: 'env',
    }
  }
  return { provider: null, baseUrl: null, model: null, hasApiKey: false, source: 'none' }
}

function llmView(row: ProviderRow | null, env: ProviderEnv): IntegrationsView['llm'] {
  if (row?.llmProvider != null) {
    return {
      provider: row.llmProvider,
      baseUrl: row.llmBaseUrl,
      model: row.llmModel,
      hasApiKey: row.llmApiKeyEnc != null,
      source: 'user',
    }
  }
  // A valid provider is 'env'; 'none'/invalid/unset all collapse to the disabled 'none' view,
  // mirroring resolveLlmConfig (which returns null for each).
  const parsed = LlmProviderIdSchema.safeParse(env.llmProvider)
  if (parsed.success) {
    return {
      provider: parsed.data,
      baseUrl: emptyToNull(env.llmBaseUrl),
      model: emptyToNull(env.llmModel),
      hasApiKey: Boolean(env.llmApiKey),
      source: 'env',
    }
  }
  return { provider: null, baseUrl: null, model: null, hasApiKey: false, source: 'none' }
}

/**
 * Per-slot effective view for Settings → Integrations: `{ provider, baseUrl, model, hasApiKey,
 * source }`, resolving user > env > none. NEVER returns key material (encrypted or plaintext) —
 * only the `hasApiKey` boolean.
 */
export async function getIntegrationsView(
  db: Db,
  userId: string,
  env: ProviderEnv,
): Promise<IntegrationsView> {
  const row = getRow(db, userId)
  return { stt: sttView(row, env), llm: llmView(row, env) }
}

type ProviderInsert = typeof providerSettings.$inferInsert

/**
 * Upsert the user's `provider_settings` row. Per provided slot: `provider: null` clears all four
 * columns (reverts to env); otherwise provider/baseUrl/model are replaced wholesale and the key is
 * encrypted (string), cleared (null), or kept (undefined/absent). Unprovided slots are untouched.
 */
export async function saveIntegrations(
  db: Db,
  userId: string,
  patch: z.infer<typeof IntegrationsPutSchema>,
): Promise<void> {
  const existing = getRow(db, userId)
  const next: ProviderInsert = {
    userId,
    sttProvider: existing?.sttProvider ?? null,
    sttBaseUrl: existing?.sttBaseUrl ?? null,
    sttModel: existing?.sttModel ?? null,
    sttApiKeyEnc: existing?.sttApiKeyEnc ?? null,
    llmProvider: existing?.llmProvider ?? null,
    llmBaseUrl: existing?.llmBaseUrl ?? null,
    llmModel: existing?.llmModel ?? null,
    llmApiKeyEnc: existing?.llmApiKeyEnc ?? null,
    updatedAt: nowIso(),
  }

  if (patch.stt) {
    const slot = patch.stt
    if (slot.provider === null) {
      next.sttProvider = null
      next.sttBaseUrl = null
      next.sttModel = null
      next.sttApiKeyEnc = null
    } else {
      next.sttProvider = slot.provider
      next.sttBaseUrl = slot.baseUrl
      next.sttModel = slot.model
      next.sttApiKeyEnc = nextKeyEnc(slot.apiKey, next.sttApiKeyEnc ?? null)
    }
  }

  if (patch.llm) {
    const slot = patch.llm
    if (slot.provider === null) {
      next.llmProvider = null
      next.llmBaseUrl = null
      next.llmModel = null
      next.llmApiKeyEnc = null
    } else {
      next.llmProvider = slot.provider
      next.llmBaseUrl = slot.baseUrl
      next.llmModel = slot.model
      next.llmApiKeyEnc = nextKeyEnc(slot.apiKey, next.llmApiKeyEnc ?? null)
    }
  }

  if (existing) {
    db.update(providerSettings).set(next).where(eq(providerSettings.userId, userId)).run()
  } else {
    db.insert(providerSettings).values(next).run()
  }
}

/** apiKey: string → encrypt; null → clear; undefined/absent → keep the current envelope. */
function nextKeyEnc(apiKey: string | null | undefined, current: string | null): string | null {
  if (apiKey === undefined) return current
  if (apiKey === null) return null
  return encryptSecret(apiKey)
}
