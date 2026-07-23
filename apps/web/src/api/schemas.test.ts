import type { Due } from '@opentask/core'
import { describe, expect, it } from 'vitest'
import { toDueInput, toMoveBody } from './schemas'

/**
 * Wire-serialization contract (undo §2.4: an inverse op restores the EXACT prior state).
 * `toDueInput` must carry the user's natural-language phrase alongside the exact date/time
 * so a restored due round-trips verbatim (the server pins explicit values and stores the
 * string as-is), and `toMoveBody` must forward `child_order` so an inverse move puts the
 * task back at its original position instead of appending.
 */

describe('toDueInput', () => {
  it('keeps the phrase alongside exact date/time for a plain due', () => {
    const due: Due = { date: '2026-07-17', time: null, string: 'today', recurrence: null }
    expect(toDueInput(due)).toEqual({ string: 'today', date: '2026-07-17' })
  })

  it('keeps the phrase and time for a timed plain due', () => {
    const due: Due = { date: '2026-07-17', time: '16:00', string: 'today 4pm', recurrence: null }
    expect(toDueInput(due)).toEqual({ string: 'today 4pm', date: '2026-07-17', time: '16:00' })
  })

  it('sends the exact occurrence with the phrase for a recurring due', () => {
    const due: Due = {
      date: '2026-07-18',
      time: '09:00',
      string: 'every day 9am',
      recurrence: { freq: 'daily', interval: 1 } as unknown as Due['recurrence'],
    }
    expect(toDueInput(due)).toEqual({
      string: 'every day 9am',
      date: '2026-07-18',
      time: '09:00',
    })
  })

  it('sends date-only when there is no phrase', () => {
    expect(toDueInput({ date: '2026-07-17' })).toEqual({ date: '2026-07-17' })
    expect(toDueInput({ date: '2026-07-17', time: '08:30' })).toEqual({
      date: '2026-07-17',
      time: '08:30',
    })
  })

  it('sends string-only when there is no date', () => {
    expect(toDueInput({ string: 'next week' })).toEqual({ string: 'next week' })
  })

  it('passes null and undefined through, and clears on empty input', () => {
    expect(toDueInput(null)).toBeNull()
    expect(toDueInput(undefined)).toBeUndefined()
    expect(toDueInput({ string: '   ' })).toBeNull()
  })
})

describe('toMoveBody', () => {
  it('forwards child_order so an inverse move restores the original position', () => {
    expect(
      toMoveBody({ project_id: 'p1', section_id: null, parent_id: 'parent', child_order: 1 }),
    ).toEqual({ project_id: 'p1', section_id: null, parent_id: 'parent', child_order: 1 })
  })

  it('omits absent keys (forward moves still append in the destination)', () => {
    expect(toMoveBody({ project_id: 'p2' })).toEqual({ project_id: 'p2' })
  })
})
