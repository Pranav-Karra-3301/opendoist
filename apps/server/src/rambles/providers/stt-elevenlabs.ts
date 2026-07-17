// Task D: ElevenLabs speech-to-text adapter (dossier §5.7).
// POST /v1/speech-to-text, header `xi-api-key`, multipart `file` + `model_id`.
// One network call, injectable `fetchImpl` so it is unit-tested against request-shape mocks.
import {
  type FetchLike,
  ProviderError,
  type ResolvedSttConfig,
  type SttAudio,
  type SttOptions,
  type SttProvider,
  type SttResult,
} from './types'

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io'
const DEFAULT_MODEL = 'scribe_v1'

export function createElevenLabsStt(
  cfg: ResolvedSttConfig,
  fetchImpl: FetchLike = fetch,
): SttProvider {
  return {
    id: 'elevenlabs',
    async transcribe(audio: SttAudio, opts?: SttOptions): Promise<SttResult> {
      // ElevenLabs requires a key — short-circuit before any network call. Falsy check (matching
      // deepgram): '' is "no key" too, so we never send an empty `xi-api-key` header.
      if (!cfg.apiKey) throw new ProviderError('elevenlabs: API key required')

      const url = `${cfg.baseUrl ?? DEFAULT_BASE_URL}/v1/speech-to-text`
      const form = new FormData()
      form.append('file', new File([audio.data], audio.filename, { type: audio.mimeType }))
      form.append('model_id', cfg.model ?? DEFAULT_MODEL)
      if (opts?.language) form.append('language_code', opts.language)

      // No content-type header: fetch derives the multipart boundary from the FormData body.
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'xi-api-key': cfg.apiKey },
        body: form,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new ProviderError(`elevenlabs STT ${res.status}: ${body.slice(0, 300)}`, res.status)
      }

      const data = (await res.json()) as { text?: unknown; language_code?: unknown }
      if (typeof data.text !== 'string')
        throw new ProviderError('elevenlabs: response missing text')
      return {
        text: data.text.trim(),
        language: typeof data.language_code === 'string' ? data.language_code : undefined,
      }
    },
  }
}
