import { describe, expect, test } from 'vitest'
import { findLegacyEnv, loadConfig } from './config'

describe('loadConfig defaults', () => {
  test('empty env yields the documented defaults', () => {
    const c = loadConfig({})
    expect(c.port).toBe(7968)
    expect(c.dataDir).toBe('/data')
    expect(c.uploadMaxMb).toBe(25)
    expect(c.backupRetention).toBe(14)
    expect(c.backupCron).toBe('0 3 * * *')
    expect(c.version.endsWith('-dev')).toBe(true)
    expect(c.publicUrl).toBeNull()
    expect(c.webDistDir).toBeNull()
    expect(c.allowRegistration).toBe(false)
    expect(c.disableUpdateCheck).toBe(false)
    expect(c.logLevel).toBe('info')
    expect(c.trustProxy).toBe(false)
    expect(c.backupIncludeAttachments).toBe(true)
    expect(c.oidc).toBeNull()
    expect(c.stt).toBeNull()
    expect(c.llm).toBeNull()
  })
})

describe('loadConfig overrides', () => {
  test('a full env round-trips every field', () => {
    const c = loadConfig({
      OPENTASK_PUBLIC_URL: 'https://tasks.example.com',
      OPENTASK_PORT: '8080',
      OPENTASK_DATA_DIR: '/custom/data',
      OPENTASK_WEB_DIST: '/custom/web',
      OPENTASK_ALLOW_REGISTRATION: 'true',
      OPENTASK_DISABLE_UPDATE_CHECK: 'yes',
      OPENTASK_LOG_LEVEL: 'debug',
      OPENTASK_TRUST_PROXY: '1',
      OPENTASK_UPLOAD_MAX_MB: '50',
      OPENTASK_BACKUP_RETENTION: '30',
      OPENTASK_BACKUP_INCLUDE_ATTACHMENTS: 'false',
      OPENTASK_BACKUP_CRON: '0 4 * * *',
      OPENTASK_VERSION: '1.2.3',
    })
    expect(c).toMatchObject({
      publicUrl: 'https://tasks.example.com',
      port: 8080,
      dataDir: '/custom/data',
      webDistDir: '/custom/web',
      allowRegistration: true,
      disableUpdateCheck: true,
      logLevel: 'debug',
      trustProxy: true,
      uploadMaxMb: 50,
      backupRetention: 30,
      backupIncludeAttachments: false,
      backupCron: '0 4 * * *',
      version: '1.2.3',
    })
  })

  test('OPENTASK_TRUST_PROXY truthiness table (1/true/yes case-insensitive)', () => {
    for (const v of ['1', 'true', 'yes', 'TRUE', 'Yes', 'YES']) {
      expect(loadConfig({ OPENTASK_TRUST_PROXY: v }).trustProxy, v).toBe(true)
    }
    for (const v of ['0', 'false', 'no', 'off', '']) {
      expect(loadConfig({ OPENTASK_TRUST_PROXY: v }).trustProxy, v).toBe(false)
    }
  })
})

describe('loadConfig OIDC', () => {
  test('materializes only when issuer + client id + secret are all present', () => {
    expect(loadConfig({ OPENTASK_OIDC_ISSUER: 'https://id.example.com' }).oidc).toBeNull()
    expect(
      loadConfig({
        OPENTASK_OIDC_ISSUER: 'https://id.example.com',
        OPENTASK_OIDC_CLIENT_ID: 'client',
      }).oidc,
    ).toBeNull()

    const full = loadConfig({
      OPENTASK_OIDC_ISSUER: 'https://id.example.com',
      OPENTASK_OIDC_CLIENT_ID: 'client',
      OPENTASK_OIDC_CLIENT_SECRET: 'secret',
    })
    expect(full.oidc).toEqual({
      issuer: 'https://id.example.com',
      clientId: 'client',
      clientSecret: 'secret',
      name: 'OIDC',
    })

    const named = loadConfig({
      OPENTASK_OIDC_ISSUER: 'https://id.example.com',
      OPENTASK_OIDC_CLIENT_ID: 'client',
      OPENTASK_OIDC_CLIENT_SECRET: 'secret',
      OPENTASK_OIDC_NAME: 'Corp SSO',
    })
    expect(named.oidc?.name).toBe('Corp SSO')
  })
})

describe('loadConfig validation', () => {
  test('a non-numeric port fails zod validation', () => {
    expect(() => loadConfig({ OPENTASK_PORT: 'abc' })).toThrow()
  })
})

describe('legacy OPENDOIST_* fallback', () => {
  test('legacy names load when the OPENTASK_* spelling is unset', () => {
    const c = loadConfig({
      OPENDOIST_PORT: '9000',
      OPENDOIST_DATA_DIR: '/legacy/data',
      OPENDOIST_TRUST_PROXY: 'true',
      OPENDOIST_STT_PROVIDER: 'whisper',
      OPENDOIST_OIDC_ISSUER: 'https://id.example.com',
      OPENDOIST_OIDC_CLIENT_ID: 'cid',
      OPENDOIST_OIDC_CLIENT_SECRET: 'sec',
    })
    expect(c.port).toBe(9000)
    expect(c.dataDir).toBe('/legacy/data')
    expect(c.trustProxy).toBe(true)
    expect(c.stt?.provider).toBe('whisper')
    expect(c.oidc?.issuer).toBe('https://id.example.com')
  })

  test('OPENTASK_* wins over a legacy value for the same setting', () => {
    const c = loadConfig({ OPENTASK_PORT: '8001', OPENDOIST_PORT: '9000' })
    expect(c.port).toBe(8001)
  })

  test('findLegacyEnv lists only OPENDOIST_* keys, sorted', () => {
    expect(
      findLegacyEnv({ OPENDOIST_PORT: '1', OPENTASK_PORT: '2', PATH: '/bin', OPENDOIST_A: 'x' }),
    ).toEqual(['OPENDOIST_A', 'OPENDOIST_PORT'])
    expect(findLegacyEnv({ OPENTASK_PORT: '2' })).toEqual([])
  })
})
