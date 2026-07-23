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

/**
 * Legacy OPENDOIST_* names (pre-rebrand) present in `env`. Honored by `loadConfig` as a
 * fallback when the OPENTASK_* name is unset; the caller boot-warns so operators migrate.
 */
export function findLegacyEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env)
    .filter((k) => k.startsWith('OPENDOIST_'))
    .sort()
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as {
    version: string
  }
  /** OPENTASK_<k>, falling back to the legacy OPENDOIST_<k> spelling. */
  const g = (k: string) => env[`OPENTASK_${k}`] ?? env[`OPENDOIST_${k}`]
  const o = (k: string) => g(`OIDC_${k}`)
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
    g(`${p}_PROVIDER`)
      ? {
          provider: g(`${p}_PROVIDER`) as string,
          baseUrl: g(`${p}_BASE_URL`) ?? null,
          model: g(`${p}_MODEL`) ?? null,
          apiKey: g(`${p}_API_KEY`) ?? null,
        }
      : null
  return ConfigSchema.parse({
    publicUrl: g('PUBLIC_URL') ?? null,
    port: Number(g('PORT') ?? 7968),
    dataDir: g('DATA_DIR') ?? '/data',
    webDistDir: g('WEB_DIST') ?? null,
    allowRegistration: bool(g('ALLOW_REGISTRATION'), false),
    disableUpdateCheck: bool(g('DISABLE_UPDATE_CHECK'), false),
    logLevel: g('LOG_LEVEL') ?? 'info',
    trustProxy: bool(g('TRUST_PROXY'), false),
    uploadMaxMb: Number(g('UPLOAD_MAX_MB') ?? 25),
    backupRetention: Number(g('BACKUP_RETENTION') ?? 14),
    backupIncludeAttachments: bool(g('BACKUP_INCLUDE_ATTACHMENTS'), true),
    backupCron: g('BACKUP_CRON') ?? '0 3 * * *',
    oidc,
    stt: ai('STT'),
    llm: ai('LLM'),
    version: g('VERSION') ?? `${pkg.version}-dev`,
  })
}
