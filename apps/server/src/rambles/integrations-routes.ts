/**
 * Phase 7 Task I — Settings → Integrations API (STT + LLM provider config) + provider test
 * endpoints. Mounted under /api/v1 by Task N. Wire format is camelCase (frozen deviation).
 *
 * Config resolution + persistence live in provider-config.ts (Task H); this module is just the
 * HTTP surface. The test endpoints build a live provider through the registry and exercise it with
 * a tiny silent WAV / fixed sample transcript, wrapping every network call in a 15 s abort guard
 * and returning the outcome as DATA (always HTTP 200) so the settings UI can render pass/fail
 * inline without treating a provider failure as a transport error.
 *
 * The optional `fetchImpl` on the factory is the ONLY test seam: it flows into the registry so
 * adapters hit an injected mock instead of a real API (hard rule: never call real STT/LLM APIs).
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { AppEnv } from '../app'
import type { Config } from '../config'
import { problem } from '../lib/problem'
import {
  getIntegrationsView,
  type ProviderEnv,
  resolveLlmConfig,
  resolveSttConfig,
  saveIntegrations,
} from './provider-config'
import { createExtractor, createSttProvider } from './providers/registry'
import type { FetchLike, ResolvedLlmConfig, ResolvedSttConfig } from './providers/types'
import {
  IntegrationsGetSchema,
  IntegrationsPutSchema,
  LlmProviderIdSchema,
  ProviderTestRequestSchema,
  ProviderTestResponseSchema,
  SttProviderIdSchema,
} from './schemas'
import { makeTestWav } from './test-audio'

export interface IntegrationsRoutesDeps {
  /** Injected into the provider registry so tests mock the network; defaults to global fetch. */
  fetchImpl?: FetchLike
}

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }]
const tags = ['integrations']

/** RFC 9457 problem-details body (matches `lib/problem.ts`). */
const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
})
const problemResponse = (description: string) => ({
  content: { 'application/problem+json': { schema: ProblemSchema } },
  description,
})

const PROVIDER_TEST_TIMEOUT_MS = 15_000
const SAMPLE_TRANSCRIPT = 'Buy milk tomorrow and email Sam on Friday'
const EXTRACTION_DISABLED_DETAIL = 'Extraction disabled — rambles become a single task'

/**
 * The env-default provider slots, built from the already-parsed config: loadConfig() is the single
 * source of truth for the `OPENDOIST_STT_*` and `OPENDOIST_LLM_*` vars. provider-config uses this as
 * the fallback beneath a per-user override; building it from `deps.config` (not process.env) keeps
 * it overridable in tests.
 */
function providerEnvFromConfig(config: Config): ProviderEnv {
  const { stt, llm } = config
  return {
    sttProvider: stt?.provider,
    sttBaseUrl: stt?.baseUrl ?? undefined,
    sttModel: stt?.model ?? undefined,
    sttApiKey: stt?.apiKey ?? undefined,
    llmProvider: llm?.provider,
    llmBaseUrl: llm?.baseUrl ?? undefined,
    llmModel: llm?.model ?? undefined,
    llmApiKey: llm?.apiKey ?? undefined,
  }
}

/** Wrap a fetch impl with an abort-based timeout so a hung provider can't stall the settings UI. */
const withTimeout =
  (impl: FetchLike, ms: number): FetchLike =>
  async (input, init) => {
    if (init?.signal) return impl(input, init)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const err = new Error(`Provider did not respond within ${ms / 1000}s`)
      err.name = 'TimeoutError'
      controller.abort(err)
    }, ms)
    timer.unref()
    try {
      return await impl(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

/** ProviderError / abort / any thrown error → a user-facing detail string (never leaks a stack). */
function testFailureDetail(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}

/**
 * The api key for a test candidate: an explicit string is used as-is, `null` means "no key", and an
 * absent (undefined) key falls back to the stored/env key resolved for that slot — so a user can
 * re-test after tweaking only the model/base URL without re-typing their saved secret.
 */
async function resolveCandidateKey(
  apiKey: string | null | undefined,
  resolveStored: () => Promise<{ apiKey: string | null } | null>,
): Promise<string | null> {
  if (apiKey !== undefined) return apiKey
  const stored = await resolveStored()
  return stored?.apiKey ?? null
}

export const integrationsRoutes = (deps: IntegrationsRoutesDeps = {}) => {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'validation failed', undefined, { errors: result.error.issues })
      }
    },
  })
  const fetchImpl = withTimeout(deps.fetchImpl ?? fetch, PROVIDER_TEST_TIMEOUT_MS)

  app.openapi(
    createRoute({
      method: 'get',
      path: '/settings/integrations',
      tags,
      security,
      summary: 'Effective STT + LLM provider configuration',
      description:
        'Per-slot effective config (user override > instance env > none). Never returns key ' +
        'material — only `hasApiKey` and the `source` of the effective config.',
      responses: {
        200: {
          content: { 'application/json': { schema: IntegrationsGetSchema } },
          description: 'Effective integrations configuration',
        },
        401: problemResponse('Not authenticated'),
      },
    }),
    async (c) => {
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const { db, config } = c.get('deps')
      const view = await getIntegrationsView(db, auth.userId, providerEnvFromConfig(config))
      return c.json(view, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: '/settings/integrations',
      tags,
      security,
      summary: 'Update STT + LLM provider configuration',
      description:
        'Slot-level override: a non-null `provider` replaces the whole instance-default slot for ' +
        'this user. `apiKey`: string = set (stored AES-256-GCM encrypted at rest), null = clear, ' +
        'omitted = keep the stored value. `provider: null` reverts the slot to the instance default.',
      request: {
        body: { content: { 'application/json': { schema: IntegrationsPutSchema } } },
      },
      responses: {
        204: { description: 'Saved' },
        400: problemResponse('Invalid provider configuration'),
        401: problemResponse('Not authenticated'),
      },
    }),
    async (c) => {
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const { db } = c.get('deps')
      await saveIntegrations(db, auth.userId, c.req.valid('json'))
      return c.body(null, 204)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/settings/integrations/stt/test',
      tags,
      security,
      summary: 'Test the speech-to-text provider',
      description:
        'Transcribes a short silent WAV through the candidate config (or the saved/env config when ' +
        'no candidate is supplied). A missing candidate `apiKey` reuses the stored/env key. ' +
        'Provider or transport failures are returned as `{ok:false, detail}` with HTTP 200.',
      request: {
        body: { content: { 'application/json': { schema: ProviderTestRequestSchema } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: ProviderTestResponseSchema } },
          description: 'Test outcome',
        },
        400: problemResponse('Invalid request body'),
        401: problemResponse('Not authenticated'),
      },
    }),
    async (c) => {
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const { db, config } = c.get('deps')
      const { candidate } = c.req.valid('json')

      let cfg: ResolvedSttConfig | null
      if (candidate && candidate.provider !== null) {
        const parsed = SttProviderIdSchema.safeParse(candidate.provider)
        if (!parsed.success) {
          return c.json({ ok: false, detail: `Unknown STT provider: ${candidate.provider}` }, 200)
        }
        cfg = {
          provider: parsed.data,
          baseUrl: candidate.baseUrl,
          model: candidate.model,
          apiKey: await resolveCandidateKey(candidate.apiKey, () =>
            resolveSttConfig(db, auth.userId, providerEnvFromConfig(config)),
          ),
        }
      } else {
        cfg = await resolveSttConfig(db, auth.userId, providerEnvFromConfig(config))
      }
      if (cfg === null) {
        return c.json({ ok: false, detail: 'No STT provider configured' }, 200)
      }

      try {
        const result = await createSttProvider(cfg, fetchImpl).transcribe({
          data: makeTestWav(),
          mimeType: 'audio/wav',
          filename: 'test.wav',
        })
        return c.json(
          { ok: true, detail: result.text || '(empty transcript — connection OK)' },
          200,
        )
      } catch (err) {
        return c.json({ ok: false, detail: testFailureDetail(err) }, 200)
      }
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/settings/integrations/llm/test',
      tags,
      security,
      summary: 'Test the LLM task extractor',
      description:
        'Runs the extractor over a fixed sample transcript. When extraction is disabled (no ' +
        'provider, or `none`), returns `{ok:true}` explaining that rambles become a single task. ' +
        'Provider or transport failures are returned as `{ok:false, detail}` with HTTP 200.',
      request: {
        body: { content: { 'application/json': { schema: ProviderTestRequestSchema } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: ProviderTestResponseSchema } },
          description: 'Test outcome',
        },
        400: problemResponse('Invalid request body'),
        401: problemResponse('Not authenticated'),
      },
    }),
    async (c) => {
      const auth = c.get('auth')
      if (!auth) return problem(c, 401, 'unauthorized')
      const { db, config } = c.get('deps')
      const { candidate } = c.req.valid('json')

      let cfg: ResolvedLlmConfig | null
      if (candidate && candidate.provider !== null) {
        if (candidate.provider === 'none') {
          cfg = null // explicit passthrough — extraction disabled
        } else {
          const parsed = LlmProviderIdSchema.safeParse(candidate.provider)
          if (!parsed.success) {
            return c.json({ ok: false, detail: `Unknown LLM provider: ${candidate.provider}` }, 200)
          }
          cfg = {
            provider: parsed.data,
            baseUrl: candidate.baseUrl,
            model: candidate.model,
            apiKey: await resolveCandidateKey(candidate.apiKey, () =>
              resolveLlmConfig(db, auth.userId, providerEnvFromConfig(config)),
            ),
          }
        }
      } else {
        cfg = await resolveLlmConfig(db, auth.userId, providerEnvFromConfig(config))
      }
      if (cfg === null) {
        return c.json({ ok: true, detail: EXTRACTION_DISABLED_DETAIL }, 200)
      }

      try {
        const result = await createExtractor(cfg, fetchImpl).extract(SAMPLE_TRANSCRIPT, {
          now: new Date().toISOString(),
          timezone: 'UTC',
          knownLabels: [],
        })
        return c.json({ ok: true, detail: `Extracted ${result.tasks.length} task(s)` }, 200)
      } catch (err) {
        return c.json({ ok: false, detail: testFailureDetail(err) }, 200)
      }
    },
  )

  return app
}
