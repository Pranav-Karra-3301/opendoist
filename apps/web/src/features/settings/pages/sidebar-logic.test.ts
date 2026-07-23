import { DEFAULT_USER_SETTINGS } from '@opentask/core'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_VIEW_TOGGLES, sidebarPatch } from './sidebar-logic'

const BASE = DEFAULT_USER_SETTINGS.sidebar

describe('sidebarPatch', () => {
  it('emits the FULL sidebar object (all six keys) so the server never drops untouched toggles', () => {
    const patch = sidebarPatch(BASE, 'showInbox', false)
    expect(Object.keys(patch)).toEqual(['sidebar'])
    expect(patch.sidebar).toEqual({
      showInbox: false,
      showToday: true,
      showUpcoming: true,
      showFiltersLabels: true,
      showReporting: true,
      showCounts: true,
    })
  })

  it('changes only the targeted toggle and preserves the other prior (non-default) values', () => {
    const current: typeof BASE = { ...BASE, showToday: false, showCounts: false }
    const patch = sidebarPatch(current, 'showReporting', false)
    expect(patch.sidebar).toEqual({ ...current, showReporting: false })
    expect(patch.sidebar?.showToday).toBe(false)
    expect(patch.sidebar?.showCounts).toBe(false)
  })

  it('toggles counts without touching the view flags', () => {
    const patch = sidebarPatch(BASE, 'showCounts', false)
    expect(patch.sidebar).toEqual({ ...BASE, showCounts: false })
  })

  it('does not mutate the input object', () => {
    const current = { ...BASE }
    sidebarPatch(current, 'showUpcoming', false)
    expect(current).toEqual(BASE)
  })
})

describe('SIDEBAR_VIEW_TOGGLES', () => {
  it('covers exactly the five toggleable views in sidebar order (counts handled separately)', () => {
    expect(SIDEBAR_VIEW_TOGGLES.map((t) => t.key)).toEqual([
      'showInbox',
      'showToday',
      'showUpcoming',
      'showFiltersLabels',
      'showReporting',
    ])
  })

  it('does not include the counts toggle among the view rows', () => {
    expect(SIDEBAR_VIEW_TOGGLES.some((t) => t.key === 'showCounts')).toBe(false)
  })
})
