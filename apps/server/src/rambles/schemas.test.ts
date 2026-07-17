import { describe, expect, it } from 'vitest'
import {
  ConfirmRambleSchema,
  EXTRACTED_TASKS_JSON_SCHEMA,
  ExtractedTaskSchema,
  IntegrationsPutSchema,
} from './schemas'

const validTask = {
  title: 'buy milk',
  notes: null,
  due: 'tomorrow',
  priority: 2,
  labels: ['errands'],
}

describe('ExtractedTaskSchema', () => {
  it('accepts a valid task', () => {
    expect(ExtractedTaskSchema.parse(validTask)).toEqual(validTask)
  })

  it('rejects priority 0 and 5 (1 = highest … 4 = default)', () => {
    expect(ExtractedTaskSchema.safeParse({ ...validTask, priority: 0 }).success).toBe(false)
    expect(ExtractedTaskSchema.safeParse({ ...validTask, priority: 5 }).success).toBe(false)
  })

  it('accepts null priority', () => {
    expect(ExtractedTaskSchema.parse({ ...validTask, priority: null }).priority).toBeNull()
  })

  it('rejects an empty title', () => {
    expect(ExtractedTaskSchema.safeParse({ ...validTask, title: '' }).success).toBe(false)
  })

  it('applies the labels default when absent', () => {
    const { labels: _labels, ...noLabels } = validTask
    expect(ExtractedTaskSchema.parse(noLabels).labels).toEqual([])
  })
})

describe('ConfirmRambleSchema', () => {
  it('rejects an empty task list', () => {
    expect(ConfirmRambleSchema.safeParse({ tasks: [] }).success).toBe(false)
  })

  it('accepts a non-empty task list', () => {
    expect(ConfirmRambleSchema.parse({ tasks: [validTask] }).tasks).toHaveLength(1)
  })
})

describe('IntegrationsPutSchema', () => {
  const slot = { provider: 'deepgram', baseUrl: null, model: 'nova-3' }

  it('apiKey absent stays undefined (= keep stored value)', () => {
    const parsed = IntegrationsPutSchema.parse({ stt: slot })
    expect(parsed.stt).toBeDefined()
    expect(parsed.stt?.apiKey).toBeUndefined()
  })

  it('apiKey null is accepted (= clear)', () => {
    const parsed = IntegrationsPutSchema.parse({ stt: { ...slot, apiKey: null } })
    expect(parsed.stt?.apiKey).toBeNull()
  })

  it('apiKey string is accepted (= set), empty string is not', () => {
    const parsed = IntegrationsPutSchema.parse({ stt: { ...slot, apiKey: 'dg-secret' } })
    expect(parsed.stt?.apiKey).toBe('dg-secret')
    expect(IntegrationsPutSchema.safeParse({ stt: { ...slot, apiKey: '' } }).success).toBe(false)
  })

  it('rejects unknown provider ids per slot', () => {
    expect(IntegrationsPutSchema.safeParse({ stt: { ...slot, provider: 'aws' } }).success).toBe(
      false,
    )
    expect(
      IntegrationsPutSchema.safeParse({
        llm: { provider: 'deepgram', baseUrl: null, model: null },
      }).success,
    ).toBe(false)
  })
})

describe('EXTRACTED_TASKS_JSON_SCHEMA (guards drift from dossier §5.7)', () => {
  it('has additionalProperties: false at both levels', () => {
    expect(EXTRACTED_TASKS_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(EXTRACTED_TASKS_JSON_SCHEMA.properties.tasks.items.additionalProperties).toBe(false)
  })

  it('requires all five item fields', () => {
    expect([...EXTRACTED_TASKS_JSON_SCHEMA.properties.tasks.items.required]).toEqual([
      'title',
      'notes',
      'due',
      'priority',
      'labels',
    ])
    expect([...EXTRACTED_TASKS_JSON_SCHEMA.required]).toEqual(['tasks'])
  })
})
