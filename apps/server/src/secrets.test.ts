import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { ensureDataDirAndSecrets, getOrCreateVapidKeys, type Secrets } from './secrets'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'od-secrets-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('ensureDataDirAndSecrets', () => {
  test('creates data subdirs and a mode-0600 secrets.json with all four keys', () => {
    const dir = tmp()
    const secrets = ensureDataDirAndSecrets(dir)

    expect(statSync(join(dir, 'attachments')).isDirectory()).toBe(true)
    expect(statSync(join(dir, 'backups')).isDirectory()).toBe(true)

    const file = join(dir, 'secrets.json')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(Object.keys(secrets).sort()).toEqual([
      'encryptionKey',
      'sessionSecret',
      'vapidPrivateKey',
      'vapidPublicKey',
    ])

    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Secrets
    expect(onDisk).toEqual(secrets)
  })

  test('VAPID keys are raw P-256 material (65-byte 0x04 public, 32-byte private)', () => {
    const secrets = ensureDataDirAndSecrets(tmp())
    const pub = Buffer.from(secrets.vapidPublicKey, 'base64url')
    expect(pub.length).toBe(65)
    expect(pub[0]).toBe(0x04)
    expect(Buffer.from(secrets.vapidPrivateKey, 'base64url').length).toBe(32)
  })

  test('is idempotent — a second call returns identical values', () => {
    const dir = tmp()
    const first = ensureDataDirAndSecrets(dir)
    const second = ensureDataDirAndSecrets(dir)
    expect(second).toEqual(first)
  })

  test('preserves a pre-seeded key and fills only the missing ones', () => {
    const dir = tmp()
    const sessionSecret = 'a'.repeat(43)
    writeFileSync(join(dir, 'secrets.json'), JSON.stringify({ sessionSecret }))

    const secrets = ensureDataDirAndSecrets(dir)
    expect(secrets.sessionSecret).toBe(sessionSecret)
    expect(secrets.encryptionKey.length).toBeGreaterThanOrEqual(32)
    expect(secrets.vapidPublicKey).not.toHaveLength(0)
    expect(secrets.vapidPrivateKey).not.toHaveLength(0)
  })
})

describe('getOrCreateVapidKeys', () => {
  test('returns the persisted flat vapid fields and never regenerates them', () => {
    const dir = tmp()
    const first = ensureDataDirAndSecrets(dir)
    const bytesBefore = readFileSync(join(dir, 'secrets.json'), 'utf8')

    const a = getOrCreateVapidKeys({ dataDir: dir, publicUrl: null })
    const b = getOrCreateVapidKeys({ dataDir: dir, publicUrl: null })
    expect(a.publicKey).toBe(first.vapidPublicKey)
    expect(a.privateKey).toBe(first.vapidPrivateKey)
    expect(b.publicKey).toBe(a.publicKey)
    expect(b.privateKey).toBe(a.privateKey)
    // secrets.json is byte-identical — the key fields were not rewritten with new values
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).toBe(bytesBefore)
  })

  test('subject is publicUrl when https, mailto fallback otherwise (never persisted)', () => {
    const dir = tmp()
    expect(
      getOrCreateVapidKeys({ dataDir: dir, publicUrl: 'https://tasks.example.com' }).subject,
    ).toBe('https://tasks.example.com')
    expect(getOrCreateVapidKeys({ dataDir: dir, publicUrl: 'http://localhost:7968' }).subject).toBe(
      'mailto:admin@opentask.local',
    )
    expect(getOrCreateVapidKeys({ dataDir: dir, publicUrl: null }).subject).toBe(
      'mailto:admin@opentask.local',
    )
    const onDisk = JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')) as Record<
      string,
      string
    >
    expect(Object.keys(onDisk).sort()).toEqual([
      'encryptionKey',
      'sessionSecret',
      'vapidPrivateKey',
      'vapidPublicKey',
    ])
  })
})
