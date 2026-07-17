/** Phase 7 FROZEN provider registry (plan Task A Step 4). */
import { createNoneExtractor } from './extractor-none'
import { createOpenAiCompatibleExtractor } from './extractor-openai-compatible'
import { createDeepgramStt } from './stt-deepgram'
import { createElevenLabsStt } from './stt-elevenlabs'
import { createOpenAiCompatibleStt } from './stt-openai-compatible'
import type {
  FetchLike,
  ResolvedLlmConfig,
  ResolvedSttConfig,
  SttProvider,
  TaskExtractor,
} from './types'

export function createSttProvider(
  cfg: ResolvedSttConfig,
  fetchImpl: FetchLike = fetch,
): SttProvider {
  switch (cfg.provider) {
    case 'openai-compatible':
      return createOpenAiCompatibleStt(cfg, fetchImpl)
    case 'deepgram':
      return createDeepgramStt(cfg, fetchImpl)
    case 'elevenlabs':
      return createElevenLabsStt(cfg, fetchImpl)
  }
}

/** null LLM config → 'none' passthrough extractor (whole transcript becomes one task). */
export function createExtractor(
  cfg: ResolvedLlmConfig | null,
  fetchImpl: FetchLike = fetch,
): TaskExtractor {
  return cfg === null ? createNoneExtractor() : createOpenAiCompatibleExtractor(cfg, fetchImpl)
}
