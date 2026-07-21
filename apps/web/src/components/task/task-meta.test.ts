/**
 * Task E — contextual due-chip suppression.
 *
 * In a date-scoped view (Today, or a single Upcoming day) the section heading already names
 * the date, so a due chip that merely repeats it is noise. `contextualDueChip` drops that
 * redundant date word: an all-day due matching the view date vanishes entirely, a timed due
 * keeps only its time, and every other due (overdue, another day, or no implied date) renders
 * the normal chip. Locks the exact behaviour so a view can't accidentally hide a meaningful date.
 */
import { describe, expect, it } from 'vitest'
import { contextualDueChip } from './task-meta'

const TODAY = '2026-07-21'

describe('contextualDueChip', () => {
  it('hides an all-day due that matches the view date (redundant with the heading)', () => {
    expect(contextualDueChip({ date: TODAY, time: null }, TODAY, TODAY)).toBeNull()
  })

  it('keeps only the time for a timed due that matches the view date', () => {
    // formatDueChip renders `Today 4pm`; the suppressed chip keeps just `4pm`.
    expect(contextualDueChip({ date: TODAY, time: '16:00' }, TODAY, TODAY)).toEqual({
      label: '4pm',
      tone: 'today',
    })
  })

  it('renders the full chip when the due date differs from the view date', () => {
    const chip = contextualDueChip({ date: '2026-07-23', time: null }, TODAY, TODAY)
    expect(chip).not.toBeNull()
    expect(chip?.label).toBe('Thursday')
  })

  it('never suppresses an overdue date even in a same-day view', () => {
    const chip = contextualDueChip({ date: '2026-07-19', time: null }, TODAY, TODAY)
    expect(chip).toEqual({ label: 'Jul 19', tone: 'overdue' })
  })

  it('renders the normal chip when no view date is implied', () => {
    expect(contextualDueChip({ date: TODAY, time: null }, TODAY, undefined)).toEqual({
      label: 'Today',
      tone: 'today',
    })
  })
})
