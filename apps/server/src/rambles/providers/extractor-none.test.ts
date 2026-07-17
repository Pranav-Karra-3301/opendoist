import { describe, expect, it } from 'vitest'
import { createNoneExtractor } from './extractor-none'
import type { ExtractorContext } from './types'

const ctx: ExtractorContext = { now: '2026-07-15T21:00:00Z', timezone: 'UTC', knownLabels: [] }
const ext = createNoneExtractor()

describe('createNoneExtractor', () => {
  it("exposes id 'none'", () => {
    expect(ext.id).toBe('none')
  })

  it('emits a single task with a verbatim short title and the full transcript as notes', async () => {
    const { tasks } = await ext.extract('buy milk and call the bank', ctx)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toEqual({
      title: 'buy milk and call the bank',
      notes: 'buy milk and call the bank',
      due: null,
      priority: null,
      labels: [],
    })
  })

  it('truncates a long transcript at a word boundary with an ellipsis, keeping full notes', async () => {
    const long =
      'remember to buy milk eggs bread and butter then call the bank about the mortgage and email Sam the quarterly report before Friday afternoon'
    const { tasks } = await ext.extract(long, ctx)
    const title = tasks[0]?.title ?? ''
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(81) // ≤80 chars + the single-code-unit ellipsis
    expect(title.at(-2)).not.toBe(' ') // cut on a word boundary, no dangling space
    expect(long.startsWith(title.slice(0, -1))).toBe(true) // the head is a real prefix (no partial word)
    expect(tasks[0]?.notes).toBe(long) // notes retain the entire transcript
  })

  it('hard-cuts a single very long word that has no spaces', async () => {
    const { tasks } = await ext.extract('x'.repeat(100), ctx)
    expect(tasks[0]?.title).toBe(`${'x'.repeat(80)}…`)
  })

  it('does not truncate a transcript of exactly the max length', async () => {
    const text = 'a'.repeat(80)
    const { tasks } = await ext.extract(text, ctx)
    expect(tasks[0]?.title).toBe(text)
  })

  it("uses 'Voice note' for a whitespace-only transcript", async () => {
    const { tasks } = await ext.extract('   \n  ', ctx)
    expect(tasks[0]?.title).toBe('Voice note')
  })

  it('never throws on empty input', async () => {
    await expect(ext.extract('', ctx)).resolves.toEqual({
      tasks: [{ title: 'Voice note', notes: '', due: null, priority: null, labels: [] }],
    })
  })
})
