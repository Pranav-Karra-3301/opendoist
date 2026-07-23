import type { Command } from 'commander'
import { ApiClient, type InfoDto } from '../lib/api'
import { configFilePath, deleteConfigFile, normalizeUrl, writeConfigFile } from '../lib/config'
import { createContext, globalOpts, io, runAction, systemTimezone } from '../lib/context'
import { ApiError, CliError, UsageError } from '../lib/errors'
import { jsonOut } from '../lib/format'
import { prompter } from '../lib/prompt'

/** Options object commander hands to a command that declares none. */
type NoOptions = Record<string, never>

interface LoginOptions {
  url?: string
  token?: string
}

/** The server parses quick-add date phrases ("tom 5pm") in the ACCOUNT timezone, while the
 *  CLI groups today/upcoming in the system timezone. Accounts registered via the API default
 *  to 'UTC', so `add` could land a calendar day off from the CLI's own views — warn at login
 *  when the two disagree. Best-effort advisory: never blocks login. */
async function warnOnTimezoneMismatch(client: ApiClient): Promise<void> {
  try {
    const { timezone: accountTz } = await client.settings()
    const systemTz = systemTimezone()
    if (typeof accountTz === 'string' && accountTz !== '' && accountTz !== systemTz) {
      io.err(
        `warning: account timezone '${accountTz}' differs from this machine's '${systemTz}' — ` +
          'the server parses quick-add dates in the account timezone; update it in Settings so ' +
          '`add` and today/upcoming agree on what "tomorrow" means',
      )
    }
  } catch {
    // settings endpoint unavailable (older server, transient error) — skip the advisory
  }
}

async function runLogin(opts: LoginOptions, command: Command): Promise<void> {
  const { json } = globalOpts(command)
  const rawUrl = opts.url ?? (await prompter.ask('Server URL (e.g. https://todo.example.com):'))
  const url = normalizeUrl(rawUrl)
  const token = (
    opts.token ?? (await prompter.ask('API token (Settings → Integrations, starts with ot_):'))
  ).trim()
  if (url === '' || token === '') {
    throw new UsageError(
      'a server URL and an API token are both required',
      'pass --url and --token, or answer the prompts',
    )
  }
  if (!token.startsWith('ot_')) {
    io.err("warning: token does not start with 'ot_' — continuing anyway")
  }

  // Probe the server unauthenticated first so a wrong URL fails clearly before we send the token.
  let info: InfoDto
  try {
    info = await new ApiClient(url, null).info()
  } catch (error) {
    // Any API-shaped failure on the probe (404, 500, or a 200 that is not JSON — an SPA
    // catch-all, a random website) means this URL is not a usable OpenTask server.
    if (error instanceof ApiError) {
      throw new CliError(`${url} does not look like an OpenTask server (${error.message})`, {
        hint: 'check the URL — expected GET /api/v1/info to report a version',
      })
    }
    throw error // NetworkError (exit 1) / AuthError (exit 2) keep their own messaging
  }
  if (typeof info.version !== 'string' || info.version === '') {
    throw new CliError(`${url} does not look like an OpenTask server`, {
      hint: 'check the URL — expected GET /api/v1/info to report a version',
    })
  }
  // Validate the token: a bad one throws AuthError (exit 2) from the client, before anything persists.
  const client = new ApiClient(url, token)
  const user = await client.me()
  await warnOnTimezoneMismatch(client)
  const configPath = writeConfigFile({ url, token })

  if (json) {
    io.out(jsonOut({ ok: true, url, version: info.version, user, config_path: configPath }))
    return
  }
  io.out(`✓ logged in to ${url} as ${user.email} — OpenTask v${info.version}`)
  io.out(`config: ${configPath} (0600)`)
}

async function runLogout(_opts: NoOptions, command: Command): Promise<void> {
  const { json } = globalOpts(command)
  const path = configFilePath()
  const removed = deleteConfigFile()
  if (process.env.OPENTASK_TOKEN) {
    io.err('note: OPENTASK_TOKEN is still set in your environment')
  } else if (process.env.OPENDOIST_TOKEN) {
    io.err('note: legacy OPENDOIST_TOKEN is still set in your environment')
  }
  if (json) {
    io.out(jsonOut({ ok: true, removed }))
    return
  }
  io.out(removed ? `logged out (removed ${path})` : 'no saved credentials')
}

async function runWhoami(_opts: NoOptions, command: Command): Promise<void> {
  const ctx = createContext(command)
  const [user, info] = await Promise.all([ctx.api.me(), ctx.api.info()])
  if (ctx.json) {
    io.out(
      jsonOut({
        url: ctx.baseUrl,
        version: info.version,
        token_source: ctx.connection.source,
        user,
      }),
    )
    return
  }
  io.out(`${user.email} (${user.name})`)
  io.out(`server: ${ctx.baseUrl} — OpenTask v${info.version}`)
  io.out(`credentials: ${ctx.connection.source}`)
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Authenticate against an OpenTask server and save credentials')
    .option('--url <url>', 'server URL (e.g. https://todo.example.com)')
    .option('--token <token>', 'API token from Settings → Integrations (starts with ot_)')
    .action(runAction(runLogin))

  program
    .command('logout')
    .description('Remove saved credentials from the config file')
    .action(runAction(runLogout))

  program
    .command('whoami')
    .description('Show the authenticated user, server, and credential source')
    .action(runAction(runWhoami))
}
