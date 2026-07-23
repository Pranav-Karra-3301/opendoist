import { Hono } from 'hono'
import { describe, expect, test } from 'vitest'
import { problem } from './problem'

describe('problem()', () => {
  test('emits an RFC 9457 application/problem+json document', async () => {
    const app = new Hono()
    app.get('/x', (c) => problem(c, 404, 'not found', 'task missing'))

    const res = await app.request('/x')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/problem+json')

    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      type: 'https://opentask.dev/problems/not-found',
      title: 'not found',
      status: 404,
      detail: 'task missing',
    })
  })

  test('merges extra members and omits detail when absent', async () => {
    const app = new Hono()
    app.get('/x', (c) => problem(c, 400, 'invalid filter query', undefined, { position: 6 }))

    const res = await app.request('/x')
    expect(res.status).toBe(400)

    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      type: 'https://opentask.dev/problems/invalid-filter-query',
      title: 'invalid filter query',
      status: 400,
      position: 6,
    })
    expect('detail' in body).toBe(false)
  })
})
