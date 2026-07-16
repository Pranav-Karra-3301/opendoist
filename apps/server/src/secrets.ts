import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const SecretsSchema = z.object({
  sessionSecret: z.string().min(32),
  vapidPublicKey: z.string(),
  vapidPrivateKey: z.string(),
  encryptionKey: z.string().min(32),
})
export type Secrets = z.infer<typeof SecretsSchema>

function generateVapid(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ format: 'jwk' })
  const priv = privateKey.export({ format: 'jwk' })
  const b64uToBuf = (s: string) => Buffer.from(s, 'base64url')
  const raw = Buffer.concat([
    Buffer.from([4]),
    b64uToBuf(pub.x as string),
    b64uToBuf(pub.y as string),
  ])
  return {
    publicKey: raw.toString('base64url'),
    privateKey: b64uToBuf(priv.d as string).toString('base64url'),
  }
}

/** Creates dataDir (+ attachments/, backups/) and loads-or-creates secrets.json (mode 600). */
export function ensureDataDirAndSecrets(dataDir: string): Secrets {
  mkdirSync(join(dataDir, 'attachments'), { recursive: true })
  mkdirSync(join(dataDir, 'backups'), { recursive: true })
  const file = join(dataDir, 'secrets.json')
  const existing: Partial<Secrets> = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<Secrets>)
    : {}
  const vapid =
    existing.vapidPublicKey && existing.vapidPrivateKey
      ? { publicKey: existing.vapidPublicKey, privateKey: existing.vapidPrivateKey }
      : generateVapid()
  const secrets = SecretsSchema.parse({
    sessionSecret: existing.sessionSecret ?? randomBytes(32).toString('base64url'),
    vapidPublicKey: vapid.publicKey,
    vapidPrivateKey: vapid.privateKey,
    encryptionKey: existing.encryptionKey ?? randomBytes(32).toString('base64url'),
  })
  writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
  return secrets
}
