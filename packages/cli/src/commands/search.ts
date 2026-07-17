import type { Command } from 'commander'
import { createContext, io, runAction } from '../lib/context'
import { UsageError } from '../lib/errors'
import { jsonOut, taskTable } from '../lib/format'

const DEFAULT_LIMIT = 30

/** Validates the --limit option: an integer >= 1, else UsageError (exit 1). */
function parseLimit(raw: string): number {
  const limit = Number(raw)
  if (!/^[0-9]+$/.test(raw.trim()) || !Number.isInteger(limit) || limit < 1) {
    throw new UsageError(`invalid --limit "${raw}": expected an integer >= 1`)
  }
  return limit
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query...>')
    .description('full-text search across tasks and comments')
    .option('-n, --limit <n>', 'maximum number of results to show', String(DEFAULT_LIMIT))
    .action(
      runAction(async (query: string[], opts: { limit: string }, command: Command) => {
        const limit = parseLimit(opts.limit)
        const ctx = createContext(command)
        const q = query.join(' ')
        // Server FTS5 caps at 50 hits (api.searchTasks); slice to the CLI limit locally.
        const results = await ctx.api.searchTasks(q)
        const shown = results.slice(0, limit)
        if (ctx.json) {
          io.out(jsonOut(shown))
          return
        }
        if (shown.length === 0) {
          io.out(`no results for "${q}"`)
          return
        }
        const projects = await ctx.api.listProjects()
        const projectNames = new Map(projects.map((project) => [project.id, project.name]))
        io.out(taskTable(shown, ctx.fmt, { showProject: true, projectNames }))
        if (shown.length < results.length) {
          io.out(`${shown.length} of ${results.length} results`)
        }
      }),
    )
}
