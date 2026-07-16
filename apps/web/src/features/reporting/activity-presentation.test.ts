import { describe, expect, it } from 'vitest'
import {
  buildReportingScope,
  DEFAULT_REPORTING_FILTERS,
  dayLabel,
  eventFrame,
  eventIcon,
  eventSentence,
  formatEventTime,
  groupByDay,
  rangeSince,
  typeLabel,
} from './activity-presentation'

const ev = (event_type: string, content = '') => ({
  event_type,
  payload: { content, project_name: null, meta: {} },
})

describe('eventIcon', () => {
  it('maps specific task verbs', () => {
    expect(eventIcon('task_added')).toBe('Plus')
    expect(eventIcon('task_completed')).toBe('CircleCheck')
    expect(eventIcon('task_uncompleted')).toBe('Undo2')
    expect(eventIcon('task_moved')).toBe('ArrowRightLeft')
    expect(eventIcon('task_restored')).toBe('RotateCcw')
  })
  it('applies suffix rules before entity prefixes', () => {
    expect(eventIcon('project_deleted')).toBe('Trash2')
    expect(eventIcon('label_updated')).toBe('Pencil')
    expect(eventIcon('task_deleted')).toBe('Trash2')
    expect(eventIcon('task_updated')).toBe('Pencil')
  })
  it('applies entity prefixes', () => {
    expect(eventIcon('project_added')).toBe('Hash')
    expect(eventIcon('comment_added')).toBe('MessageSquare')
    expect(eventIcon('section_added')).toBe('Rows3')
    expect(eventIcon('label_added')).toBe('Tag')
    expect(eventIcon('filter_added')).toBe('Filter')
  })
  it('falls back to CircleDot for unknown types', () => {
    expect(eventIcon('reminder_fired')).toBe('CircleDot')
    expect(eventIcon('gibberish')).toBe('CircleDot')
  })
})

describe('eventFrame / eventSentence', () => {
  it('renders known frames with content appended', () => {
    expect(eventFrame('task_completed')).toBe('You completed a task')
    expect(eventSentence(ev('task_completed', 'Water plants'))).toBe(
      'You completed a task: Water plants',
    )
  })
  it('omits the content clause when empty', () => {
    expect(eventSentence(ev('project_archived', ''))).toBe('You archived a project')
  })
  it('falls back to a readable string for unknown types', () => {
    expect(eventFrame('reminder_fired')).toBe('You reminder fired')
    expect(eventSentence(ev('reminder_fired', 'Standup'))).toBe('You reminder fired: Standup')
  })
})

describe('typeLabel', () => {
  it('title-cases and de-snakes', () => {
    expect(typeLabel('task_completed')).toBe('Task completed')
    expect(typeLabel('project_unarchived')).toBe('Project unarchived')
  })
})

describe('dayLabel', () => {
  it('labels today and yesterday relative to now', () => {
    expect(dayLabel('2026-07-15T23:00:00Z', 'UTC', '2026-07-15T01:00:00Z')).toBe('Today')
    expect(dayLabel('2026-07-14T10:00:00Z', 'UTC', '2026-07-15T09:00:00Z')).toBe('Yesterday')
  })
  it('labels older days as "Mon DD · Weekday"', () => {
    expect(dayLabel('2026-07-13T10:00:00Z', 'UTC', '2026-07-15T09:00:00Z')).toBe('Jul 13 · Monday')
  })
  it('resolves the calendar day in the user timezone', () => {
    // 02:00 UTC on Jul 16 is still Jul 15 in New York (UTC−4 in July).
    expect(dayLabel('2026-07-16T02:00:00Z', 'America/New_York', '2026-07-16T12:00:00Z')).toBe(
      'Yesterday',
    )
  })
})

describe('formatEventTime', () => {
  it('formats 24h as HH:mm', () => {
    expect(formatEventTime('2026-07-15T14:05:00Z', 'UTC', '24h')).toBe('14:05')
  })
  it('formats 12h with am/pm and noon/midnight edge cases', () => {
    expect(formatEventTime('2026-07-15T14:05:00Z', 'UTC', '12h')).toBe('2:05pm')
    expect(formatEventTime('2026-07-15T00:00:00Z', 'UTC', '12h')).toBe('12:00am')
    expect(formatEventTime('2026-07-15T12:00:00Z', 'UTC', '12h')).toBe('12:00pm')
  })
})

describe('groupByDay', () => {
  it('buckets consecutive newest-first rows into day groups', () => {
    const rows = [
      { id: 'a', at: '2026-07-15T10:00:00Z' },
      { id: 'b', at: '2026-07-15T09:00:00Z' },
      { id: 'c', at: '2026-07-14T09:00:00Z' },
    ]
    const groups = groupByDay(rows, (r) => r.at, 'UTC', '2026-07-15T12:00:00Z')
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
    expect(groups[0]?.items.map((r) => r.id)).toEqual(['a', 'b'])
    expect(groups[1]?.items.map((r) => r.id)).toEqual(['c'])
  })
})

describe('rangeSince / buildReportingScope', () => {
  it('computes preset since-bounds', () => {
    expect(rangeSince('all', '2026-07-15')).toBeUndefined()
    expect(rangeSince('7d', '2026-07-15')).toBe('2026-07-08')
    expect(rangeSince('30d', '2026-07-15')).toBe('2026-06-15')
    expect(rangeSince('custom', '2026-07-15')).toBeUndefined()
  })
  it('derives an empty scope from the defaults', () => {
    expect(buildReportingScope(DEFAULT_REPORTING_FILTERS, '2026-07-15')).toEqual({})
  })
  it('excludes event types from the scope and applies preset ranges', () => {
    expect(
      buildReportingScope(
        { types: ['task_completed'], projectId: 'p1', range: '7d', since: '', until: '' },
        '2026-07-15',
      ),
    ).toEqual({ project_id: 'p1', since: '2026-07-08' })
  })
  it('honours custom since/until', () => {
    expect(
      buildReportingScope(
        { types: [], projectId: '', range: 'custom', since: '2026-01-01', until: '2026-02-01' },
        '2026-07-15',
      ),
    ).toEqual({ since: '2026-01-01', until: '2026-02-01' })
  })
})
