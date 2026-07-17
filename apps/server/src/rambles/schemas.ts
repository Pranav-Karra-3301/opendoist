/**
 * Phase 7 FROZEN contracts (plan Task A Step 2) — ramble/integrations wire schemas.
 * Wire format is camelCase (recorded deviation from the phase-3 snake_case convention,
 * mirrored verbatim by `apps/web/src/api/rambles.ts`; no mapping layer anywhere).
 */
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
            description:
              "natural-language date phrase as spoken, e.g. 'tomorrow 5pm'; null if none",
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

export const RambleStatusSchema = z.enum([
  'uploaded',
  'transcribed',
  'extracted',
  'confirmed',
  'failed',
])
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

export const RambleListSchema = z.object({
  results: z.array(RambleSchema),
  next_cursor: z.string().nullable().default(null),
})
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
export const ProviderTestResponseSchema = z.object({
  ok: z.boolean(),
  detail: z.string().nullable(),
})
