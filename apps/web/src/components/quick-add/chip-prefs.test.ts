import { DEFAULT_USER_SETTINGS, QUICK_ADD_CHIP_IDS } from '@opendoist/core'
import { describe, expect, it } from 'vitest'
import {
  type ChipPref,
  isChipId,
  moveChip,
  normalizeChips,
  partitionChips,
  setChipVisible,
} from './chip-prefs'

const DEFAULT_CHIPS = DEFAULT_USER_SETTINGS.quickAdd.chips
const ids = (chips: readonly ChipPref[]): string[] => chips.map((c) => c.id)

describe('isChipId', () => {
  it('accepts every frozen chip id and rejects strangers', () => {
    for (const id of QUICK_ADD_CHIP_IDS) expect(isChipId(id)).toBe(true)
    expect(isChipId('project')).toBe(false)
    expect(isChipId('assignee')).toBe(false)
    expect(isChipId('')).toBe(false)
  })
})

describe('normalizeChips', () => {
  it('leaves the default seven visible chips untouched, in order', () => {
    const out = normalizeChips(DEFAULT_CHIPS)
    expect(ids(out)).toEqual([...QUICK_ADD_CHIP_IDS])
    expect(out.every((c) => c.visible)).toBe(true)
  })

  it('preserves a custom order and visibility', () => {
    const custom: ChipPref[] = [
      { id: 'priority', visible: true },
      { id: 'date', visible: false },
      { id: 'labels', visible: true },
    ]
    const out = normalizeChips(custom)
    // custom order first, then the remaining frozen ids appended as visible
    expect(ids(out).slice(0, 3)).toEqual(['priority', 'date', 'labels'])
    expect(out.find((c) => c.id === 'date')?.visible).toBe(false)
    // every frozen id present exactly once
    expect(new Set(ids(out)).size).toBe(QUICK_ADD_CHIP_IDS.length)
    expect(ids(out).sort()).toEqual([...QUICK_ADD_CHIP_IDS].sort())
  })

  it('drops unknown ids and de-duplicates repeated ids (keeping the first)', () => {
    const drifted = [
      { id: 'date', visible: false },
      { id: 'project', visible: true }, // not a frozen chip id → dropped
      { id: 'date', visible: true }, // duplicate → dropped, first wins
    ] as unknown as ChipPref[]
    const out = normalizeChips(drifted)
    expect(ids(out)).toEqual([...QUICK_ADD_CHIP_IDS])
    expect(out.find((c) => c.id === 'date')?.visible).toBe(false)
  })

  it('appends every missing frozen chip as visible when given an empty list', () => {
    const out = normalizeChips([])
    expect(ids(out)).toEqual([...QUICK_ADD_CHIP_IDS])
    expect(out.every((c) => c.visible)).toBe(true)
  })
})

describe('partitionChips', () => {
  it('splits into visible and hidden while preserving order', () => {
    const chips: ChipPref[] = [
      { id: 'date', visible: true },
      { id: 'duration', visible: false },
      { id: 'priority', visible: true },
      { id: 'description', visible: false },
    ]
    const { visible, hidden } = partitionChips(chips)
    expect(ids(visible)).toEqual(['date', 'priority'])
    expect(ids(hidden)).toEqual(['duration', 'description'])
  })
})

describe('setChipVisible', () => {
  it('flips only the targeted chip and keeps the rest', () => {
    const out = setChipVisible(DEFAULT_CHIPS, 'duration', false)
    expect(out.find((c) => c.id === 'duration')?.visible).toBe(false)
    expect(out.filter((c) => !c.visible).map((c) => c.id)).toEqual(['duration'])
    expect(ids(out)).toEqual([...QUICK_ADD_CHIP_IDS])
  })

  it('does not mutate the input', () => {
    const input = normalizeChips(DEFAULT_CHIPS)
    const snapshot = JSON.stringify(input)
    setChipVisible(input, 'labels', false)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('moveChip', () => {
  it('drags a chip to the front (priority becomes first)', () => {
    const out = moveChip(normalizeChips(DEFAULT_CHIPS), 'priority', 'date')
    expect(ids(out)).toEqual([
      'priority',
      'date',
      'deadline',
      'reminders',
      'labels',
      'duration',
      'description',
    ])
    // no chips lost or duplicated
    expect(new Set(ids(out)).size).toBe(QUICK_ADD_CHIP_IDS.length)
  })

  it('matches arrayMove semantics when moving forward past the target', () => {
    const chips: ChipPref[] = ['a', 'b', 'c', 'd'].map((id) => ({
      id: id as ChipPref['id'],
      visible: true,
    }))
    // move a(0) onto c(2): remove a, insert at index 2 of the shortened array → [b, c, a, d]
    expect(ids(moveChip(chips, 'a', 'c'))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('is a no-op copy for a self-drop or an unknown id', () => {
    const chips = normalizeChips(DEFAULT_CHIPS)
    expect(ids(moveChip(chips, 'date', 'date'))).toEqual(ids(chips))
    expect(ids(moveChip(chips, 'nope', 'date'))).toEqual(ids(chips))
  })

  it('does not mutate the input', () => {
    const input = normalizeChips(DEFAULT_CHIPS)
    const snapshot = JSON.stringify(input)
    moveChip(input, 'description', 'date')
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
