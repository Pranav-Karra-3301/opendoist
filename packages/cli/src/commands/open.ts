import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import type { TaskDto } from '../lib/api'
import { type CommandContext, createContext, io, runAction } from '../lib/context'
import { ApiError, CliError } from '../lib/errors'
import { jsonOut } from '../lib/format'

/** Web routes — the ONE place the CLI knows the web app's URL shapes. AS-BUILT reconciled
 *  against apps/web/src/router.tsx @ fb558ab: view keywords + the canonical task deep link
 *  `${origin}/task/<id>` (the router comment names it as phase 8's build target). */
const WEB_ROUTES = {
  home: '/',
  inbox: '/inbox',
  today: '/today',
  upcoming: '/upcoming',
  task: (id: string): string => `/task/${encodeURIComponent(id)}`,
}

/** Mockable browser launcher (spied in tests; never invoked under --json). */
export const launcher = {
  open(url: string): void {
    const [cmd, args]: [string, string[]] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : ['xdg-open', [url]]
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  },
}

/** Resolve a task ref to its id: exact id (getTask), else a UNIQUE fuzzy content match.
 *  Read-only navigation, so — unlike Task F's resolver — it never confirms. */
async function resolveTaskId(ctx: CommandContext, ref: string): Promise<string> {
  try {
    return (await ctx.api.getTask(ref)).id
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
  }
  const needle = ref.toLowerCase()
  const matches = (await ctx.api.listTasks()).filter((task) =>
    task.content.toLowerCase().includes(needle),
  )
  if (matches.length === 0) throw new CliError(`no task matching "${ref}"`)
  if (matches.length > 1) {
    for (const task of matches.slice(0, 10)) io.err(`  ${task.id}  ${task.content}`)
    throw new CliError('ambiguous match — pass the task id')
  }
  return (matches[0] as TaskDto).id
}

/** Map a target to its web path. App home + view keywords resolve offline (no API call). */
async function resolvePath(ctx: CommandContext, target: string | undefined): Promise<string> {
  const ref = target?.trim() ?? ''
  if (ref === '') return WEB_ROUTES.home
  switch (ref.toLowerCase()) {
    case 'inbox':
      return WEB_ROUTES.inbox
    case 'today':
      return WEB_ROUTES.today
    case 'upcoming':
      return WEB_ROUTES.upcoming
    default:
      return WEB_ROUTES.task(await resolveTaskId(ctx, ref))
  }
}

export function registerOpenCommand(program: Command): void {
  program
    .command('open')
    .argument('[target]', 'inbox | today | upcoming | a task id or text (default: app home)')
    .description('open OpenDoist in your browser (deep-link to a view or task)')
    .action(
      runAction(
        async (target: string | undefined, _options: Record<string, unknown>, command: Command) => {
          const ctx = createContext(command)
          const url = `${ctx.baseUrl}${await resolvePath(ctx, target)}`
          if (ctx.json) {
            io.out(jsonOut({ url }))
            return
          }
          io.out(`opening ${url}`)
          launcher.open(url)
        },
      ),
    )
}
