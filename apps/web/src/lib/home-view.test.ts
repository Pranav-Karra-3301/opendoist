import { describe, expect, it } from 'vitest'
import { homeViewToTarget } from './home-view'

describe('homeViewToTarget', () => {
  it('maps the four static views to their routes', () => {
    expect(homeViewToTarget('inbox')).toEqual({ to: '/inbox' })
    expect(homeViewToTarget('today')).toEqual({ to: '/today' })
    expect(homeViewToTarget('upcoming')).toEqual({ to: '/upcoming' })
    expect(homeViewToTarget('filters-labels')).toEqual({ to: '/filters-labels' })
  })

  it('maps prefixed entity views to parameterised routes', () => {
    expect(homeViewToTarget('project:abc123')).toEqual({
      to: '/project/$projectId',
      params: { projectId: 'abc123' },
    })
    expect(homeViewToTarget('label:lbl_9')).toEqual({
      to: '/label/$labelId',
      params: { labelId: 'lbl_9' },
    })
    expect(homeViewToTarget('filter:f-1')).toEqual({
      to: '/filter/$filterId',
      params: { filterId: 'f-1' },
    })
  })

  it('preserves ids that themselves contain a colon', () => {
    // only the FIRST colon splits kind from id
    expect(homeViewToTarget('project:a:b')).toEqual({
      to: '/project/$projectId',
      params: { projectId: 'a:b' },
    })
  })

  it('falls back to Today for blank, null, undefined, or unknown values', () => {
    expect(homeViewToTarget(undefined)).toEqual({ to: '/today' })
    expect(homeViewToTarget(null)).toEqual({ to: '/today' })
    expect(homeViewToTarget('')).toEqual({ to: '/today' })
    expect(homeViewToTarget('   ')).toEqual({ to: '/today' })
    expect(homeViewToTarget('nonsense')).toEqual({ to: '/today' })
  })

  it('falls back to Today when a prefixed value is missing its id', () => {
    expect(homeViewToTarget('project:')).toEqual({ to: '/today' })
    expect(homeViewToTarget('label:')).toEqual({ to: '/today' })
    expect(homeViewToTarget('unknownkind:x')).toEqual({ to: '/today' })
  })
})
