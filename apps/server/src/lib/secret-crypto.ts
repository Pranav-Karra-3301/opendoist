import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { loadConfig } from '../config'
import { ensureDataDirAndSecrets } from '../secrets'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const ENVELOPE_VERSION = 'v1'

/**
 * The 32-byte AES key backing `encryptSecret`/`decryptSecret`, decoded from the phase-3
 * `encryptionKey` secret (`randomBytes(32).toString('base64url')`, written once at first boot and
 * preserved on every later boot). Read through the sole sanctioned accessor
 * `ensureDataDirAndSecrets` — the same read-through-create pattern `getOrCreateVapidKeys` uses —
 * which NEVER regenerates the field. Decoded as base64url (NEVER hex: hex-decoding a base64url
 * string silently truncates at the first non-hex char and yields a short, wrong key). Asserts the
 * result is exactly 32 bytes so a mis-encoded/short secret fails loudly instead of weakening AES.
 */
export function getEncryptionKey(): Buffer {
  const { encryptionKey } = ensureDataDirAndSecrets(loadConfig().dataDir)
  const key = Buffer.from(encryptionKey, 'base64url')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `encryptionKey must decode to ${KEY_BYTES} bytes but decoded to ${key.length}; ` +
        'it must be a base64url-encoded 32-byte value',
    )
  }
  return key
}

/**
 * AES-256-GCM encrypt `plaintext` into the self-describing envelope
 * `v1:<iv b64>:<tag b64>:<ciphertext b64>` with a fresh random 12-byte IV per call (so two
 * encryptions of the same plaintext differ). `key` defaults to `getEncryptionKey()`; tests pass an
 * explicit 32-byte key to avoid touching the data dir.
 */
export function encryptSecret(plaintext: string, key: Buffer = getEncryptionKey()): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENVELOPE_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

/**
 * Inverse of `encryptSecret`. Throws on an unrecognized prefix/format, a malformed IV or auth tag,
 * a tampered ciphertext (GCM auth-tag failure), or the wrong key.
 */
export function decryptSecret(envelope: string, key: Buffer = getEncryptionKey()): string {
  const [prefix, ivB64, tagB64, ctB64, ...rest] = envelope.split(':')
  if (
    prefix !== ENVELOPE_VERSION ||
    ivB64 === undefined ||
    tagB64 === undefined ||
    ctB64 === undefined ||
    rest.length > 0
  ) {
    throw new Error('secret envelope: unrecognized format')
  }
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('secret envelope: malformed iv or auth tag')
  }
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
