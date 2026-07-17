import { describe, expect, it } from 'vitest'
import { PushSubscriptionDtoSchema } from './contracts'
import { createTestApp, json } from './test-helpers'

const endpoint = 'https://push.example.com/abc123'

describe('push-subscriptions router', () => {
  it('subscribes, upserts the same endpoint, lists, and revokes', async () => {
    const t = await createTestApp()
    try {
      const res1 = await t.post('/api/v1/push-subscriptions', {
        endpoint,
        keys: { p256dh: 'key-a', auth: 'auth-a' },
        user_agent: 'Firefox',
      })
      expect(res1.status).toBe(201)
      const dto1 = PushSubscriptionDtoSchema.parse(await res1.json())
      expect(dto1.endpoint).toBe(endpoint)
      expect(dto1.user_agent).toBe('Firefox')
      expect(dto1.last_used_at).toBeNull()

      // Re-POST the same endpoint → upsert: identical id, refreshed keys/user_agent, still one row.
      const res2 = await t.post('/api/v1/push-subscriptions', {
        endpoint,
        keys: { p256dh: 'key-b', auth: 'auth-b' },
        user_agent: 'Chrome',
      })
      expect(res2.status).toBe(201)
      const dto2 = PushSubscriptionDtoSchema.parse(await res2.json())
      expect(dto2.id).toBe(dto1.id)
      expect(dto2.user_agent).toBe('Chrome')
      expect(dto2.last_used_at).not.toBeNull()

      const list = await json<{ results: unknown[] }>(await t.get('/api/v1/push-subscriptions'))
      expect(list.results).toHaveLength(1)

      const del = await t.del(`/api/v1/push-subscriptions/${dto1.id}`)
      expect(del.status).toBe(204)

      const after = await json<{ results: unknown[] }>(await t.get('/api/v1/push-subscriptions'))
      expect(after.results).toHaveLength(0)
    } finally {
      t.close()
    }
  })

  it('returns 404 when revoking an unknown subscription', async () => {
    const t = await createTestApp()
    try {
      expect((await t.del('/api/v1/push-subscriptions/does-not-exist')).status).toBe(404)
    } finally {
      t.close()
    }
  })

  it('serves the persisted VAPID public key (never regenerated)', async () => {
    const t = await createTestApp()
    try {
      const res = await t.get('/api/v1/push/vapid-public-key')
      expect(res.status).toBe(200)
      const { public_key } = await json<{ public_key: string }>(res)
      // The endpoint must return exactly the flat key phase 3 persisted into secrets.json.
      expect(public_key).toBe(t.deps.secrets.vapidPublicKey)
      expect(public_key.length).toBeGreaterThan(0)
    } finally {
      t.close()
    }
  })

  it('rejects a malformed subscription body with 400', async () => {
    const t = await createTestApp()
    try {
      const res = await t.post('/api/v1/push-subscriptions', { endpoint: 'not-a-url', keys: {} })
      expect(res.status).toBe(400)
    } finally {
      t.close()
    }
  })

  it('requires authentication for both subscriptions and the VAPID key', async () => {
    const t = await createTestApp()
    try {
      expect((await t.request('/api/v1/push-subscriptions')).status).toBe(401)
      expect((await t.request('/api/v1/push/vapid-public-key')).status).toBe(401)
    } finally {
      t.close()
    }
  })
})
