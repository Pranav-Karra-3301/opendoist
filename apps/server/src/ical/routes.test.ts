import { dateInTz } from '@opentask/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, json, seedTask, type TestApp } from '../reminders/test-helpers'

interface TokenDto {
  token: string
  url: string
  webcal_url: string
  created_at: string
}

let app: TestApp

beforeAll(async () => {
  app = await createTestApp()
  // The signup user's settings default to UTC, so the feed window is centred on the UTC date.
  const today = dateInTz(new Date().toISOString(), 'UTC')
  const now = new Date().toISOString()
  await seedTask(app.deps.db, app.userId, { content: 'Pay rent', dueDate: today, dueTime: '17:00' })
  await seedTask(app.deps.db, app.userId, {
    content: 'Done task',
    dueDate: today,
    completedAt: now,
  })
  await seedTask(app.deps.db, app.userId, { content: 'Gone task', dueDate: today, deletedAt: now })
})

afterAll(() => app.close())

/** Current token for the signup user (GET auto-creates and is idempotent). */
async function currentToken(): Promise<TokenDto> {
  const res = await app.get('/api/v1/ical-token')
  expect(res.status).toBe(200)
  return json<TokenDto>(res)
}

describe('ical token API', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/v1/ical-token')
    expect(res.status).toBe(401)
  })

  it('auto-creates a 32-char token with https + webcal URLs on first GET', async () => {
    const dto = await currentToken()
    expect(dto.token).toHaveLength(32)
    expect(dto.url).toBe(`http://localhost:7968/ical/${dto.token}/tasks.ics`)
    expect(dto.webcal_url).toBe(`webcal://localhost:7968/ical/${dto.token}/tasks.ics`)
    expect(typeof dto.created_at).toBe('string')
  })

  it('returns the same token on repeated GETs (idempotent create)', async () => {
    const a = await currentToken()
    const b = await currentToken()
    expect(b.token).toBe(a.token)
  })

  it('rotate issues a fresh token and invalidates the old feed URL', async () => {
    const before = await currentToken()

    const rotRes = await app.post('/api/v1/ical-token/rotate')
    expect(rotRes.status).toBe(200)
    const after = await json<TokenDto>(rotRes)
    expect(after.token).not.toBe(before.token)
    expect(after.token).toHaveLength(32)

    // old token → 404, new token → 200
    expect((await app.request(`/ical/${before.token}/tasks.ics`)).status).toBe(404)
    expect((await app.request(`/ical/${after.token}/tasks.ics`)).status).toBe(200)
  })
})

describe('ical public feed', () => {
  it('serves text/calendar with an ETag and Cache-Control, no auth required', async () => {
    const { token } = await currentToken()
    const res = await app.request(`/ical/${token}/tasks.ics`) // no cookie → public
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    expect(res.headers.get('etag')).toMatch(/^"sha256-[0-9a-f]{32}"$/)

    const body = await res.text()
    expect(body).toContain('BEGIN:VCALENDAR')
    expect(body).toContain('SUMMARY:Pay rent')
  })

  it('excludes completed and deleted tasks', async () => {
    const { token } = await currentToken()
    const body = await (await app.request(`/ical/${token}/tasks.ics`)).text()
    expect(body).not.toContain('Done task')
    expect(body).not.toContain('Gone task')
  })

  it('returns 304 with the same ETag when If-None-Match matches', async () => {
    const { token } = await currentToken()
    const first = await app.request(`/ical/${token}/tasks.ics`)
    const etag = first.headers.get('etag')
    expect(etag).not.toBeNull()

    const second = await app.request(`/ical/${token}/tasks.ics`, {
      headers: { 'if-none-match': etag as string },
    })
    expect(second.status).toBe(304)
    expect(second.headers.get('etag')).toBe(etag)
    expect(second.headers.get('cache-control')).toBe('private, max-age=300')
    expect(await second.text()).toBe('')
  })

  it('returns a 404 problem document for an unknown token (never 401)', async () => {
    const res = await app.request('/ical/definitely-not-a-real-token/tasks.ics')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
  })
})
