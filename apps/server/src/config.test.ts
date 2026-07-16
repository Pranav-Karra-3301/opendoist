import { describe, expect, test } from 'vitest'
import { loadConfig } from './config'

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
      OPENDOIST_PUBLIC_URL: 'https://tasks.example.com',
      OPENDOIST_PORT: '8080',
      OPENDOIST_DATA_DIR: '/custom/data',
      OPENDOIST_WEB_DIST: '/custom/web',
      OPENDOIST_ALLOW_REGISTRATION: 'true',
      OPENDOIST_DISABLE_UPDATE_CHECK: 'yes',
      OPENDOIST_LOG_LEVEL: 'debug',
      OPENDOIST_TRUST_PROXY: '1',
      OPENDOIST_UPLOAD_MAX_MB: '50',
      OPENDOIST_BACKUP_RETENTION: '30',
      OPENDOIST_BACKUP_INCLUDE_ATTACHMENTS: 'false',
      OPENDOIST_BACKUP_CRON: '0 4 * * *',
      OPENDOIST_VERSION: '1.2.3',
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

  test('OPENDOIST_TRUST_PROXY truthiness table (1/true/yes case-insensitive)', () => {
    for (const v of ['1', 'true', 'yes', 'TRUE', 'Yes', 'YES']) {
      expect(loadConfig({ OPENDOIST_TRUST_PROXY: v }).trustProxy, v).toBe(true)
    }
    for (const v of ['0', 'false', 'no', 'off', '']) {
      expect(loadConfig({ OPENDOIST_TRUST_PROXY: v }).trustProxy, v).toBe(false)
    }
  })
})

describe('loadConfig OIDC', () => {
  test('materializes only when issuer + client id + secret are all present', () => {
    expect(loadConfig({ OPENDOIST_OIDC_ISSUER: 'https://id.example.com' }).oidc).toBeNull()
    expect(
      loadConfig({
        OPENDOIST_OIDC_ISSUER: 'https://id.example.com',
        OPENDOIST_OIDC_CLIENT_ID: 'client',
      }).oidc,
    ).toBeNull()

    const full = loadConfig({
      OPENDOIST_OIDC_ISSUER: 'https://id.example.com',
      OPENDOIST_OIDC_CLIENT_ID: 'client',
      OPENDOIST_OIDC_CLIENT_SECRET: 'secret',
    })
    expect(full.oidc).toEqual({
      issuer: 'https://id.example.com',
      clientId: 'client',
      clientSecret: 'secret',
      name: 'OIDC',
    })

    const named = loadConfig({
      OPENDOIST_OIDC_ISSUER: 'https://id.example.com',
      OPENDOIST_OIDC_CLIENT_ID: 'client',
      OPENDOIST_OIDC_CLIENT_SECRET: 'secret',
      OPENDOIST_OIDC_NAME: 'Corp SSO',
    })
    expect(named.oidc?.name).toBe('Corp SSO')
  })
})

describe('loadConfig validation', () => {
  test('a non-numeric port fails zod validation', () => {
    expect(() => loadConfig({ OPENDOIST_PORT: 'abc' })).toThrow()
  })
})
