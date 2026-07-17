// Task E: `none` passthrough extractor — no LLM, whole transcript becomes one task.
import type { TaskExtractor } from './types'

const MAX_TITLE_LEN = 80

/** Title = transcript trimmed to a word boundary ≤80 chars (… when truncated); 'Voice note' if empty. */
function toTitle(transcript: string): string {
  const trimmed = transcript.trim()
  if (trimmed === '') return 'Voice note'
  if (trimmed.length <= MAX_TITLE_LEN) return trimmed
  const slice = trimmed.slice(0, MAX_TITLE_LEN)
  const lastSpace = slice.lastIndexOf(' ')
  const head = lastSpace > 0 ? slice.slice(0, lastSpace) : slice
  return `${head}…`
}

/**
 * Passthrough extractor used when no LLM is configured: emit a single draft task whose title is a
 * short summary of the transcript and whose notes hold the full transcript. Never throws.
 */
export function createNoneExtractor(): TaskExtractor {
  return {
    id: 'none',
    async extract(transcript: string) {
      return {
        tasks: [
          { title: toTitle(transcript), notes: transcript, due: null, priority: null, labels: [] },
        ],
      }
    },
  }
}
