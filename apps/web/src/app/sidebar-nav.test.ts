import { DEFAULT_USER_SETTINGS } from '@opentask/core'
import { describe, expect, it } from 'vitest'
import { isNavVisible, NAV_VISIBILITY_FLAG, SIDEBAR_NAV_ORDER } from './sidebar-nav'

const defaults = DEFAULT_USER_SETTINGS.sidebar

describe('isNavVisible', () => {
  it('shows every primary nav item under default settings', () => {
    for (const id of SIDEBAR_NAV_ORDER) {
      expect(isNavVisible(id, defaults)).toBe(true)
    }
  })

  it('hides only the item whose show-flag is false', () => {
    const prefs = { ...defaults, showToday: false }
    expect(isNavVisible('today', prefs)).toBe(false)
    expect(isNavVisible('inbox', prefs)).toBe(true)
    expect(isNavVisible('upcoming', prefs)).toBe(true)
    expect(isNavVisible('reporting', prefs)).toBe(true)
  })

  it('maps the combined Filters & Labels item to showFiltersLabels', () => {
    expect(NAV_VISIBILITY_FLAG['filters-labels']).toBe('showFiltersLabels')
    expect(isNavVisible('filters-labels', { ...defaults, showFiltersLabels: false })).toBe(false)
  })

  it('hides all items when every flag is off', () => {
    const off = {
      ...defaults,
      showInbox: false,
      showToday: false,
      showUpcoming: false,
      showFiltersLabels: false,
      showReporting: false,
    }
    for (const id of SIDEBAR_NAV_ORDER) {
      expect(isNavVisible(id, off)).toBe(false)
    }
  })
})
