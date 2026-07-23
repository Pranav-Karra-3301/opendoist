import { describe, expect, test } from 'vitest'
import { CreateReminderBodySchema, formatLead, formatReminderBody, taskDeepLink } from './contracts'

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

describe('formatLead', () => {
  test('humanizes minute leads into min / hr / day phrases', () => {
    expect(formatLead(0)).toBe('0 min')
    expect(formatLead(10)).toBe('10 min')
    expect(formatLead(45)).toBe('45 min')
    expect(formatLead(60)).toBe('1 hr')
    expect(formatLead(90)).toBe('1 hr 30 min')
    expect(formatLead(120)).toBe('2 hr')
    expect(formatLead(1440)).toBe('1 day')
    expect(formatLead(1500)).toBe('1 day 1 hr')
    expect(formatLead(2880)).toBe('2 days')
  })
})

describe('formatReminderBody lead-aware copy', () => {
  const due = { date: '2026-07-16', time: '17:00' }
  test('says "Due now" at the due instant and "Due in …" ahead of it', () => {
    expect(formatReminderBody(due, '2026-07-16', 0)).toBe('Due now')
    expect(formatReminderBody(due, '2026-07-16', 30)).toBe('Due in 30 min (17:00)')
    expect(formatReminderBody(due, '2026-07-15', 30)).toBe('Due in 30 min (2026-07-16 17:00)')
  })
  test('keeps legacy copy for unknown leads and date-only dues', () => {
    expect(formatReminderBody(due, '2026-07-16', null)).toBe('Due today at 17:00')
    expect(formatReminderBody(due, '2026-07-16')).toBe('Due today at 17:00')
    expect(formatReminderBody({ date: '2026-07-16', time: null }, '2026-07-16', 30)).toBe(
      'Due today',
    )
    expect(formatReminderBody(null, '2026-07-16', 0)).toBe('Reminder')
  })
})
