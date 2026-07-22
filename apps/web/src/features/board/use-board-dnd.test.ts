/**
 * Board dnd — the cross-column drop → mutation mapping table (frozen Task A §3).
 *
 * `planCrossDrop` is the pure heart of the board's drag semantics: it turns a (source drop, target
 * drop) pair into the exact mutation the list would write, or `null` for disabled / no-op drops.
 * Every grouping × drop case (incl. the disabled cells) is asserted here without a DOM.
 */
import { describe, expect, it } from 'vitest'
import type { Task } from '@/api/schemas'
import type { BoardDrop } from './BoardView'
import { planCrossDrop } from './use-board-dnd'

const TODAY = '2026-07-22'

const BASE: Task = {
  id: 'x',
  project_id: 'p1',
  section_id: null,
  parent_id: null,
  child_order: 0,
  day_order: 0,
  content: 'task',
  description: '',
  priority: 4,
  due: null,
  deadline_date: null,
  deadline_time: null,
  duration_min: null,
  labels: [],
  is_collapsed: false,
  uncompletable: false,
  completed_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

function mk(o: Partial<Task>): Task {
  return { ...BASE, ...o }
}

function due(date: string, time: string | null = null): Task['due'] {
  return { date, time, string: date, recurrence: null }
}

const NONE: BoardDrop = { type: 'none' }

describe('planCrossDrop — section move (project / inbox)', () => {
  it('moves to a section as a top-level task (server appends)', () => {
    const t = mk({ id: 'a', section_id: 's0' })
    const target: BoardDrop = { type: 'section', projectId: 'p1', sectionId: 's1' }
    expect(
      planCrossDrop(t, { type: 'section', projectId: 'p1', sectionId: 's0' }, target, TODAY),
    ).toEqual({
      kind: 'move',
      id: 'a',
      to: { project_id: 'p1', section_id: 's1', parent_id: null },
    })
  })

  it('moves to the no-section root (section_id null)', () => {
    const t = mk({ id: 'a', section_id: 's0' })
    const target: BoardDrop = { type: 'section', projectId: 'p1', sectionId: null }
    expect(planCrossDrop(t, NONE, target, TODAY)?.kind).toBe('move')
  })
})

describe('planCrossDrop — reschedule (Today Overdue→Today, Upcoming cross-day, grouped-by-date)', () => {
  it('sets an absolute due date, keeping time + recurrence', () => {
    const t = mk({ id: 'a', due: due('2026-07-20', '21:00') })
    const target: BoardDrop = { type: 'due', date: '2026-07-25' }
    expect(planCrossDrop(t, NONE, target, TODAY)).toEqual({
      kind: 'due',
      id: 'a',
      due: { date: '2026-07-25', time: '21:00', string: '2026-07-25', recurrence: null },
    })
  })

  it('resolves the relative Today bucket to today', () => {
    const t = mk({ id: 'a', due: due('2026-08-01') })
    expect(planCrossDrop(t, NONE, { type: 'dueToday' }, TODAY)).toEqual({
      kind: 'due',
      id: 'a',
      due: { date: TODAY, time: null, string: TODAY, recurrence: null },
    })
  })

  it('resolves the relative Tomorrow bucket to today + 1', () => {
    const t = mk({ id: 'a', due: due('2026-08-01') })
    const m = planCrossDrop(t, NONE, { type: 'dueTomorrow' }, TODAY)
    expect(m?.kind === 'due' && m.due?.date).toBe('2026-07-23')
  })

  it('clears the due date on a no-date target', () => {
    const t = mk({ id: 'a', due: due('2026-07-25') })
    expect(planCrossDrop(t, NONE, { type: 'due', date: null }, TODAY)).toEqual({
      kind: 'due',
      id: 'a',
      due: null,
    })
  })

  it('builds a fresh due when the task had none (no-date → Today)', () => {
    const t = mk({ id: 'a', due: null })
    expect(planCrossDrop(t, { type: 'due', date: null }, { type: 'dueToday' }, TODAY)).toEqual({
      kind: 'due',
      id: 'a',
      due: { date: TODAY, time: null, string: TODAY, recurrence: null },
    })
  })
})

describe('planCrossDrop — priority', () => {
  it('sets the target priority', () => {
    const t = mk({ id: 'a', priority: 4 })
    expect(
      planCrossDrop(t, { type: 'priority', priority: 4 }, { type: 'priority', priority: 1 }, TODAY),
    ).toEqual({
      kind: 'priority',
      id: 'a',
      priority: 1,
    })
  })
})

describe('planCrossDrop — label swap', () => {
  it('drops the source label and adds the target label, keeping others', () => {
    const t = mk({ id: 'a', labels: ['home', 'urgent'] })
    const src: BoardDrop = { type: 'label', label: 'home' }
    const dst: BoardDrop = { type: 'label', label: 'work' }
    expect(planCrossDrop(t, src, dst, TODAY)).toEqual({
      kind: 'labels',
      id: 'a',
      labels: ['urgent', 'work'],
    })
  })

  it('label:none target only strips the source label', () => {
    const t = mk({ id: 'a', labels: ['home', 'urgent'] })
    const src: BoardDrop = { type: 'label', label: 'home' }
    expect(planCrossDrop(t, src, { type: 'label', label: null }, TODAY)).toEqual({
      kind: 'labels',
      id: 'a',
      labels: ['urgent'],
    })
  })

  it('from label:none only adds the target label', () => {
    const t = mk({ id: 'a', labels: [] })
    const src: BoardDrop = { type: 'label', label: null }
    expect(planCrossDrop(t, src, { type: 'label', label: 'work' }, TODAY)).toEqual({
      kind: 'labels',
      id: 'a',
      labels: ['work'],
    })
  })

  it('does not add a label the task already has (no-op)', () => {
    const t = mk({ id: 'a', labels: ['work'] })
    const src: BoardDrop = { type: 'label', label: null }
    expect(planCrossDrop(t, src, { type: 'label', label: 'work' }, TODAY)).toBeNull()
  })
})

describe('planCrossDrop — disabled cells are inert', () => {
  it('returns null for a none target (Overdue, later/overdue buckets, project/none grouping)', () => {
    const t = mk({ id: 'a', due: due('2026-07-20') })
    expect(planCrossDrop(t, { type: 'due', date: TODAY }, NONE, TODAY)).toBeNull()
  })
})
