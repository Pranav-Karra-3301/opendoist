// Task C (phase 7): Deepgram STT adapter — raw-audio POST to /v1/listen (dossier §5.7).
import {
  type FetchLike,
  ProviderError,
  type ResolvedSttConfig,
  type SttAudio,
  type SttOptions,
  type SttProvider,
  type SttResult,
} from './types'

/** Subset of the Deepgram pre-recorded response we read; narrowed at runtime, never trusted. */
interface DeepgramResponse {
  metadata?: { duration?: number }
  results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
}

const DEFAULT_BASE_URL = 'https://api.deepgram.com'
const DEFAULT_MODEL = 'nova-3'

export function createDeepgramStt(
  cfg: ResolvedSttConfig,
  fetchImpl: FetchLike = fetch,
): SttProvider {
  return {
    id: 'deepgram',
    async transcribe(audio: SttAudio, opts?: SttOptions): Promise<SttResult> {
      // Deepgram always requires a key — fail loud before touching the network.
      if (!cfg.apiKey) throw new ProviderError('deepgram: API key required')

      const base = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
      const params = new URLSearchParams({
        model: cfg.model ?? DEFAULT_MODEL,
        smart_format: 'true',
      })
      if (opts?.language) params.set('language', opts.language)

      const res = await fetchImpl(`${base}/v1/listen?${params.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Token ${cfg.apiKey}`, 'Content-Type': audio.mimeType },
        body: audio.data,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new ProviderError(`deepgram STT ${res.status}: ${body.slice(0, 300)}`, res.status)
      }

      const data = (await res.json()) as DeepgramResponse
      const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript
      if (typeof transcript !== 'string') {
        throw new ProviderError('deepgram: response missing transcript')
      }

      const result: SttResult = { text: transcript.trim() }
      if (typeof data.metadata?.duration === 'number') result.durationSec = data.metadata.duration
      return result
    },
  }
}
