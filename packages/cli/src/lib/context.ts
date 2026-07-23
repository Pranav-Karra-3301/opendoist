import { DEFAULT_PARSE_CONTEXT_SETTINGS, dateInTz, type ParseContext } from '@opentask/core'
import type { Command } from 'commander'
import { ApiClient } from './api'
import { type Connection, resolveConnection } from './config'
import { ApiError, AuthError, CliError } from './errors'

/** All process output goes through io so tests can capture it (vi.spyOn). */
export const io = {
  out(text: string): void {
    process.stdout.write(`${text}\n`)
  },
  err(text: string): void {
    process.stderr.write(`${text}\n`)
  },
}

export interface FmtOpts {
  color: boolean
  /** YYYY-MM-DD in the user's timezone */
  today: string
  timezone: string
}
export interface CommandContext {
  api: ApiClient
  baseUrl: string
  json: boolean
  connection: Connection
  /** ISO instant · IANA zone (system) */
  now: string
  timezone: string
  fmt: FmtOpts
}

export function globalOpts(command: Command): { json: boolean } {
  return { json: command.optsWithGlobals<{ json?: boolean }>().json === true }
}

export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function shouldColor(): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true
  return process.stdout.isTTY === true
}

/** Throws AuthError (exit 2) when no credentials are resolvable. */
export function createContext(command: Command): CommandContext {
  const { json } = globalOpts(command)
  const connection = resolveConnection()
  if (connection === null)
    throw new AuthError(
      'not logged in: no server URL/token found',
      'run `opentask login`, or set OPENTASK_URL and OPENTASK_TOKEN',
    )
  const now = new Date().toISOString()
  const timezone = systemTimezone()
  const api = new ApiClient(connection.url, connection.token)
  const fmt: FmtOpts = { color: !json && shouldColor(), today: dateInTz(now, timezone), timezone }
  return { api, baseUrl: connection.url, json, connection, now, timezone, fmt }
}

/** ParseContext for core parsers: system clock + timezone, product-default week settings. */
export function coreParseContext(ctx: { now: string; timezone: string }): ParseContext {
  return { now: ctx.now, timezone: ctx.timezone, ...DEFAULT_PARSE_CONTEXT_SETTINGS }
}

/** Wrap every commander .action() handler: maps CliError → output + exit code (0/1/2). */
export function runAction<A extends unknown[]>(
  fn: (...args: [...A, Command]) => Promise<void>,
): (...args: [...A, Command]) => Promise<void> {
  return async (...args) => {
    const command = args[args.length - 1] as Command
    const { json } = globalOpts(command)
    try {
      await fn(...args)
    } catch (error) {
      const e =
        error instanceof CliError
          ? error
          : new CliError(error instanceof Error ? error.message : String(error))
      if (json) {
        const status = e instanceof ApiError ? { status: e.status } : {}
        io.out(
          JSON.stringify({ ok: false, error: { code: e.code, message: e.message, ...status } }),
        )
      } else {
        io.err(`error: ${e.message}`)
        if (e.hint !== null) io.err(`hint: ${e.hint}`)
      }
      process.exitCode = e.exitCode
    }
  }
}
