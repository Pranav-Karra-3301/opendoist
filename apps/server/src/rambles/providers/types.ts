/**
 * Phase 7 FROZEN provider interfaces (plan Task A Step 3). STT and extraction are two
 * independent provider slots; adapters take an injectable `fetchImpl` so every network
 * call is unit-tested against request-shape mocks (never real APIs).
 */
import type { ExtractedTask } from '../schemas'

export interface SttAudio {
  data: Buffer
  mimeType: string
  filename: string
}
export interface SttOptions {
  language?: string
  prompt?: string
}
export interface SttResult {
  text: string
  language?: string
  durationSec?: number
}

export interface SttProvider {
  readonly id: 'openai-compatible' | 'deepgram' | 'elevenlabs'
  transcribe(audio: SttAudio, opts?: SttOptions): Promise<SttResult>
}

export interface ExtractorContext {
  now: string
  timezone: string
  knownLabels: string[]
}
export interface TaskExtractor {
  readonly id: 'none' | 'openai-compatible'
  extract(transcript: string, ctx: ExtractorContext): Promise<{ tasks: ExtractedTask[] }>
}

/** Thrown by adapters on non-2xx or malformed responses; message is safe to store in rambles.error. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export type FetchLike = typeof fetch

export interface ResolvedSttConfig {
  provider: 'openai-compatible' | 'deepgram' | 'elevenlabs'
  baseUrl: string | null
  model: string | null
  apiKey: string | null
}
export interface ResolvedLlmConfig {
  provider: 'openai-compatible'
  baseUrl: string | null
  model: string | null
  apiKey: string | null
}
