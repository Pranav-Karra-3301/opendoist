/**
 * Server FTS search for the ⌘K palette (phase 5 Task I). Wraps `searchServer` from the frozen
 * phase-5 client (`GET /api/v1/search`) in a debounced, self-gating TanStack query: it fires
 * only once the trimmed term reaches 2 characters, 200 ms after the last keystroke, and keeps
 * the previous page's results on screen while the next term loads (no flicker between strokes).
 *
 * `parseSnippet` turns the server's `<b>…</b>`-marked FTS snippet into ordered plain-text
 * segments the palette renders as React text — never via dangerouslySetInnerHTML — so a hit's
 * matched substring can be emphasised safely. It is a pure function, unit-tested beside this hook.
 */
import { keepPreviousData, type UseQueryResult, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { searchServer } from '@/lib/api/phase5'

/** Parsed page returned by `searchServer` (core `SearchPageSchema`). */
export type SearchPage = Awaited<ReturnType<typeof searchServer>>

const DEBOUNCE_MS = 200
const MIN_QUERY_LENGTH = 2

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export interface ServerSearch {
  /** The debounced, trimmed term actually queried (`''` while below the 2-char threshold). */
  term: string
  /** The underlying TanStack query — key `['search', term]`, staleTime 10 s, keep-previous. */
  query: UseQueryResult<SearchPage>
}

/**
 * Debounced server FTS query for `rawQuery`. Enabled once the trimmed term is ≥2 chars, keyed
 * `['search', <term>]`, cached 10 s. Pass `''` (e.g. while the palette is closed) to disable it.
 */
export function useServerSearch(rawQuery: string): ServerSearch {
  const term = useDebouncedValue(rawQuery.trim(), DEBOUNCE_MS)
  const query = useQuery({
    queryKey: ['search', term] as const,
    queryFn: () => searchServer(term),
    enabled: term.length >= MIN_QUERY_LENGTH,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  })
  return { term, query }
}

export interface SnippetSegment {
  text: string
  /** True when this segment fell inside a `<b>…</b>` match marker. */
  match: boolean
}

/**
 * Split an FTS snippet on its `<b>`/`</b>` match markers into ordered text segments. Marker
 * tags are consumed (never emitted as text); every other character — including stray `<`/`>`
 * and HTML entities — passes through literally, so the caller renders each segment as plain
 * React text. Returns `[]` for an empty snippet (the caller then falls back to the task content).
 */
export function parseSnippet(snippet: string): SnippetSegment[] {
  if (snippet === '') return []
  const segments: SnippetSegment[] = []
  let match = false
  for (const part of snippet.split(/(<b>|<\/b>)/)) {
    if (part === '<b>') {
      match = true
    } else if (part === '</b>') {
      match = false
    } else if (part !== '') {
      segments.push({ text: part, match })
    }
  }
  return segments
}
