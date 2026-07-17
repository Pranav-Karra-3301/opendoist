import { describe, expect, it, vi } from 'vitest'
import { EXTRACTED_TASKS_JSON_SCHEMA } from '../schemas'
import {
  buildExtractionSystemPrompt,
  createOpenAiCompatibleExtractor,
} from './extractor-openai-compatible'
import {
  type ExtractorContext,
  type FetchLike,
  ProviderError,
  type ResolvedLlmConfig,
} from './types'

const cfg: ResolvedLlmConfig = {
  provider: 'openai-compatible',
  baseUrl: null,
  model: null,
  apiKey: 'sk-test',
}
const ctx: ExtractorContext = {
  now: '2026-07-15T21:00:00Z',
  timezone: 'America/New_York',
  knownLabels: ['home', 'errands'],
}

/** JSON HTTP response the adapter can call `.json()`/`.text()` on (real Node Response). */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Wrap a JSON string as an openai chat-completion body. */
function completion(content: string): unknown {
  return { choices: [{ message: { content } }] }
}

/** A fetch stub that hands back the queued responses in order and records every call. */
function makeFetch(responses: Response[]) {
  let i = 0
  return vi.fn((_url: string, _init?: RequestInit): Promise<Response> => {
    const res = responses[i]
    i += 1
    if (!res) return Promise.reject(new Error(`unexpected fetch call #${i}`))
    return Promise.resolve(res)
  })
}
type FetchFn = ReturnType<typeof makeFetch>

function callAt(fn: FetchFn, n: number): { url: string; init: RequestInit } {
  const call = fn.mock.calls[n]
  if (!call) throw new Error(`no fetch call #${n}`)
  return { url: call[0], init: (call[1] ?? {}) as RequestInit }
}

interface Msg {
  role: string
  content: string
}
interface Body {
  model: string
  temperature: number
  messages: Msg[]
  response_format: unknown
}
function bodyOf(fn: FetchFn, n: number): Body {
  return JSON.parse(String(callAt(fn, n).init.body)) as Body
}
function headersOf(fn: FetchFn, n: number): Record<string, string> {
  return (callAt(fn, n).init.headers ?? {}) as Record<string, string>
}

describe('buildExtractionSystemPrompt', () => {
  it('joins known labels and embeds the current datetime + timezone', () => {
    const p = buildExtractionSystemPrompt(ctx)
    expect(p).toContain('discrete actionable tasks')
    expect(p).toContain('Known labels: home, errands')
    expect(p).toContain('Current datetime: 2026-07-15T21:00:00Z (America/New_York)')
    // due stays as the spoken phrase — the LLM must not resolve dates itself
    expect(p).toContain('EXACTLY as spoken')
  })

  it("renders 'none' when there are no known labels", () => {
    expect(buildExtractionSystemPrompt({ ...ctx, knownLabels: [] })).toContain('Known labels: none')
  })
})

describe('createOpenAiCompatibleExtractor', () => {
  it("exposes id 'openai-compatible'", () => {
    expect(createOpenAiCompatibleExtractor(cfg).id).toBe('openai-compatible')
  })

  it('sends the frozen request: default URL/model, temperature 0, strict json_schema, 2 messages', async () => {
    const fn = makeFetch([jsonResponse(completion(JSON.stringify({ tasks: [] })))])
    const ext = createOpenAiCompatibleExtractor(cfg, fn as unknown as FetchLike)

    await ext.extract('buy milk', ctx)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(callAt(fn, 0).url).toBe('https://api.openai.com/v1/chat/completions')
    expect(callAt(fn, 0).init.method).toBe('POST')
    expect(headersOf(fn, 0)).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer sk-test',
    })
    const body = bodyOf(fn, 0)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.temperature).toBe(0)
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'extracted_tasks', strict: true, schema: EXTRACTED_TASKS_JSON_SCHEMA },
    })
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]?.role).toBe('system')
    expect(body.messages[0]?.content).toContain('Known labels: home, errands')
    expect(body.messages[1]).toEqual({ role: 'user', content: 'buy milk' })
  })

  it('strips a trailing slash from baseUrl, honors a custom model, and omits auth when no key', async () => {
    const fn = makeFetch([jsonResponse(completion(JSON.stringify({ tasks: [] })))])
    const ext = createOpenAiCompatibleExtractor(
      {
        provider: 'openai-compatible',
        baseUrl: 'http://ollama:11434/v1/',
        model: 'llama3.1:8b',
        apiKey: null,
      },
      fn as unknown as FetchLike,
    )

    await ext.extract('note', ctx)

    expect(callAt(fn, 0).url).toBe('http://ollama:11434/v1/chat/completions')
    expect(bodyOf(fn, 0).model).toBe('llama3.1:8b')
    expect(headersOf(fn, 0).authorization).toBeUndefined()
  })

  it('omits auth for an empty-string api key too (never a malformed empty Bearer)', async () => {
    // Pins the truthy `if (cfg.apiKey)` gate: '' (set-but-empty env var) means "no key".
    const fn = makeFetch([jsonResponse(completion(JSON.stringify({ tasks: [] })))])
    const ext = createOpenAiCompatibleExtractor({ ...cfg, apiKey: '' }, fn as unknown as FetchLike)

    await ext.extract('note', ctx)

    expect(headersOf(fn, 0).authorization).toBeUndefined()
  })

  it('parses a valid completion into structured tasks', async () => {
    const tasks = [
      { title: 'Buy milk', notes: null, due: 'tomorrow', priority: 1, labels: ['errands'] },
      { title: 'Email Sam', notes: 'quarterly report', due: 'friday', priority: null, labels: [] },
    ]
    const fn = makeFetch([jsonResponse(completion(JSON.stringify({ tasks })))])
    const ext = createOpenAiCompatibleExtractor(cfg, fn as unknown as FetchLike)

    const result = await ext.extract('buy milk tomorrow and email sam on friday', ctx)

    expect(result.tasks).toEqual(tasks)
  })

  it('accepts an empty tasks array as valid (nothing actionable was said)', async () => {
    const fn = makeFetch([jsonResponse(completion(JSON.stringify({ tasks: [] })))])
    const ext = createOpenAiCompatibleExtractor(cfg, fn as unknown as FetchLike)

    const result = await ext.extract('um, hello', ctx)

    expect(result.tasks).toEqual([])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('strips a ```json fence wrapper before parsing', async () => {
    const payload = {
      tasks: [{ title: 'Call bank', notes: null, due: null, priority: null, labels: [] }],
    }
    const fenced = `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
    const fn = makeFetch([jsonResponse(completion(fenced))])
    const ext = createOpenAiCompatibleExtractor(cfg, fn as unknown as FetchLike)

    const result = await ext.extract('call the bank', ctx)

    expect(result.tasks[0]?.title).toBe('Call bank')
  })

  it('strips a bare ``` fence wrapper before parsing', async () => {
    const fenced = '```\n{"tasks":[]}\n```'
    const fn = makeFetch([jsonResponse(completion(fenced))])
    const ext = createOpenAiCompatibleExtractor(cfg, fn as unknown as FetchLike)

    const result = await ext.extract('hello', ctx)

    expect(result.tasks).toEqual([])
  })

  it('retries once on invalid JSON then succeeds, sending 4 messages with a corrective prompt', async () => {
    const good = {
      tasks: [{ title: 'Call bank', notes: null, due: null, priority: null, labels: [] }],
    }
    const fn = makeFetch([
      jsonResponse(completion('not json at all')),
      jsonResponse(completion(JSON.stringify(good))),
    ])
    const ext = createOpenAiCompatibleExtractor(cfg, fn as unknown as FetchLike)

    const result = await ext.extract('call the bank', ctx)

    expect(result.tasks[0]?.title).toBe('Call bank')
    expect(fn).toHaveBeenCalledTimes(2)
    const second = bodyOf(fn, 1)
    expect(second.messages).toHaveLength(4)
    expect(second.messages[2]).toEqual({ role: 'assistant', content: 'not json at all' })
    expect(second.messages[3]?.role).toBe('user')
    expect(second.messages[3]?.content).toContain('failed validation')
    expect(second.messages[3]?.content).toContain(
      'Respond again with ONLY valid JSON matching the schema',
    )
  })

  it('retries when the first response violates the zod schema (priority out of range)', async () => {
    const bad = { tasks: [{ title: 'x', notes: null, due: null, priority: 7, labels: [] }] }
    const good = { tasks: [{ title: 'x', notes: null, due: null, priority: 4, labels: [] }] }
    const fn = makeFetch([
      jsonResponse(completion(JSON.stringify(bad))),
      jsonResponse(completion(JSON.stringify(good))),
    ])
    const ext = createOpenAiCompatibleExtractor(cfg, fn as unknown as FetchLike)

    const result = await ext.extract('do x', ctx)

    expect(result.tasks[0]?.priority).toBe(4)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws ProviderError after two invalid responses, with exactly 2 fetch calls', async () => {
    const fn = makeFetch([
      jsonResponse(completion('garbage')),
      jsonResponse(completion('still garbage')),
    ])
    const ext = createOpenAiCompatibleExtractor(cfg, fn as unknown as FetchLike)

    const err = await ext.extract('anything', ctx).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).message).toMatch(/llm extraction: invalid response after retry/)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws ProviderError immediately on a non-2xx response (no retry, exactly 1 call)', async () => {
    const fn = makeFetch([jsonResponse({ error: 'server boom' }, 500)])
    const ext = createOpenAiCompatibleExtractor(cfg, fn as unknown as FetchLike)

    const err = await ext.extract('anything', ctx).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).status).toBe(500)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
