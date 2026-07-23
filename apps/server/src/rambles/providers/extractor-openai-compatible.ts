// Task E: openai-compatible LLM task extractor (OpenAI / Ollama / Groq / LocalAI via baseUrl+model).
import { EXTRACTED_TASKS_JSON_SCHEMA, type ExtractedTask, ExtractedTasksSchema } from '../schemas'
import {
  type ExtractorContext,
  type FetchLike,
  ProviderError,
  type ResolvedLlmConfig,
  type TaskExtractor,
} from './types'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'
const ERROR_SNIPPET_LEN = 500

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

/**
 * FROZEN extraction system prompt (plan Task E). `due` is kept as the spoken phrase — the server
 * resolves it with core parseQuickAdd/resolveNaturalDate at confirm time, so the LLM never invents
 * ISO dates. Priority is 1 (most urgent) … 4, matching OpenTask storage.
 */
export function buildExtractionSystemPrompt(ctx: ExtractorContext): string {
  const labels = ctx.knownLabels.length > 0 ? ctx.knownLabels.join(', ') : 'none'
  return `You split a voice-note transcript into discrete actionable tasks.
Rules:
- Imperative, concise titles.
- Never invent tasks that are not in the transcript.
- notes: extra context for that task from the transcript, else null.
- due: the date/time phrase EXACTLY as spoken (e.g. "tomorrow 5pm", "every friday"); null if none. Never convert to ISO dates or resolve relative dates yourself.
- priority: 1 (most urgent) to 4, only when the speaker signals urgency; else null.
- labels: choose only from the known labels list; else empty array.
- Respond with ONLY a JSON object matching the schema: {"tasks":[{"title","notes","due","priority","labels"}]}.
Known labels: ${labels}
Current datetime: ${ctx.now} (${ctx.timezone})`
}

/** Strip a single ```json … ``` (or bare ``` … ```) fence when a model wraps its JSON output. */
function stripFence(raw: string): string {
  let s = raw.trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
  }
  return s.trim()
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Throws SyntaxError (bad JSON) or ZodError (schema mismatch); both drive the single retry. */
function parseContent(raw: string): { tasks: ExtractedTask[] } {
  const parsed: unknown = JSON.parse(stripFence(raw))
  return ExtractedTasksSchema.parse(parsed)
}

export function createOpenAiCompatibleExtractor(
  cfg: ResolvedLlmConfig,
  fetchImpl: FetchLike = fetch,
): TaskExtractor {
  const base = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const model = cfg.model ?? DEFAULT_MODEL

  async function requestContent(messages: ChatMessage[]): Promise<string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'extracted_tasks',
            strict: true,
            schema: EXTRACTED_TASKS_JSON_SCHEMA,
          },
        },
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(
        `openai-compatible LLM ${res.status}: ${body.slice(0, 300)}`,
        res.status,
      )
    }
    const data = (await res.json()) as ChatCompletionResponse
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new ProviderError('openai-compatible LLM: response missing content')
    }
    return content
  }

  return {
    id: 'openai-compatible',
    async extract(transcript: string, ctx: ExtractorContext) {
      const messages: ChatMessage[] = [
        { role: 'system', content: buildExtractionSystemPrompt(ctx) },
        { role: 'user', content: transcript },
      ]
      // Non-2xx propagates immediately (no retry); parse/validation failures get exactly one retry.
      const first = await requestContent(messages)
      try {
        return parseContent(first)
      } catch (firstErr) {
        const retryMessages: ChatMessage[] = [
          ...messages,
          { role: 'assistant', content: first },
          {
            role: 'user',
            content: `Your previous response failed validation: ${errText(firstErr).slice(0, ERROR_SNIPPET_LEN)}. Respond again with ONLY valid JSON matching the schema.`,
          },
        ]
        const second = await requestContent(retryMessages)
        try {
          return parseContent(second)
        } catch (secondErr) {
          throw new ProviderError(
            `llm extraction: invalid response after retry: ${errText(secondErr).slice(0, ERROR_SNIPPET_LEN)}`,
          )
        }
      }
    },
  }
}
