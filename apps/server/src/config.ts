import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const bool = (v: string | undefined, dflt: boolean) =>
  v === undefined ? dflt : ['1', 'true', 'yes'].includes(v.toLowerCase())

export const ConfigSchema = z.object({
  publicUrl: z.string().url().nullable(),
  port: z.number().int().min(1).max(65535),
  dataDir: z.string().min(1),
  webDistDir: z.string().nullable(),
  allowRegistration: z.boolean(),
  disableUpdateCheck: z.boolean(),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  trustProxy: z.boolean(),
  uploadMaxMb: z.number().int().min(1),
  backupRetention: z.number().int().min(1),
  backupIncludeAttachments: z.boolean(),
  backupCron: z.string(),
  oidc: z
    .object({
      issuer: z.string(),
      clientId: z.string(),
      clientSecret: z.string(),
      name: z.string(),
    })
    .nullable(),
  stt: z
    .object({
      provider: z.string(),
      baseUrl: z.string().nullable(),
      model: z.string().nullable(),
      apiKey: z.string().nullable(),
    })
    .nullable(),
  llm: z
    .object({
      provider: z.string(),
      baseUrl: z.string().nullable(),
      model: z.string().nullable(),
      apiKey: z.string().nullable(),
    })
    .nullable(),
  version: z.string(),
})
export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as {
    version: string
  }
  const o = (k: string) => env[`OPENDOIST_OIDC_${k}`]
  const oidc =
    o('ISSUER') && o('CLIENT_ID') && o('CLIENT_SECRET')
      ? {
          issuer: o('ISSUER') as string,
          clientId: o('CLIENT_ID') as string,
          clientSecret: o('CLIENT_SECRET') as string,
          name: o('NAME') ?? 'OIDC',
        }
      : null
  const ai = (p: 'STT' | 'LLM') =>
    env[`OPENDOIST_${p}_PROVIDER`]
      ? {
          provider: env[`OPENDOIST_${p}_PROVIDER`] as string,
          baseUrl: env[`OPENDOIST_${p}_BASE_URL`] ?? null,
          model: env[`OPENDOIST_${p}_MODEL`] ?? null,
          apiKey: env[`OPENDOIST_${p}_API_KEY`] ?? null,
        }
      : null
  return ConfigSchema.parse({
    publicUrl: env.OPENDOIST_PUBLIC_URL ?? null,
    port: Number(env.OPENDOIST_PORT ?? 7968),
    dataDir: env.OPENDOIST_DATA_DIR ?? '/data',
    webDistDir: env.OPENDOIST_WEB_DIST ?? null,
    allowRegistration: bool(env.OPENDOIST_ALLOW_REGISTRATION, false),
    disableUpdateCheck: bool(env.OPENDOIST_DISABLE_UPDATE_CHECK, false),
    logLevel: env.OPENDOIST_LOG_LEVEL ?? 'info',
    trustProxy: bool(env.OPENDOIST_TRUST_PROXY, false),
    uploadMaxMb: Number(env.OPENDOIST_UPLOAD_MAX_MB ?? 25),
    backupRetention: Number(env.OPENDOIST_BACKUP_RETENTION ?? 14),
    backupIncludeAttachments: bool(env.OPENDOIST_BACKUP_INCLUDE_ATTACHMENTS, true),
    backupCron: env.OPENDOIST_BACKUP_CRON ?? '0 3 * * *',
    oidc,
    stt: ai('STT'),
    llm: ai('LLM'),
    version: env.OPENDOIST_VERSION ?? `${pkg.version}-dev`,
  })
}
