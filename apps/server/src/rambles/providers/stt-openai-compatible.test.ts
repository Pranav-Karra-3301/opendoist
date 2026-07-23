import { describe, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleStt } from './stt-openai-compatible'
import type { ResolvedSttConfig, SttAudio } from './types'
import { ProviderError } from './types'

const AUDIO: SttAudio = {
  data: Buffer.from('fake-webm-bytes'),
  mimeType: 'audio/webm',
  filename: 'ramble.webm',
}

const BASE_CFG: ResolvedSttConfig = {
  provider: 'openai-compatible',
  baseUrl: null,
  model: null,
  apiKey: null,
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockFetch(res: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>()
  fetch.mockResolvedValue(res)
  return fetch
}

/** Await a promise expected to reject and return the thrown value (typed `unknown`). */
async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('expected promise to reject but it resolved')
}

describe('createOpenAiCompatibleStt', () => {
  it('reports the frozen provider id', () => {
    expect(createOpenAiCompatibleStt(BASE_CFG).id).toBe('openai-compatible')
  })

  it('POSTs to the default OpenAI URL with the default model', async () => {
    const fetch = mockFetch(jsonRes({ text: 'hi' }))
    await createOpenAiCompatibleStt(BASE_CFG, fetch).transcribe(AUDIO)

    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init?.method).toBe('POST')
    const body = init?.body as FormData
    expect(body.get('model')).toBe('gpt-4o-mini-transcribe')
  })

  it('strips a trailing slash from a custom baseUrl (Speaches sidecar)', async () => {
    const fetch = mockFetch(jsonRes({ text: 'hi' }))
    await createOpenAiCompatibleStt(
      { ...BASE_CFG, baseUrl: 'http://speaches:8000/v1/', model: 'Systran/faster-whisper-small' },
      fetch,
    ).transcribe(AUDIO)

    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://speaches:8000/v1/audio/transcriptions')
    const body = init?.body as FormData
    expect(body.get('model')).toBe('Systran/faster-whisper-small')
  })

  it('honors a custom baseUrl without a trailing slash', async () => {
    const fetch = mockFetch(jsonRes({ text: 'hi' }))
    await createOpenAiCompatibleStt(
      { ...BASE_CFG, baseUrl: 'https://api.groq.com/openai/v1' },
      fetch,
    ).transcribe(AUDIO)

    const [url] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
  })

  it('builds the multipart body with file, model and response_format entries', async () => {
    const fetch = mockFetch(jsonRes({ text: 'hi' }))
    await createOpenAiCompatibleStt(BASE_CFG, fetch).transcribe(AUDIO)

    const init = fetch.mock.calls[0]?.[1]
    const body = init?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(body.get('response_format')).toBe('json')

    const file = body.get('file')
    expect(file).toBeInstanceOf(File)
    expect((file as File).name).toBe('ramble.webm')
    expect((file as File).type).toBe('audio/webm')

    // fetch must set the multipart boundary itself — never set content-type by hand.
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['content-type']).toBeUndefined()
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('omits the Authorization header when no api key is configured', async () => {
    const fetch = mockFetch(jsonRes({ text: 'hi' }))
    await createOpenAiCompatibleStt(BASE_CFG, fetch).transcribe(AUDIO)

    const headers = (fetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('omits the Authorization header for an empty-string api key (set-but-empty env var)', async () => {
    // Regression: `apiKey: ''` used to pass the old `!== null` gate and send `Bearer ` (malformed).
    const fetch = mockFetch(jsonRes({ text: 'hi' }))
    await createOpenAiCompatibleStt({ ...BASE_CFG, apiKey: '' }, fetch).transcribe(AUDIO)

    const headers = (fetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('sends a Bearer Authorization header when an api key is set', async () => {
    const fetch = mockFetch(jsonRes({ text: 'hi' }))
    await createOpenAiCompatibleStt({ ...BASE_CFG, apiKey: 'sk-test-123' }, fetch).transcribe(AUDIO)

    const headers = (fetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test-123')
  })

  it('passes language and prompt through only when provided', async () => {
    const fetch = mockFetch(jsonRes({ text: 'hi' }))
    await createOpenAiCompatibleStt(BASE_CFG, fetch).transcribe(AUDIO, {
      language: 'pt',
      prompt: 'OpenTask, ramble',
    })

    const body = fetch.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('language')).toBe('pt')
    expect(body.get('prompt')).toBe('OpenTask, ramble')
  })

  it('omits language and prompt entries when opts are absent', async () => {
    const fetch = mockFetch(jsonRes({ text: 'hi' }))
    await createOpenAiCompatibleStt(BASE_CFG, fetch).transcribe(AUDIO)

    const body = fetch.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('language')).toBeNull()
    expect(body.get('prompt')).toBeNull()
  })

  it('returns the trimmed transcript on success', async () => {
    const fetch = mockFetch(jsonRes({ text: '  buy milk tomorrow  ' }))
    const result = await createOpenAiCompatibleStt(BASE_CFG, fetch).transcribe(AUDIO)
    expect(result).toEqual({ text: 'buy milk tomorrow' })
  })

  it('throws a ProviderError carrying the status and body snippet on non-2xx', async () => {
    const fetch = mockFetch(new Response('Unauthorized: invalid api key', { status: 401 }))
    const stt = createOpenAiCompatibleStt({ ...BASE_CFG, apiKey: 'bad' }, fetch)

    const err = await captureError(stt.transcribe(AUDIO))
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).status).toBe(401)
    expect((err as ProviderError).message).toContain('openai-compatible STT 401')
    expect((err as ProviderError).message).toContain('Unauthorized: invalid api key')
  })

  it('truncates the error body snippet to 300 characters', async () => {
    const fetch = mockFetch(new Response('x'.repeat(1000), { status: 500 }))
    const err = await captureError(createOpenAiCompatibleStt(BASE_CFG, fetch).transcribe(AUDIO))
    expect(err).toBeInstanceOf(ProviderError)
    // 'openai-compatible STT 500: ' prefix + 300 body chars
    expect((err as ProviderError).message).toBe(`openai-compatible STT 500: ${'x'.repeat(300)}`)
  })

  it('throws a ProviderError when the response has no text field', async () => {
    const fetch = mockFetch(jsonRes({ language: 'en' }))
    const err = await captureError(createOpenAiCompatibleStt(BASE_CFG, fetch).transcribe(AUDIO))
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).message).toBe('openai-compatible STT: response missing text')
    expect((err as ProviderError).status).toBeUndefined()
  })

  it('throws a ProviderError when text is not a string', async () => {
    const fetch = mockFetch(jsonRes({ text: 42 }))
    const err = await captureError(createOpenAiCompatibleStt(BASE_CFG, fetch).transcribe(AUDIO))
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).message).toBe('openai-compatible STT: response missing text')
  })
})
