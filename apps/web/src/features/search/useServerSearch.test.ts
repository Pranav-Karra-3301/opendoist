import { describe, expect, it } from 'vitest'
import { parseSnippet, type SnippetSegment } from './useServerSearch'

describe('parseSnippet', () => {
  it('returns no segments for an empty snippet (caller falls back to content)', () => {
    expect(parseSnippet('')).toEqual<SnippetSegment[]>([])
  })

  it('returns a single unmatched segment when there are no marks', () => {
    expect(parseSnippet('milk and eggs')).toEqual<SnippetSegment[]>([
      { text: 'milk and eggs', match: false },
    ])
  })

  it('splits a single <b>…</b> match out of surrounding text', () => {
    expect(parseSnippet('milk and <b>eggs</b>')).toEqual<SnippetSegment[]>([
      { text: 'milk and ', match: false },
      { text: 'eggs', match: true },
    ])
  })

  it('handles a match at the start followed by trailing text', () => {
    expect(parseSnippet('<b>eggs</b> and milk')).toEqual<SnippetSegment[]>([
      { text: 'eggs', match: true },
      { text: ' and milk', match: false },
    ])
  })

  it('handles multiple interleaved matches', () => {
    expect(parseSnippet('<b>buy</b> the <b>eggs</b> now')).toEqual<SnippetSegment[]>([
      { text: 'buy', match: true },
      { text: ' the ', match: false },
      { text: 'eggs', match: true },
      { text: ' now', match: false },
    ])
  })

  it('never emits the marker tags as visible text and drops empty gaps', () => {
    // adjacent markers (…</b><b>…) leave no text between them → no empty segment
    const segments = parseSnippet('<b>a</b><b>b</b>')
    expect(segments).toEqual<SnippetSegment[]>([
      { text: 'a', match: true },
      { text: 'b', match: true },
    ])
    for (const seg of segments) {
      expect(seg.text).not.toContain('<b>')
      expect(seg.text).not.toContain('</b>')
    }
  })

  it('passes stray angle brackets and entities through as literal text', () => {
    // FTS snippets are not HTML-escaped; only <b>/</b> are markers, everything else is literal.
    expect(parseSnippet('a < b & <b>c</b>')).toEqual<SnippetSegment[]>([
      { text: 'a < b & ', match: false },
      { text: 'c', match: true },
    ])
  })

  it('tolerates an unbalanced trailing open marker without crashing', () => {
    expect(parseSnippet('call mom <b>today')).toEqual<SnippetSegment[]>([
      { text: 'call mom ', match: false },
      { text: 'today', match: true },
    ])
  })
})
