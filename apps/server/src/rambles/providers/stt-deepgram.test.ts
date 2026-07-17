import { describe, expect, it, vi } from 'vitest'
import { createDeepgramStt } from './stt-deepgram'
import { ProviderError, type ResolvedSttConfig, type SttAudio } from './types'

const AUDIO: SttAudio = {
  data: Buffer.from('fake-opus-bytes'),
  mimeType: 'audio/webm',
  filename: 'ramble.webm',
}

/** Canonical nova-3 pre-recorded response (dossier §5.7). */
const NOVA3_RESPONSE = {
  metadata: { duration: 2.5 },
  results: { channels: [{ alternatives: [{ transcript: 'buy milk tomorrow' }] }] },
}

function cfg(overrides: Partial<ResolvedSttConfig> = {}): ResolvedSttConfig {
  return { provider: 'deepgram', baseUrl: null, model: null, apiKey: 'dg_secret', ...overrides }
}

/** Mock fetch returning a FRESH Response per call (Response bodies are single-use). */
function mockFetch(make: () => Response) {
  return vi.fn((_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(make()))
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** First (url, init) pair, asserting exactly one call happened. */
function firstCall(mock: ReturnType<typeof mockFetch>): { url: string; init: RequestInit } {
  const call = mock.mock.calls[0]
  if (!call) throw new Error('fetch was not called')
  return { url: String(call[0]), init: call[1] ?? {} }
}

describe('createDeepgramStt', () => {
  it('exposes the deepgram provider id', () => {
    expect(createDeepgramStt(cfg()).id).toBe('deepgram')
  })

  it('POSTs raw audio bytes to the default listen URL (nova-3 + smart_format)', async () => {
    const fetchMock = mockFetch(() => jsonResponse(NOVA3_RESPONSE))
    const provider = createDeepgramStt(cfg(), fetchMock as unknown as typeof fetch)

    await provider.transcribe(AUDIO)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init } = firstCall(fetchMock)
    expect(url).toBe('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true')
    expect(init.method).toBe('POST')
    // raw Buffer, NOT FormData — the exact bytes we were handed
    expect(init.body).toBe(AUDIO.data)
  })

  it('sends Token auth and the audio mime as Content-Type', async () => {
    const fetchMock = mockFetch(() => jsonResponse(NOVA3_RESPONSE))
    const provider = createDeepgramStt(
      cfg({ apiKey: 'dg_live_123' }),
      fetchMock as unknown as typeof fetch,
    )

    await provider.transcribe(AUDIO)

    expect(firstCall(fetchMock).init.headers).toEqual({
      Authorization: 'Token dg_live_123',
      'Content-Type': 'audio/webm',
    })
  })

  it('uses a custom model in the query string', async () => {
    const fetchMock = mockFetch(() => jsonResponse(NOVA3_RESPONSE))
    const provider = createDeepgramStt(
      cfg({ model: 'nova-2' }),
      fetchMock as unknown as typeof fetch,
    )

    await provider.transcribe(AUDIO)

    expect(firstCall(fetchMock).url).toBe(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
    )
  })

  it('honors a custom baseUrl and strips a trailing slash', async () => {
    const fetchMock = mockFetch(() => jsonResponse(NOVA3_RESPONSE))
    const provider = createDeepgramStt(
      cfg({ baseUrl: 'https://eu.deepgram.example/' }),
      fetchMock as unknown as typeof fetch,
    )

    await provider.transcribe(AUDIO)

    expect(firstCall(fetchMock).url).toBe(
      'https://eu.deepgram.example/v1/listen?model=nova-3&smart_format=true',
    )
  })

  it('appends a URL-encoded language when provided', async () => {
    const fetchMock = mockFetch(() => jsonResponse(NOVA3_RESPONSE))
    const provider = createDeepgramStt(cfg(), fetchMock as unknown as typeof fetch)

    await provider.transcribe(AUDIO, { language: 'pt-BR' })

    expect(firstCall(fetchMock).url).toBe(
      'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=pt-BR',
    )
  })

  it('parses transcript and duration from the nova-3 response shape', async () => {
    const fetchMock = mockFetch(() => jsonResponse(NOVA3_RESPONSE))
    const provider = createDeepgramStt(cfg(), fetchMock as unknown as typeof fetch)

    const result = await provider.transcribe(AUDIO)

    expect(result).toEqual({ text: 'buy milk tomorrow', durationSec: 2.5 })
  })

  it('throws ProviderError when the transcript path is missing', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ metadata: {}, results: { channels: [] } }))
    const provider = createDeepgramStt(cfg(), fetchMock as unknown as typeof fetch)

    const err = await provider.transcribe(AUDIO).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).message).toBe('deepgram: response missing transcript')
  })

  it('throws ProviderError without calling fetch when the API key is missing', async () => {
    const fetchMock = mockFetch(() => jsonResponse(NOVA3_RESPONSE))
    const provider = createDeepgramStt(cfg({ apiKey: null }), fetchMock as unknown as typeof fetch)

    const err = await provider.transcribe(AUDIO).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).message).toBe('deepgram: API key required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a non-2xx response to a ProviderError carrying the status (402)', async () => {
    const fetchMock = mockFetch(() => new Response('Payment Required', { status: 402 }))
    const provider = createDeepgramStt(cfg(), fetchMock as unknown as typeof fetch)

    const err = await provider.transcribe(AUDIO).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).status).toBe(402)
  })
})
