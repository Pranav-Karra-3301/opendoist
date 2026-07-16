import { describe, expect, it } from 'vitest'
import type { ServerEvent } from '../../events/bus'
import { createTestApp, json } from '../../test/helpers'
import { type Settings, SettingsSchema } from '../schemas'

interface UserDto {
  id: string
  name: string
  email: string
  two_factor_enabled: boolean
  created_at: string
}

describe('user router', () => {
  it('GET /user returns the signed-up user', async () => {
    const t = await createTestApp()
    try {
      const res = await t.get('/api/v1/user')
      expect(res.status).toBe(200)
      const u = await json<UserDto>(res)
      expect(u.id).toBe(t.userId)
      expect(u.name).toBe('Test')
      expect(u.email).toBe('test@example.com')
      expect(u.two_factor_enabled).toBe(false)
      expect(typeof u.created_at).toBe('string')
      expect(u.created_at.length).toBeGreaterThan(0)
    } finally {
      t.close()
    }
  })

  it('PATCH /user updates and persists the name', async () => {
    const t = await createTestApp()
    try {
      const res = await t.patch('/api/v1/user', { name: 'Renamed Person' })
      expect(res.status).toBe(200)
      expect((await json<UserDto>(res)).name).toBe('Renamed Person')
      const again = await t.get('/api/v1/user')
      expect((await json<UserDto>(again)).name).toBe('Renamed Person')
    } finally {
      t.close()
    }
  })

  it('GET /user/settings returns exactly the schema defaults for a fresh user', async () => {
    const t = await createTestApp()
    try {
      const res = await t.get('/api/v1/user/settings')
      expect(res.status).toBe(200)
      expect(await json<Settings>(res)).toEqual(SettingsSchema.parse({}))
    } finally {
      t.close()
    }
  })

  it('PATCH /user/settings shallow-merges and leaves untouched fields intact', async () => {
    const t = await createTestApp()
    try {
      // Customize one field first — this catches a naive `partial()` merge that would
      // reset it to its default when a later PATCH touches other fields.
      await t.patch('/api/v1/user/settings', { weeklyGoal: 42 })
      const res = await t.patch('/api/v1/user/settings', {
        timezone: 'America/New_York',
        dailyGoal: 3,
      })
      expect(res.status).toBe(200)
      const s = await json<Settings>(res)
      expect(s.timezone).toBe('America/New_York')
      expect(s.dailyGoal).toBe(3)
      expect(s.weeklyGoal).toBe(42) // preserved from the earlier PATCH
      expect(s.theme).toBe('kale') // untouched default
      // persisted
      const g = await json<Settings>(await t.get('/api/v1/user/settings'))
      expect(g.timezone).toBe('America/New_York')
      expect(g.dailyGoal).toBe(3)
      expect(g.weeklyGoal).toBe(42)
    } finally {
      t.close()
    }
  })

  it('PATCH /user/settings replaces one viewPrefs key and keeps the others', async () => {
    const t = await createTestApp()
    try {
      await t.patch('/api/v1/user/settings', {
        viewPrefs: { today: { groupBy: 'date' }, inbox: { sortBy: 'priority' } },
      })
      const res = await t.patch('/api/v1/user/settings', {
        viewPrefs: { today: { groupBy: 'priority' } },
      })
      expect(res.status).toBe(200)
      const s = await json<Settings>(res)
      expect(s.viewPrefs.today?.groupBy).toBe('priority')
      expect(s.viewPrefs.inbox).toBeDefined()
      expect(s.viewPrefs.inbox?.sortBy).toBe('priority')
    } finally {
      t.close()
    }
  })

  it('PATCH /user/settings accepts UTC (Intl omits it from supportedValuesOf)', async () => {
    const t = await createTestApp()
    try {
      const res = await t.patch('/api/v1/user/settings', { timezone: 'UTC' })
      expect(res.status).toBe(200)
      expect((await json<Settings>(res)).timezone).toBe('UTC')
    } finally {
      t.close()
    }
  })

  it('PATCH /user/settings rejects an unknown timezone with a 400 problem', async () => {
    const t = await createTestApp()
    try {
      const res = await t.patch('/api/v1/user/settings', { timezone: 'Mars/Olympus' })
      expect(res.status).toBe(400)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
      expect((await json<{ title: string }>(res)).title).toBe('invalid timezone')
    } finally {
      t.close()
    }
  })

  it('PATCH /user/settings publishes settings.updated on the bus', async () => {
    const t = await createTestApp()
    try {
      const events: ServerEvent[] = []
      const unsub = t.deps.bus.subscribe((e) => events.push(e))
      const res = await t.patch('/api/v1/user/settings', { dailyGoal: 7 })
      unsub()
      expect(res.status).toBe(200)
      const evt = events.find((e) => e.type === 'settings.updated')
      expect(evt).toBeDefined()
      expect(evt?.entity).toBe('settings')
      expect(evt?.ids).toEqual([t.userId])
    } finally {
      t.close()
    }
  })
})
