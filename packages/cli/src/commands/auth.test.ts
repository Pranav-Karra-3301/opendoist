import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readConfigFile, writeConfigFile } from '../lib/config'
import { systemTimezone } from '../lib/context'
import { prompter } from '../lib/prompt'
import { installMockFetch, runCli, stubAuthEnv, TEST_URL } from '../test/harness'

const USER = { id: 'usr_1', email: 'ada@example.com', name: 'Ada' }
/** Settings document whose timezone matches this machine — the no-warning baseline. */
const SETTINGS_ROUTE = {
  method: 'GET',
  path: '/api/v1/user/settings',
  body: { timezone: systemTimezone() },
}

let scratch: string
let configPath: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'od-cli-auth-'))
  configPath = join(scratch, 'config.json')
  // login/logout must run UNauthenticated: clear env creds, point config at scratch.
  vi.stubEnv('OPENTASK_CONFIG_PATH', configPath)
  vi.stubEnv('OPENTASK_URL', '')
  vi.stubEnv('OPENTASK_TOKEN', '')
  vi.stubEnv('NO_COLOR', '1')
  vi.stubEnv('FORCE_COLOR', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

describe('opentask login', () => {
  it('probes /info then /user, saves the config, and greets (interactive)', async () => {
    const calls = installMockFetch([
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
      { method: 'GET', path: '/api/v1/user', body: USER },
      SETTINGS_ROUTE,
    ])
    vi.spyOn(prompter, 'ask').mockResolvedValueOnce(TEST_URL).mockResolvedValueOnce('ot_livetoken')

    const run = await runCli(['login'])

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('✓ logged in')
    expect(run.stdout).toContain('ada@example.com')
    expect(run.stdout).toContain('OpenTask v0.1.0')
    expect(run.stdout).toContain(`config: ${configPath} (0600)`)
    // matching timezones → no advisory
    expect(run.stderr).not.toContain('account timezone')
    // credentials persisted
    expect(readConfigFile()).toEqual({ url: TEST_URL, token: 'ot_livetoken' })
    // probe order: unauthenticated /info, then authenticated /user + /user/settings
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /api/v1/info',
      'GET /api/v1/user',
      'GET /api/v1/user/settings',
    ])
    expect(calls[0]?.headers.authorization).toBeUndefined()
    expect(calls[1]?.headers.authorization).toBe('Bearer ot_livetoken')
    expect(calls[2]?.headers.authorization).toBe('Bearer ot_livetoken')
  })

  it('accepts --url and --token flags without prompting', async () => {
    const ask = vi.spyOn(prompter, 'ask')
    installMockFetch([
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
      { method: 'GET', path: '/api/v1/user', body: USER },
    ])

    const run = await runCli(['login', '--url', TEST_URL, '--token', 'ot_flagtoken'])

    expect(run.code).toBe(0)
    expect(ask).not.toHaveBeenCalled()
    expect(readConfigFile()?.token).toBe('ot_flagtoken')
  })

  it('warns about a non-ot_ token but still proceeds', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
      { method: 'GET', path: '/api/v1/user', body: USER },
    ])

    const run = await runCli(['login', '--url', TEST_URL, '--token', 'plaintoken'])

    expect(run.code).toBe(0)
    expect(run.stderr).toContain('warning')
    expect(readConfigFile()?.token).toBe('plaintoken')
  })

  it('fails with a usage error (exit 1) when the url is empty', async () => {
    vi.spyOn(prompter, 'ask').mockResolvedValueOnce('').mockResolvedValueOnce('ot_token')

    const run = await runCli(['login'])

    expect(run.code).toBe(1)
    expect(run.stderr).toContain('error:')
    expect(readConfigFile()).toBeNull()
  })

  it('exits 2 when the server rejects the token (401)', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
      { method: 'GET', path: '/api/v1/user', status: 401, body: { title: 'unauthorized' } },
    ])
    vi.spyOn(prompter, 'ask').mockResolvedValueOnce(TEST_URL).mockResolvedValueOnce('ot_badtoken')

    const run = await runCli(['login'])

    expect(run.code).toBe(2)
    // nothing persisted on a failed validation
    expect(readConfigFile()).toBeNull()
  })

  it('exits 1 against a server that is not OpenTask', async () => {
    installMockFetch([{ method: 'GET', path: '/api/v1/info', body: {} }])
    vi.spyOn(prompter, 'ask').mockResolvedValueOnce(TEST_URL).mockResolvedValueOnce('ot_token')

    const run = await runCli(['login'])

    expect(run.code).toBe(1)
    expect(run.stderr).toContain('does not look like')
    expect(readConfigFile()).toBeNull()
  })

  it('rejects a URL whose 200 response is HTML (SPA catch-all) without leaking a SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<!doctype html><html><body>some other website</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    )

    const run = await runCli(['login', '--url', TEST_URL, '--token', 'ot_token'])

    expect(run.code).toBe(1)
    expect(run.stderr).toContain('does not look like an OpenTask server')
    expect(run.stderr).toContain('hint:')
    expect(run.stderr).not.toContain('Unexpected token')
    expect(readConfigFile()).toBeNull()
  })

  it('warns when the account timezone differs from the system timezone', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
      { method: 'GET', path: '/api/v1/user', body: USER },
      // never a real machine's zone — API-registered accounts default to 'UTC' server-side
      { method: 'GET', path: '/api/v1/user/settings', body: { timezone: 'Pacific/Kiritimati' } },
    ])

    const run = await runCli(['login', '--url', TEST_URL, '--token', 'ot_token'])

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('✓ logged in')
    expect(run.stderr).toContain("account timezone 'Pacific/Kiritimati'")
    expect(run.stderr).toContain(`'${systemTimezone()}'`)
    expect(run.stderr).toContain('quick-add')
    // advisory only — credentials still persisted
    expect(readConfigFile()?.token).toBe('ot_token')
  })

  it('still logs in cleanly when the settings endpoint is unavailable', async () => {
    // no /user/settings mock → the harness answers 404; the advisory is skipped, login succeeds
    installMockFetch([
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
      { method: 'GET', path: '/api/v1/user', body: USER },
    ])

    const run = await runCli(['login', '--url', TEST_URL, '--token', 'ot_token'])

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('✓ logged in')
    expect(run.stderr).not.toContain('account timezone')
    expect(readConfigFile()?.token).toBe('ot_token')
  })

  it('--json emits ok:true with url, version, user, config_path', async () => {
    installMockFetch([
      { method: 'GET', path: '/api/v1/info', body: { version: '0.2.0' } },
      { method: 'GET', path: '/api/v1/user', body: USER },
    ])
    vi.spyOn(prompter, 'ask').mockResolvedValueOnce(TEST_URL).mockResolvedValueOnce('ot_token')

    const run = await runCli(['--json', 'login'])

    expect(run.code).toBe(0)
    const parsed = JSON.parse(run.stdout)
    expect(parsed).toEqual({
      ok: true,
      url: TEST_URL,
      version: '0.2.0',
      user: USER,
      config_path: configPath,
    })
  })
})

describe('opentask logout', () => {
  it('removes the saved config (exit 0)', async () => {
    writeConfigFile({ url: TEST_URL, token: 'ot_token' })

    const run = await runCli(['logout'])

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('logged out')
    expect(run.stdout).toContain(configPath)
    expect(readConfigFile()).toBeNull()
  })

  it('reports removed:false via --json when nothing is saved', async () => {
    const run = await runCli(['--json', 'logout'])

    expect(run.code).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({ ok: true, removed: false })
  })

  it('reports no saved credentials in human mode when absent', async () => {
    const run = await runCli(['logout'])

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('no saved credentials')
  })

  it('notes a lingering OPENTASK_TOKEN env var', async () => {
    vi.stubEnv('OPENTASK_TOKEN', 'ot_env')

    const run = await runCli(['logout'])

    expect(run.stderr).toContain('OPENTASK_TOKEN is still set')
  })
})

describe('opentask whoami', () => {
  it('reports the user, server, and env credential source (--json)', async () => {
    stubAuthEnv()
    installMockFetch([
      { method: 'GET', path: '/api/v1/user', body: USER },
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
    ])

    const run = await runCli(['--json', 'whoami'])

    expect(run.code).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({
      url: TEST_URL,
      version: '0.1.0',
      token_source: 'env',
      user: USER,
    })
  })

  it('prints email, server, and credential source in human mode', async () => {
    stubAuthEnv()
    installMockFetch([
      { method: 'GET', path: '/api/v1/user', body: USER },
      { method: 'GET', path: '/api/v1/info', body: { version: '0.1.0' } },
    ])

    const run = await runCli(['whoami'])

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('ada@example.com (Ada)')
    expect(run.stdout).toContain(`server: ${TEST_URL} — OpenTask v0.1.0`)
    expect(run.stdout).toContain('credentials: env')
  })

  it('exits 2 when no credentials exist anywhere', async () => {
    const run = await runCli(['whoami'])

    expect(run.code).toBe(2)
    expect(run.stderr).toContain('not logged in')
  })
})
