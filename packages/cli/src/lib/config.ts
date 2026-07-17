import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import envPaths from 'env-paths'

export interface CliConfig {
  url: string
  token: string
}
export type CredentialSource = 'env' | 'config' | 'mixed'
export interface Connection extends CliConfig {
  source: CredentialSource
}

/** Adds a scheme when missing (http for localhost/loopback, https otherwise), strips trailing slashes. */
export function normalizeUrl(raw: string): string {
  let url = raw.trim()
  if (url === '') return url
  if (!/^https?:\/\//i.test(url)) {
    const isLocal = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url)
    url = `${isLocal ? 'http' : 'https'}://${url}`
  }
  return url.replace(/\/+$/, '')
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENDOIST_CONFIG_PATH
  if (override !== undefined && override !== '') return override
  return join(envPaths('opendoist', { suffix: '' }).config, 'config.json')
}

export function readConfigFile(env: NodeJS.ProcessEnv = process.env): CliConfig | null {
  try {
    const record = JSON.parse(readFileSync(configFilePath(env), 'utf8')) as Record<string, unknown>
    if (typeof record?.url !== 'string' || typeof record?.token !== 'string') return null
    return { url: normalizeUrl(record.url), token: record.token }
  } catch {
    return null
  }
}

/** Writes config with 0600 perms (0700 dir); chmod again because writeFileSync mode only applies on create. */
export function writeConfigFile(config: CliConfig, env: NodeJS.ProcessEnv = process.env): string {
  const path = configFilePath(env)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(
    path,
    `${JSON.stringify({ url: normalizeUrl(config.url), token: config.token }, null, 2)}\n`,
    { mode: 0o600 },
  )
  chmodSync(path, 0o600)
  return path
}

export function deleteConfigFile(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    rmSync(configFilePath(env))
    return true
  } catch {
    return false
  }
}

/** Precedence: OPENDOIST_URL / OPENDOIST_TOKEN env vars > config file. Null when either half is missing. */
export function resolveConnection(env: NodeJS.ProcessEnv = process.env): Connection | null {
  const file = readConfigFile(env)
  const envUrl = env.OPENDOIST_URL ? normalizeUrl(env.OPENDOIST_URL) : null
  const envToken = env.OPENDOIST_TOKEN ? env.OPENDOIST_TOKEN : null
  const url = envUrl ?? file?.url ?? null
  const token = envToken ?? file?.token ?? null
  if (url === null || token === null) return null
  const source: CredentialSource =
    envUrl !== null && envToken !== null
      ? 'env'
      : envUrl === null && envToken === null
        ? 'config'
        : 'mixed'
  return { url, token, source }
}
