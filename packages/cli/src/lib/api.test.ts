import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMockFetch, page, sampleTask, TEST_URL } from '../test/harness'
import { ApiClient } from './api'
import { ApiError, AuthError, NetworkError } from './errors'

const TOKEN = 'od_tok'

/** Await a promise expected to reject and return the thrown value; fail if it resolves. */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject, but it resolved')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApiClient.request', () => {
  it('sends a Bearer authorization header when a token is present', async () => {
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
    ])
    await new ApiClient(TEST_URL, TOKEN).info()
    expect(calls[0]?.headers.authorization).toBe('Bearer od_tok')
  })

  it('omits the authorization header when the token is null', async () => {
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
    ])
    await new ApiClient(TEST_URL, null).info()
    expect(calls[0]?.headers.authorization).toBeUndefined()
    expect('authorization' in (calls[0]?.headers ?? {})).toBe(false)
  })

  it('serializes defined query params and drops undefined ones', async () => {
    const calls = installMockFetch([{ method: 'GET', path: '/api/v1/tasks' }])
    await new ApiClient(TEST_URL, TOKEN).request('GET', '/api/v1/tasks', {
      query: { project_id: 'p1', completed: undefined },
    })
    const url = calls[0]?.url
    expect(url?.searchParams.get('project_id')).toBe('p1')
    expect(url?.searchParams.has('completed')).toBe(false)
  })

  it('maps a 401 response to AuthError (exit code 2, login hint)', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/user', status: 401, body: { title: 'Unauthorized' } },
    ])
    const error = await captureRejection(new ApiClient(TEST_URL, TOKEN).me())
    expect(error).toBeInstanceOf(AuthError)
    const authError = error as AuthError
    expect(authError.exitCode).toBe(2)
    expect(authError.hint).toContain('opendoist login')
    // the server folds api-key rate-limit rejections into plain 401s — mention the possibility
    expect(authError.hint).toContain('rate-limiting')
  })

  it('maps a 403 response to AuthError (exit code 2)', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/user', status: 403, body: { title: 'Forbidden' } },
    ])
    const error = await captureRejection(new ApiClient(TEST_URL, TOKEN).me())
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).exitCode).toBe(2)
  })

  it('maps a JSON problem body to ApiError preserving detail, status, and problem', async () => {
    const problem = { title: 'Unprocessable', detail: 'bad due string' }
    installMockFetch([{ method: 'POST', path: '/api/v1/tasks/quick', status: 422, body: problem }])
    const error = await captureRejection(new ApiClient(TEST_URL, TOKEN).quickAdd('x'))
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.message).toContain('bad due string')
    expect(apiError.status).toBe(422)
    expect(apiError.problem).toEqual(problem)
  })

  it('handles a non-JSON error body without crashing on parse', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }),
    )
    const error = await captureRejection(new ApiClient(TEST_URL, TOKEN).me())
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.message).toContain('500')
    expect(apiError.problem).toBeNull()
  })

  it('wraps a fetch rejection in NetworkError with an offline hint', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') })
    })
    const error = await captureRejection(new ApiClient(TEST_URL, TOKEN).me())
    expect(error).toBeInstanceOf(NetworkError)
    const networkError = error as NetworkError
    expect(networkError.message).toContain(`cannot reach ${TEST_URL}`)
    expect(networkError.message).toContain('ECONNREFUSED')
    expect(networkError.hint).toContain('offline')
  })

  it('digs the real reason out of an empty-message AggregateError cause (macOS ECONNREFUSED)', async () => {
    // Node's fetch on macOS: TypeError('fetch failed') → cause AggregateError with message ''
    // whose .errors carry the per-address connect failures.
    const aggregate = Object.assign(
      new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:59999')], ''),
      { code: 'ECONNREFUSED' },
    )
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed', { cause: aggregate })
    })
    const error = await captureRejection(new ApiClient(TEST_URL, TOKEN).me())
    expect(error).toBeInstanceOf(NetworkError)
    const networkError = error as NetworkError
    expect(networkError.message).toContain('connect ECONNREFUSED 127.0.0.1:59999')
    expect(networkError.message).not.toContain('()')
  })

  it('falls back to the error code when no message exists anywhere in the cause chain', async () => {
    const aggregate = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' })
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed', { cause: aggregate })
    })
    const error = await captureRejection(new ApiClient(TEST_URL, TOKEN).me())
    expect((error as NetworkError).message).toContain(`cannot reach ${TEST_URL} (ECONNREFUSED)`)
  })

  it('falls back to "fetch failed" when the rejection carries no detail at all', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const error = await captureRejection(new ApiClient(TEST_URL, TOKEN).me())
    expect(error).toBeInstanceOf(NetworkError)
    expect((error as NetworkError).message).toContain(`cannot reach ${TEST_URL} (fetch failed)`)
  })

  it('maps a 200 non-JSON body to ApiError instead of leaking a JSON.parse SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<!doctype html><html><body>catch-all SPA</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    )
    const error = await captureRejection(new ApiClient(TEST_URL, TOKEN).info())
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(200)
    expect(apiError.message).toContain('non-JSON body')
    expect(apiError.message).toContain('not an OpenDoist server')
    expect(apiError.message).not.toContain('Unexpected token')
  })

  it('resolves undefined on a 204 No Content response', async () => {
    installMockFetch([{ method: 'POST', path: '/api/v1/tasks/tsk_1/close', status: 204 }])
    const result = await new ApiClient(TEST_URL, TOKEN).closeTask('tsk_1')
    expect(result).toBeUndefined()
  })
})

describe('ApiClient resource methods', () => {
  it('drains cursor pagination across pages, resolving the flattened results', async () => {
    const t1 = sampleTask({ id: 'tsk_1' })
    const t2 = sampleTask({ id: 'tsk_2' })
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/tasks', once: true, body: page([t1], 'cur2') },
      {
        method: 'GET',
        path: '/api/v1/tasks',
        once: true,
        query: { cursor: 'cur2' },
        body: page([t2], null),
      },
    ])
    const tasks = await new ApiClient(TEST_URL, TOKEN).listTasks()
    expect(tasks).toEqual([t1, t2])
    expect(calls).toHaveLength(2)
  })

  it('quickAdd posts a JSON body of { text } with a content-type header', async () => {
    const calls = installMockFetch([
      { method: 'POST', path: '/api/v1/tasks/quick', body: sampleTask() },
    ])
    await new ApiClient(TEST_URL, TOKEN).quickAdd('x')
    expect(calls[0]?.headers['content-type']).toBe('application/json')
    expect(calls[0]?.body).toEqual({ text: 'x' })
  })

  it('settings() GETs the /user/settings document', async () => {
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/user/settings', body: { timezone: 'Europe/Berlin' } },
    ])
    const settings = await new ApiClient(TEST_URL, TOKEN).settings()
    expect(settings.timezone).toBe('Europe/Berlin')
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['GET /api/v1/user/settings'])
  })
})
