import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, getEncryptionKey } from './secret-crypto'

const KEY = randomBytes(32)

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret with an explicit key', () => {
    const envelope = encryptSecret('sk-super-secret-123', KEY)
    expect(decryptSecret(envelope, KEY)).toBe('sk-super-secret-123')
  })

  it('round-trips empty and unicode strings', () => {
    expect(decryptSecret(encryptSecret('', KEY), KEY)).toBe('')
    expect(decryptSecret(encryptSecret('clé-😀-ключ', KEY), KEY)).toBe('clé-😀-ключ')
  })

  it('produces the v1:<iv>:<tag>:<ct> base64 envelope', () => {
    const envelope = encryptSecret('hello', KEY)
    expect(envelope).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/)
    expect(envelope.split(':')).toHaveLength(4)
  })

  it('uses a fresh IV so two encryptions of the same plaintext differ', () => {
    const a = encryptSecret('same-plaintext', KEY)
    const b = encryptSecret('same-plaintext', KEY)
    expect(a).not.toBe(b)
    expect(decryptSecret(a, KEY)).toBe('same-plaintext')
    expect(decryptSecret(b, KEY)).toBe('same-plaintext')
  })

  it('throws when a ciphertext byte is flipped (auth-tag failure)', () => {
    const parts = encryptSecret('tamper-me', KEY).split(':')
    const ct = Buffer.from(parts[3] ?? '', 'base64')
    ct[0] = (ct[0] ?? 0) ^ 0xff
    parts[3] = ct.toString('base64')
    expect(() => decryptSecret(parts.join(':'), KEY)).toThrow()
  })

  it('throws when decrypting with the wrong key', () => {
    const envelope = encryptSecret('secret', KEY)
    expect(() => decryptSecret(envelope, randomBytes(32))).toThrow()
  })

  it('throws on an unrecognized prefix', () => {
    const envelope = encryptSecret('secret', KEY)
    expect(() => decryptSecret(envelope.replace(/^v1:/, 'v2:'), KEY)).toThrow('unrecognized format')
  })

  it('throws on a malformed envelope (wrong segment count)', () => {
    expect(() => decryptSecret('v1:onlyone', KEY)).toThrow('unrecognized format')
    expect(() => decryptSecret('v1:a:b:c:d', KEY)).toThrow('unrecognized format')
  })
})

describe('getEncryptionKey', () => {
  const originalDataDir = process.env.OPENDOIST_DATA_DIR
  const dirs: string[] = []

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.OPENDOIST_DATA_DIR
    else process.env.OPENDOIST_DATA_DIR = originalDataDir
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function writeSecretsFixture(encryptionKey: string): void {
    const dir = mkdtempSync(join(tmpdir(), 'opendoist-key-'))
    dirs.push(dir)
    writeFileSync(
      join(dir, 'secrets.json'),
      JSON.stringify({
        sessionSecret: 'a'.repeat(43),
        vapidPublicKey: 'pub',
        vapidPrivateKey: 'priv',
        encryptionKey,
      }),
    )
    process.env.OPENDOIST_DATA_DIR = dir
  }

  it('decodes the base64url encryptionKey to the exact 32 bytes', () => {
    const known = randomBytes(32)
    writeSecretsFixture(known.toString('base64url'))
    expect(getEncryptionKey().equals(known)).toBe(true)
  })

  it('throws when the stored key does not decode to 32 bytes', () => {
    // A 16-byte value hex-encoded is 32 chars: it passes the secrets min-length check but
    // base64url-decodes to 24 bytes — exactly the hex/base64url confusion the guard rejects.
    writeSecretsFixture(randomBytes(16).toString('hex'))
    expect(() => getEncryptionKey()).toThrow(/32 bytes/)
  })

  it('encrypt/decrypt default to the data-dir key when none is passed', () => {
    writeSecretsFixture(randomBytes(32).toString('base64url'))
    expect(decryptSecret(encryptSecret('via-default-key'))).toBe('via-default-key')
  })
})
