import { describe, expect, it, vi } from 'vitest'
import { createElevenLabsStt } from './stt-elevenlabs'
import { type FetchLike, ProviderError, type ResolvedSttConfig, type SttAudio } from './types'

const audio: SttAudio = {
  data: Buffer.from('fake-webm-bytes'),
  mimeType: 'audio/webm',
  filename: 'ramble.webm',
}

/** ResolvedSttConfig with elevenlabs defaults; override per test. */
function cfgWith(over: Partial<ResolvedSttConfig> = {}): ResolvedSttConfig {
  return { provider: 'elevenlabs', baseUrl: null, model: null, apiKey: 'xi_key', ...over }
}

/** Minimal fake Response exposing only the fields the adapter reads. */
function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}
function textResponse(body: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response
}

function mockFetch(response: Response) {
  return vi.fn((_url: unknown, _init?: RequestInit) => Promise.resolve(response))
}

/** Read the (url, init) of the first fetch call, asserting exactly one happened. */
function firstCall(mock: ReturnType<typeof mockFetch>): {
  url: unknown
  init: RequestInit | undefined
} {
  const call = mock.mock.calls[0]
  if (!call) throw new Error('fetchImpl was not called')
  return { url: call[0], init: call[1] }
}

/** Narrow a fetch init body to FormData for entry assertions. */
function formOf(init: RequestInit | undefined): FormData {
  expect(init?.body).toBeInstanceOf(FormData)
  return init?.body as FormData
}

describe('createElevenLabsStt', () => {
  it('reports its provider id', () => {
    expect(createElevenLabsStt(cfgWith()).id).toBe('elevenlabs')
  })

  it('POSTs multipart to the default endpoint with the default model and file part', async () => {
    const fetchMock = mockFetch(jsonResponse({ text: 'buy milk tomorrow' }))
    const stt = createElevenLabsStt(cfgWith(), fetchMock as unknown as FetchLike)

    await stt.transcribe(audio)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init } = firstCall(fetchMock)
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text')
    expect(init?.method).toBe('POST')

    const form = formOf(init)
    expect(form.get('model_id')).toBe('scribe_v1')
    const file = form.get('file')
    expect(file).toBeInstanceOf(File)
    expect((file as File).name).toBe('ramble.webm')
    expect((file as File).type).toBe('audio/webm')
    // opts.language not supplied → no language_code entry
    expect(form.get('language_code')).toBeNull()
  })

  it('sends only the xi-api-key header (no manual content-type)', async () => {
    const fetchMock = mockFetch(jsonResponse({ text: 'hi' }))
    const stt = createElevenLabsStt(
      cfgWith({ apiKey: 'xi_secret' }),
      fetchMock as unknown as FetchLike,
    )

    await stt.transcribe(audio)

    const { init } = firstCall(fetchMock)
    expect(init?.headers).toEqual({ 'xi-api-key': 'xi_secret' })
  })

  it('honors a custom baseUrl and model', async () => {
    const fetchMock = mockFetch(jsonResponse({ text: 'hi' }))
    const stt = createElevenLabsStt(
      cfgWith({ baseUrl: 'https://eu.residency.elevenlabs.io', model: 'scribe_v2' }),
      fetchMock as unknown as FetchLike,
    )

    await stt.transcribe(audio)

    const { url, init } = firstCall(fetchMock)
    expect(url).toBe('https://eu.residency.elevenlabs.io/v1/speech-to-text')
    expect(formOf(init).get('model_id')).toBe('scribe_v2')
  })

  it('passes opts.language through as language_code', async () => {
    const fetchMock = mockFetch(jsonResponse({ text: 'comprar leite' }))
    const stt = createElevenLabsStt(cfgWith(), fetchMock as unknown as FetchLike)

    await stt.transcribe(audio, { language: 'pt-BR' })

    expect(formOf(firstCall(fetchMock).init).get('language_code')).toBe('pt-BR')
  })

  it('returns the transcript and language_code on success', async () => {
    const fetchMock = mockFetch(jsonResponse({ text: 'buy milk tomorrow', language_code: 'en' }))
    const stt = createElevenLabsStt(cfgWith(), fetchMock as unknown as FetchLike)

    const result = await stt.transcribe(audio)

    expect(result).toEqual({ text: 'buy milk tomorrow', language: 'en' })
  })

  it('trims surrounding whitespace from the transcript', async () => {
    const fetchMock = mockFetch(jsonResponse({ text: '  buy milk  ' }))
    const stt = createElevenLabsStt(cfgWith(), fetchMock as unknown as FetchLike)

    const result = await stt.transcribe(audio)

    expect(result.text).toBe('buy milk')
    expect(result.language).toBeUndefined()
  })

  it('throws ProviderError when the response has no text field', async () => {
    const fetchMock = mockFetch(jsonResponse({ language_code: 'en' }))
    const stt = createElevenLabsStt(cfgWith(), fetchMock as unknown as FetchLike)

    const err = await stt.transcribe(audio).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).message).toBe('elevenlabs: response missing text')
  })

  it('throws ProviderError carrying the HTTP status and body snippet on a 401', async () => {
    const fetchMock = mockFetch(textResponse('{"detail":"invalid_api_key"}', 401))
    const stt = createElevenLabsStt(
      cfgWith({ apiKey: 'xi_bad' }),
      fetchMock as unknown as FetchLike,
    )

    const err = await stt.transcribe(audio).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).status).toBe(401)
    expect((err as ProviderError).message).toContain('invalid_api_key')
  })

  it('rejects without any network call when the API key is null', async () => {
    const fetchMock = mockFetch(jsonResponse({ text: 'should not happen' }))
    const stt = createElevenLabsStt(cfgWith({ apiKey: null }), fetchMock as unknown as FetchLike)

    const err = await stt.transcribe(audio).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).message).toBe('elevenlabs: API key required')
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('rejects an empty-string API key the same way (never sends an empty xi-api-key header)', async () => {
    // Regression: '' used to slip past the old `=== null` gate and go out as `xi-api-key: ""`.
    const fetchMock = mockFetch(jsonResponse({ text: 'should not happen' }))
    const stt = createElevenLabsStt(cfgWith({ apiKey: '' }), fetchMock as unknown as FetchLike)

    const err = await stt.transcribe(audio).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).message).toBe('elevenlabs: API key required')
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })
})
