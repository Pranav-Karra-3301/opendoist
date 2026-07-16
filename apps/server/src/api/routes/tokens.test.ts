import { ApiTokenSchema, CreatedApiTokenSchema } from '@opendoist/core'
import { describe, expect, it } from 'vitest'
import { createTestApp, json } from '../../test/helpers'

describe('tokens router', () => {
  it('creates a read_write token, shows the od_ value once, and authorizes a Bearer write', async () => {
    const t = await createTestApp()
    try {
      const res = await t.post('/api/v1/tokens', { name: 'CLI', scope: 'read_write' })
      expect(res.status).toBe(201)
      const created = CreatedApiTokenSchema.parse(await res.json())
      expect(created.token.startsWith('od_')).toBe(true)
      expect(created.name).toBe('CLI')
      expect(created.scope).toBe('read_write')

      // Bearer write is allowed for a read_write token.
      const write = await t.request('/api/v1/projects', {
        method: 'POST',
        headers: { authorization: `Bearer ${created.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Via token' }),
      })
      expect(write.status).toBe(201)

      // GET /tokens never returns the secret — only the id/start hint.
      const list = await json<unknown[]>(await t.get('/api/v1/tokens'))
      const tokens = list.map((x) => ApiTokenSchema.parse(x))
      expect(tokens).toHaveLength(1)
      expect(tokens[0]?.id).toBe(created.id)
      expect(Object.hasOwn(tokens[0] ?? {}, 'token')).toBe(false)
      expect(tokens[0]?.start.startsWith('od_')).toBe(true)
    } finally {
      t.close()
    }
  })

  it('read-only tokens can read but cannot write', async () => {
    const t = await createTestApp()
    try {
      const created = CreatedApiTokenSchema.parse(
        await (await t.post('/api/v1/tokens', { name: 'RO', scope: 'read' })).json(),
      )
      const bearer = { authorization: `Bearer ${created.token}` }
      const read = await t.request('/api/v1/projects', { headers: bearer })
      expect(read.status).toBe(200)
      const write = await t.request('/api/v1/projects', {
        method: 'POST',
        headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'nope' }),
      })
      expect(write.status).toBe(403)
    } finally {
      t.close()
    }
  })

  it('revokes a token: list drops it and the Bearer stops working', async () => {
    const t = await createTestApp()
    try {
      const created = CreatedApiTokenSchema.parse(
        await (await t.post('/api/v1/tokens', { name: 'Temp', scope: 'read_write' })).json(),
      )
      const del = await t.del(`/api/v1/tokens/${created.id}`)
      expect(del.status).toBe(200)
      expect(await json<{ ok: boolean }>(del)).toEqual({ ok: true })

      expect((await json<unknown[]>(await t.get('/api/v1/tokens'))).length).toBe(0)
      const afterRevoke = await t.request('/api/v1/projects', {
        headers: { authorization: `Bearer ${created.token}` },
      })
      expect(afterRevoke.status).toBe(401)
    } finally {
      t.close()
    }
  })

  it('revoking an unknown or foreign token id is a 404', async () => {
    const t = await createTestApp()
    try {
      expect((await t.del('/api/v1/tokens/does-not-exist')).status).toBe(404)
    } finally {
      t.close()
    }
  })

  it('requires authentication', async () => {
    const t = await createTestApp()
    try {
      expect((await t.request('/api/v1/tokens')).status).toBe(401)
    } finally {
      t.close()
    }
  })

  // Exercises runtime OpenAPI doc generation with the re-homed core schemas (settings/tokens/
  // activities) — a plain-zod schema that broke doc generation would surface here.
  it('documents the phase-5 routes in the OpenAPI spec', async () => {
    const t = await createTestApp()
    try {
      // openapi.json sits behind the /api/v1 auth guard (phase-3 behavior) — authenticate.
      const res = await t.get('/api/v1/openapi.json')
      expect(res.status).toBe(200)
      const text = await res.text()
      for (const frag of [
        '/tokens',
        '/activities',
        '/tasks/completed',
        '/restore',
        '/search',
        '/user/settings',
      ]) {
        expect(text.includes(frag), `openapi.json missing ${frag}`).toBe(true)
      }
    } finally {
      t.close()
    }
  })
})
