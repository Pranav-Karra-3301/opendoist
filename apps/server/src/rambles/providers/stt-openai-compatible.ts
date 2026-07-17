// Task B (phase 7): openai-compatible STT adapter. One implementation covers OpenAI
// (gpt-4o-mini-transcribe), Speaches, whisper.cpp server, Groq and LocalAI — they differ
// only by baseUrl/model. Every network call goes through the injected `fetchImpl` so the
// request shape is unit-tested against mocks and never a real API.

import type {
  FetchLike,
  ResolvedSttConfig,
  SttAudio,
  SttOptions,
  SttProvider,
  SttResult,
} from './types'
import { ProviderError } from './types'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini-transcribe'

export function createOpenAiCompatibleStt(
  cfg: ResolvedSttConfig,
  fetchImpl: FetchLike = fetch,
): SttProvider {
  return {
    id: 'openai-compatible',
    async transcribe(audio: SttAudio, opts?: SttOptions): Promise<SttResult> {
      const baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
      const url = `${baseUrl}/audio/transcriptions`

      const form = new FormData()
      form.append('file', new File([audio.data], audio.filename, { type: audio.mimeType }))
      form.append('model', cfg.model ?? DEFAULT_MODEL)
      form.append('response_format', 'json')
      if (opts?.language) form.append('language', opts.language)
      if (opts?.prompt) form.append('prompt', opts.prompt)

      // No content-type header: fetch derives the multipart boundary from the FormData body.
      // Truthy check: null AND '' both mean "no key" (Speaches/whisper.cpp need none) — never
      // send a malformed empty `Authorization: Bearer ` header.
      const headers: Record<string, string> = {}
      if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

      const res = await fetchImpl(url, { method: 'POST', body: form, headers })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new ProviderError(
          `openai-compatible STT ${res.status}: ${body.slice(0, 300)}`,
          res.status,
        )
      }

      const data = (await res.json().catch(() => null)) as { text?: unknown } | null
      if (!data || typeof data.text !== 'string') {
        throw new ProviderError('openai-compatible STT: response missing text')
      }
      return { text: data.text.trim() }
    },
  }
}
