import { describe, expect, test } from 'vitest'
import {
  completionDelta,
  computeDailyStreak,
  computeWeeklyStreak,
  deletionPenalty,
  KARMA_LEVELS,
  KARMA_POINTS,
  karmaLevel,
  karmaTrend,
  type StreakDay,
} from './index'

const TODAY = '2026-07-15' // a Wednesday; week (weekStart=Mon) anchors on 2026-07-13

describe('KARMA_POINTS / KARMA_LEVELS constants', () => {
  test('point values match spec §2.5', () => {
    expect(KARMA_POINTS).toEqual({
      completion: 5,
      onTimeBonus: 3,
      dailyGoal: 10,
      weeklyGoal: 25,
      overduePenalty: -10,
    })
  })
  test('eight ascending Todoist levels', () => {
    expect(KARMA_LEVELS.map((l) => l.name)).toEqual([
      'Beginner',
      'Novice',
      'Intermediate',
      'Professional',
      'Expert',
      'Master',
      'Grand Master',
      'Enlightened',
    ])
    expect(KARMA_LEVELS.map((l) => l.floor)).toEqual([
      0, 500, 2500, 5000, 7500, 10000, 20000, 50000,
    ])
  })
})

describe('karmaLevel', () => {
  test.each<[number, string, number, number | null]>([
    // total, floor, name, nextFloor
    [0, 'Beginner', 0, 500],
    [499, 'Beginner', 0, 500],
    [500, 'Novice', 500, 2500],
    [2499, 'Novice', 500, 2500],
    [2500, 'Intermediate', 2500, 5000],
    [4999, 'Intermediate', 2500, 5000],
    [5000, 'Professional', 5000, 7500],
    [7500, 'Expert', 7500, 10000],
    [10000, 'Master', 10000, 20000],
    [20000, 'Grand Master', 20000, 50000],
    [49999, 'Grand Master', 20000, 50000],
    [50000, 'Enlightened', 50000, null],
  ])('total %i → %s', (total, name, floor, nextFloor) => {
    const info = karmaLevel(total)
    expect(info.name).toBe(name)
    expect(info.floor).toBe(floor)
    expect(info.nextFloor).toBe(nextFloor)
  })

  test('progress is 0 at a level floor', () => {
    expect(karmaLevel(0).progress).toBe(0)
    expect(karmaLevel(500).progress).toBe(0)
  })
  test('progress is halfway through Novice at 1500', () => {
    const info = karmaLevel(1500)
    expect(info.name).toBe('Novice')
    expect(info.progress).toBe(0.5)
  })
  test('Enlightened has null nextFloor and progress 1', () => {
    const info = karmaLevel(50000)
    expect(info.nextFloor).toBeNull()
    expect(info.progress).toBe(1)
    expect(karmaLevel(1_000_000).progress).toBe(1)
  })
  test('negative total clamps to Beginner with progress 0', () => {
    const info = karmaLevel(-100)
    expect(info.name).toBe('Beginner')
    expect(info.floor).toBe(0)
    expect(info.nextFloor).toBe(500)
    expect(info.progress).toBe(0)
  })
})

describe('completionDelta', () => {
  test.each<[string, string | null, number, boolean, number]>([
    // completedDate, dueDate, points, onTime, overdueDays
    ['2026-07-15', null, 5, false, 0],
    ['2026-07-15', '2026-07-15', 8, true, 0],
    ['2026-07-10', '2026-07-15', 8, true, 0], // completed before due
    ['2026-07-16', '2026-07-15', 5, false, 1],
    ['2026-07-18', '2026-07-15', 5, false, 3],
    ['2026-07-19', '2026-07-15', -5, false, 4],
    ['2026-08-14', '2026-07-15', -5, false, 30],
  ])('completed %s due %s', (completedDate, dueDate, points, onTime, overdueDays) => {
    expect(completionDelta({ completedDate, dueDate })).toEqual({ points, onTime, overdueDays })
  })
})

describe('deletionPenalty', () => {
  test.each<[string, string | null, number]>([
    // deletedDate, dueDate, penalty
    ['2026-07-15', null, 0],
    ['2026-07-18', '2026-07-15', 0], // 3 days overdue
    ['2026-07-19', '2026-07-15', -10], // 4 days overdue
    ['2026-07-10', '2026-07-15', 0], // due in the future
  ])('deleted %s due %s', (deletedDate, dueDate, penalty) => {
    expect(deletionPenalty({ deletedDate, dueDate })).toBe(penalty)
  })
})

const sd = (date: string, opts: Partial<Omit<StreakDay, 'date'>> = {}): StreakDay => ({
  date,
  completed: opts.completed ?? (opts.goalMet ? 5 : 0),
  goalMet: opts.goalMet ?? false,
  dayOff: opts.dayOff ?? false,
  vacation: opts.vacation ?? false,
})

describe('computeDailyStreak', () => {
  test.each<{ name: string; days: StreakDay[]; current: number; longest: number }>([
    {
      name: '5 consecutive goalMet days ending today',
      days: [
        sd('2026-07-11', { goalMet: true }),
        sd('2026-07-12', { goalMet: true }),
        sd('2026-07-13', { goalMet: true }),
        sd('2026-07-14', { goalMet: true }),
        sd('2026-07-15', { goalMet: true }),
      ],
      current: 5,
      longest: 5,
    },
    {
      name: 'today unmet is skipped; current counts from yesterday',
      days: [
        sd('2026-07-12', { goalMet: true }),
        sd('2026-07-13', { goalMet: true }),
        sd('2026-07-14', { goalMet: true }),
        sd('2026-07-15', { goalMet: false }),
      ],
      current: 3,
      longest: 3,
    },
    {
      name: 'a dayOff gap does not break',
      days: [
        sd('2026-07-11', { goalMet: true }),
        sd('2026-07-12', { goalMet: true }),
        sd('2026-07-13', { dayOff: true }),
        sd('2026-07-14', { goalMet: true }),
        sd('2026-07-15', { goalMet: true }),
      ],
      current: 4,
      longest: 4,
    },
    {
      name: 'a vacation gap does not break',
      days: [
        sd('2026-07-11', { goalMet: true }),
        sd('2026-07-12', { goalMet: true }),
        sd('2026-07-13', { vacation: true }),
        sd('2026-07-14', { goalMet: true }),
        sd('2026-07-15', { goalMet: true }),
      ],
      current: 4,
      longest: 4,
    },
    {
      name: 'a plain missed day breaks (current 0 when yesterday missed and today unmet)',
      days: [
        sd('2026-07-12', { goalMet: true }),
        sd('2026-07-13', { goalMet: true }),
        sd('2026-07-14', { goalMet: false }),
        sd('2026-07-15', { goalMet: false }),
      ],
      current: 0,
      longest: 2,
    },
    {
      name: 'longest tracks the best historical run across a break',
      days: [
        sd('2026-07-01', { goalMet: true }),
        sd('2026-07-02', { goalMet: true }),
        sd('2026-07-03', { goalMet: true }),
        sd('2026-07-04', { goalMet: true }),
        sd('2026-07-05', { goalMet: true }),
        sd('2026-07-06', { goalMet: false }),
        sd('2026-07-14', { goalMet: true }),
        sd('2026-07-15', { goalMet: true }),
      ],
      current: 2,
      longest: 5,
    },
    {
      name: 'sparse input (missing dates) breaks',
      days: [sd('2026-07-13', { goalMet: true }), sd('2026-07-15', { goalMet: true })],
      current: 1,
      longest: 1,
    },
  ])('daily: $name', ({ days, current, longest }) => {
    expect(computeDailyStreak(days, TODAY)).toEqual({ current, longest })
  })

  test('empty input → zero streak', () => {
    expect(computeDailyStreak([], TODAY)).toEqual({ current: 0, longest: 0 })
  })
  test('future-only days are ignored', () => {
    expect(computeDailyStreak([sd('2026-07-20', { goalMet: true })], TODAY)).toEqual({
      current: 0,
      longest: 0,
    })
  })
})

describe('computeWeeklyStreak', () => {
  const opts = { today: TODAY, weeklyGoal: 25, weekStart: 1 as const }
  test.each<{ name: string; days: StreakDay[]; current: number; longest: number }>([
    {
      name: '3 past weeks ≥25 + current week at 10 → current 3 (current week pending-skip)',
      days: [
        sd('2026-06-22', { completed: 25 }),
        sd('2026-06-29', { completed: 25 }),
        sd('2026-07-06', { completed: 25 }),
        sd('2026-07-15', { completed: 10 }),
      ],
      current: 3,
      longest: 3,
    },
    {
      name: 'current week already ≥25 → 4',
      days: [
        sd('2026-06-22', { completed: 25 }),
        sd('2026-06-29', { completed: 25 }),
        sd('2026-07-06', { completed: 25 }),
        sd('2026-07-15', { completed: 25 }),
      ],
      current: 4,
      longest: 4,
    },
    {
      name: 'a past week of all-vacation days is skipped (bridges the streak)',
      days: [
        sd('2026-06-22', { completed: 25 }),
        sd('2026-06-29', { completed: 25 }),
        sd('2026-07-06', { vacation: true }),
        sd('2026-07-07', { vacation: true }),
        sd('2026-07-08', { vacation: true }),
        sd('2026-07-09', { vacation: true }),
        sd('2026-07-10', { vacation: true }),
        sd('2026-07-11', { vacation: true }),
        sd('2026-07-12', { vacation: true }),
        sd('2026-07-15', { completed: 25 }),
      ],
      current: 3,
      longest: 3,
    },
    {
      name: 'a past week at 24 breaks',
      days: [
        sd('2026-06-29', { completed: 25 }),
        sd('2026-07-06', { completed: 24 }),
        sd('2026-07-15', { completed: 25 }),
      ],
      current: 1,
      longest: 1,
    },
  ])('weekly: $name', ({ days, current, longest }) => {
    expect(computeWeeklyStreak(days, opts)).toEqual({ current, longest })
  })

  test('empty input → zero streak', () => {
    expect(computeWeeklyStreak([], opts)).toEqual({ current: 0, longest: 0 })
  })
})

describe('karmaTrend', () => {
  test.each<[string, number[], 'up' | 'down' | 'flat']>([
    ['positive last-7 sum', [5, 5, 5, 5, 5, 5, 5], 'up'],
    ['single positive', [1], 'up'],
    ['negative last-7 sum', [-5, -5, -5], 'down'],
    ['all zeros', [0, 0, 0], 'flat'],
    ['empty', [], 'flat'],
    ['balanced sum is flat', [5, -5], 'flat'],
    ['only the last 7 entries count (old negative ignored)', [-100, 5, 5, 5, 5, 5, 5, 5], 'up'],
    [
      'only the last 7 entries count (old positive ignored)',
      [100, -1, -1, -1, -1, -1, -1, -1],
      'down',
    ],
  ])('%s', (_name, deltas, expected) => {
    expect(karmaTrend(deltas)).toBe(expected)
  })
})
