import { describe, expect, test } from 'vitest'
import { CreateReminderBodySchema, formatReminderBody, taskDeepLink } from './contracts'

describe('taskDeepLink', () => {
  test('falls back to the local base when publicUrl is null', () => {
    expect(taskDeepLink(null, 't1')).toBe('http://localhost:7968/task/t1')
  })

  test('strips a trailing slash from the configured public URL', () => {
    expect(taskDeepLink('https://x.dev/', 't1')).toBe('https://x.dev/task/t1')
  })

  test('leaves a slash-free public URL untouched', () => {
    expect(taskDeepLink('https://x.dev', 't9')).toBe('https://x.dev/task/t9')
  })
})

describe('formatReminderBody', () => {
  test('timed due today reads "Due today at HH:mm"', () => {
    expect(formatReminderBody({ date: '2026-07-16', time: '17:00' }, '2026-07-16')).toBe(
      'Due today at 17:00',
    )
  })

  test('timed due on another day spells out the date', () => {
    expect(formatReminderBody({ date: '2026-07-20', time: '09:00' }, '2026-07-16')).toBe(
      'Due 2026-07-20 at 09:00',
    )
  })

  test('all-day due today drops the time', () => {
    expect(formatReminderBody({ date: '2026-07-16', time: null }, '2026-07-16')).toBe('Due today')
  })

  test('all-day due on another day spells out the date without a time', () => {
    expect(formatReminderBody({ date: '2026-07-20', time: null }, '2026-07-16')).toBe(
      'Due 2026-07-20',
    )
  })

  test('null due degrades to a bare "Reminder"', () => {
    expect(formatReminderBody(null, '2026-07-16')).toBe('Reminder')
  })
})

describe('CreateReminderBodySchema', () => {
  const due = (over: Partial<{ time: string | null; recurrence: unknown }> = {}) => ({
    date: '2026-07-16',
    time: over.time === undefined ? '17:00' : over.time,
    string: '2026-07-16 17:00',
    recurrence: over.recurrence === undefined ? null : over.recurrence,
  })

  test('accepts a relative reminder with a minute_offset', () => {
    const r = CreateReminderBodySchema.safeParse({
      task_id: 't1',
      type: 'relative',
      minute_offset: 45,
    })
    expect(r.success).toBe(true)
  })

  test('rejects a relative reminder with no minute_offset', () => {
    const r = CreateReminderBodySchema.safeParse({ task_id: 't1', type: 'relative' })
    expect(r.success).toBe(false)
  })

  test('accepts an absolute reminder with date + time and no recurrence', () => {
    const r = CreateReminderBodySchema.safeParse({
      task_id: 't1',
      type: 'absolute',
      due: due(),
    })
    expect(r.success).toBe(true)
  })

  test('rejects an absolute reminder whose due has no time', () => {
    const r = CreateReminderBodySchema.safeParse({
      task_id: 't1',
      type: 'absolute',
      due: due({ time: null }),
    })
    expect(r.success).toBe(false)
  })

  test('rejects an absolute reminder with no due at all', () => {
    const r = CreateReminderBodySchema.safeParse({ task_id: 't1', type: 'absolute' })
    expect(r.success).toBe(false)
  })

  test('accepts a recurring reminder that carries a recurrence', () => {
    const r = CreateReminderBodySchema.safeParse({
      task_id: 't1',
      type: 'recurring',
      due: due({
        recurrence: { anchor: 'schedule', freq: 'daily', interval: 1, times: ['17:00'] },
      }),
    })
    expect(r.success).toBe(true)
  })

  test('rejects a recurring reminder whose due has no recurrence', () => {
    const r = CreateReminderBodySchema.safeParse({
      task_id: 't1',
      type: 'recurring',
      due: due(),
    })
    expect(r.success).toBe(false)
  })
})
