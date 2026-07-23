import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { user } from '../db/auth-schema'
import { type Db, openDb } from '../db/db'
import { providerSettings } from '../db/schema'
import { decryptSecret } from '../lib/secret-crypto'
import { ensureDataDirAndSecrets } from '../secrets'
import {
  getIntegrationsView,
  type ProviderEnv,
  readProviderEnv,
  resolveLlmConfig,
  resolveSttConfig,
  saveIntegrations,
} from './provider-config'

const USER = 'user_test_h'

let dataDir: string
let db: Db
let sqlite: ReturnType<typeof openDb>['sqlite']
let originalDataDir: string | undefined

const rowFor = (userId: string) =>
  db.select().from(providerSettings).where(eq(providerSettings.userId, userId)).get()

beforeAll(() => {
  originalDataDir = process.env.OPENTASK_DATA_DIR
  dataDir = mkdtempSync(join(tmpdir(), 'opentask-pc-'))
  // getEncryptionKey() reads loadConfig().dataDir, so point it at this temp dir's secrets.json.
  process.env.OPENTASK_DATA_DIR = dataDir
  ensureDataDirAndSecrets(dataDir)
  const opened = openDb(join(dataDir, 'opentask.db'))
  db = opened.db
  sqlite = opened.sqlite
  db.insert(user).values({ id: USER, name: 'Test', email: 'h@example.com' }).run()
})

afterAll(() => {
  sqlite.close()
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.OPENTASK_DATA_DIR
  else process.env.OPENTASK_DATA_DIR = originalDataDir
})

beforeEach(() => {
  db.delete(providerSettings).run()
})

describe('readProviderEnv', () => {
  it('maps OPENTASK_STT_*/LLM_* into the flat slot shape', () => {
    const env = readProviderEnv({
      OPENTASK_STT_PROVIDER: 'deepgram',
      OPENTASK_STT_BASE_URL: 'https://api.deepgram.com',
      OPENTASK_STT_MODEL: 'nova-3',
      OPENTASK_STT_API_KEY: 'dg',
      OPENTASK_LLM_PROVIDER: 'openai-compatible',
      OPENTASK_LLM_MODEL: 'gpt-4o-mini',
    })
    expect(env.sttProvider).toBe('deepgram')
    expect(env.sttBaseUrl).toBe('https://api.deepgram.com')
    expect(env.sttModel).toBe('nova-3')
    expect(env.sttApiKey).toBe('dg')
    expect(env.llmProvider).toBe('openai-compatible')
    expect(env.llmModel).toBe('gpt-4o-mini')
    expect(env.llmBaseUrl).toBeUndefined()
    expect(env.llmApiKey).toBeUndefined()
  })
})

describe('resolveSttConfig / resolveLlmConfig', () => {
  it('resolves the env slot when there is no user override', async () => {
    const env: ProviderEnv = {
      sttProvider: 'openai-compatible',
      sttBaseUrl: 'https://api.openai.com/v1',
      sttModel: 'gpt-4o-mini-transcribe',
      sttApiKey: 'sk-env',
    }
    expect(await resolveSttConfig(db, USER, env)).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini-transcribe',
      apiKey: 'sk-env',
    })
  })

  it('returns null when neither user nor env configures the slot', async () => {
    expect(await resolveSttConfig(db, USER, {})).toBeNull()
    expect(await resolveLlmConfig(db, USER, {})).toBeNull()
  })

  it('a user row replaces the WHOLE env slot with no field leakage', async () => {
    await saveIntegrations(db, USER, {
      stt: { provider: 'deepgram', baseUrl: null, model: 'nova-3', apiKey: 'dg-key' },
    })
    const env: ProviderEnv = {
      sttProvider: 'openai-compatible',
      sttBaseUrl: 'https://api.openai.com/v1',
      sttModel: 'gpt-4o-mini-transcribe',
      sttApiKey: 'sk-env',
    }
    // deepgram wins; env baseUrl/model/apiKey do NOT bleed through (user baseUrl is null).
    expect(await resolveSttConfig(db, USER, env)).toEqual({
      provider: 'deepgram',
      baseUrl: null,
      model: 'nova-3',
      apiKey: 'dg-key',
    })
  })

  it('an invalid env provider is treated as unset and warned once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await resolveSttConfig(db, USER, { sttProvider: 'bogus-provider' })).toBeNull()
      expect(await resolveSttConfig(db, USER, { sttProvider: 'bogus-provider' })).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('env llm provider "none" resolves to null (explicit passthrough)', async () => {
    // null here feeds registry.createExtractor(null) → the `none` passthrough extractor.
    expect(await resolveLlmConfig(db, USER, { llmProvider: 'none' })).toBeNull()
  })

  it('treats set-but-empty env values (OPENTASK_STT_API_KEY=) as unset', async () => {
    // Regression: '' used to pass through as apiKey '' → adapters sent `Authorization: Bearer `
    // / `xi-api-key: ""` while the view said hasApiKey:false for the very same env.
    const env = readProviderEnv({
      OPENTASK_STT_PROVIDER: 'openai-compatible',
      OPENTASK_STT_BASE_URL: '',
      OPENTASK_STT_MODEL: '',
      OPENTASK_STT_API_KEY: '',
      OPENTASK_LLM_PROVIDER: 'openai-compatible',
      OPENTASK_LLM_API_KEY: '',
    } as NodeJS.ProcessEnv)
    expect(await resolveSttConfig(db, USER, env)).toEqual({
      provider: 'openai-compatible',
      baseUrl: null,
      model: null,
      apiKey: null,
    })
    expect((await resolveLlmConfig(db, USER, env))?.apiKey).toBeNull()
  })
})

describe('saveIntegrations', () => {
  it('stores the api key encrypted (never plaintext) and decrypts back to the original', async () => {
    await saveIntegrations(db, USER, {
      stt: {
        provider: 'openai-compatible',
        baseUrl: null,
        model: null,
        apiKey: 'sk-plaintext-123',
      },
    })
    const row = rowFor(USER)
    expect(row?.sttApiKeyEnc).toMatch(/^v1:/)
    expect(row?.sttApiKeyEnc).not.toContain('sk-plaintext-123')
    expect(decryptSecret(row?.sttApiKeyEnc ?? '')).toBe('sk-plaintext-123')
  })

  it('apiKey undefined keeps the stored key; null clears it', async () => {
    await saveIntegrations(db, USER, {
      stt: { provider: 'openai-compatible', baseUrl: null, model: 'm1', apiKey: 'sk-keep' },
    })
    // No apiKey field → keep the stored key, replace baseUrl/model.
    await saveIntegrations(db, USER, {
      stt: { provider: 'openai-compatible', baseUrl: 'https://x', model: 'm2' },
    })
    expect(await resolveSttConfig(db, USER, {})).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://x',
      model: 'm2',
      apiKey: 'sk-keep',
    })
    // apiKey: null → clear.
    await saveIntegrations(db, USER, {
      stt: { provider: 'openai-compatible', baseUrl: 'https://x', model: 'm2', apiKey: null },
    })
    expect((await resolveSttConfig(db, USER, {}))?.apiKey).toBeNull()
  })

  it('provider null clears all four columns of the slot and reverts to env', async () => {
    await saveIntegrations(db, USER, {
      stt: { provider: 'deepgram', baseUrl: 'https://dg', model: 'nova-3', apiKey: 'dg' },
    })
    await saveIntegrations(db, USER, { stt: { provider: null, baseUrl: null, model: null } })
    const row = rowFor(USER)
    expect(row?.sttProvider).toBeNull()
    expect(row?.sttBaseUrl).toBeNull()
    expect(row?.sttModel).toBeNull()
    expect(row?.sttApiKeyEnc).toBeNull()
    // now env is the effective config
    const env: ProviderEnv = {
      sttProvider: 'openai-compatible',
      sttModel: 'gpt-4o-mini-transcribe',
    }
    expect(await resolveSttConfig(db, USER, env)).toEqual({
      provider: 'openai-compatible',
      baseUrl: null,
      model: 'gpt-4o-mini-transcribe',
      apiKey: null,
    })
  })

  it('leaves an unprovided slot untouched', async () => {
    await saveIntegrations(db, USER, {
      stt: { provider: 'deepgram', baseUrl: null, model: 'nova-3', apiKey: 'dg' },
    })
    // Only touch llm; stt must survive.
    await saveIntegrations(db, USER, {
      llm: { provider: 'openai-compatible', baseUrl: null, model: 'gpt-4o-mini', apiKey: 'sk-llm' },
    })
    const stt = await resolveSttConfig(db, USER, {})
    expect(stt?.provider).toBe('deepgram')
    expect(stt?.apiKey).toBe('dg')
    const llm = await resolveLlmConfig(db, USER, {})
    expect(llm).toEqual({
      provider: 'openai-compatible',
      baseUrl: null,
      model: 'gpt-4o-mini',
      apiKey: 'sk-llm',
    })
  })
})

describe('getIntegrationsView', () => {
  it('defaults to all-none with no user row and no env', async () => {
    const view = await getIntegrationsView(db, USER, {})
    expect(view.stt).toEqual({
      provider: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
      source: 'none',
    })
    expect(view.llm).toEqual({
      provider: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
      source: 'none',
    })
  })

  it('reports source/hasApiKey and never leaks key material', async () => {
    await saveIntegrations(db, USER, {
      stt: {
        provider: 'openai-compatible',
        baseUrl: 'https://u',
        model: 'um',
        apiKey: 'sk-secret-xyz',
      },
    })
    const env: ProviderEnv = {
      llmProvider: 'openai-compatible',
      llmBaseUrl: 'https://llm',
      llmModel: 'gpt-4o-mini',
      llmApiKey: 'sk-llm-env',
    }
    const view = await getIntegrationsView(db, USER, env)
    expect(view.stt).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://u',
      model: 'um',
      hasApiKey: true,
      source: 'user',
    })
    expect(view.llm).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://llm',
      model: 'gpt-4o-mini',
      hasApiKey: true,
      source: 'env',
    })
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('sk-secret-xyz')
    expect(serialized).not.toContain('sk-llm-env')
    expect(serialized).not.toContain(rowFor(USER)?.sttApiKeyEnc ?? 'no-envelope')
  })

  it('an env "none" llm provider shows source none (disabled), not env', async () => {
    const view = await getIntegrationsView(db, USER, { llmProvider: 'none' })
    expect(view.llm.source).toBe('none')
    expect(view.llm.provider).toBeNull()
  })

  it('agrees with the resolver for a set-but-empty env slot (hasApiKey false ⇔ apiKey null)', async () => {
    const env: ProviderEnv = {
      sttProvider: 'openai-compatible',
      sttBaseUrl: '',
      sttModel: '',
      sttApiKey: '',
    }
    const view = await getIntegrationsView(db, USER, env)
    expect(view.stt).toEqual({
      provider: 'openai-compatible',
      baseUrl: null,
      model: null,
      hasApiKey: false,
      source: 'env',
    })
    // The contradiction from the review finding: the view said "no key" while the resolver
    // handed adapters apiKey '' — both sides must treat '' as unset.
    expect((await resolveSttConfig(db, USER, env))?.apiKey).toBeNull()
  })
})
