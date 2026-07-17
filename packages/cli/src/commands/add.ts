import { type ParsedQuickAdd, parseQuickAdd } from '@opendoist/core'
import type { Command } from 'commander'
import type { TaskDto } from '../lib/api'
import { coreParseContext, createContext, io, runAction } from '../lib/context'
import { UsageError } from '../lib/errors'
import { jsonOut, taskLine } from '../lib/format'

/** Compact echo of what the server stored. Built from the created TaskDto where it carries the
 *  datum, falling back to the local preview for the things a TaskDto does not expose (project /
 *  section names, reminders). Component order is frozen by the plan. */
function parsedSummary(created: TaskDto, preview: ParsedQuickAdd): string {
  const parts: string[] = []
  if (created.priority !== 4) parts.push(`p${created.priority}`)
  if (created.due !== null) parts.push(`due ${created.due.string}`)
  if (created.deadline_date !== null) parts.push(`deadline {${created.deadline_date}}`)
  if (preview.project !== null) parts.push(`#${preview.project}`)
  if (preview.section !== null) parts.push(`/${preview.section}`)
  if (created.labels.length > 0) parts.push(created.labels.map((label) => `@${label}`).join(' '))
  if (created.duration_min !== null) parts.push(`~${created.duration_min}min`)
  const reminders = preview.reminders.length
  if (reminders > 0) parts.push(`${reminders} reminder${reminders === 1 ? '' : 's'}`)
  if (created.uncompletable) parts.push('uncompletable')
  return parts.join(' · ')
}

export function registerAddCommand(program: Command): void {
  program
    .command('add <text...>')
    .description('add a task with the Quick Add grammar (offline-identical to the web app)')
    .action(
      runAction(async (text: string[], _opts: Record<string, unknown>, command: Command) => {
        const ctx = createContext(command)
        const raw = text.join(' ')
        // Local preview FIRST: reject an empty title before touching the network.
        const preview = parseQuickAdd(raw, coreParseContext(ctx))
        if (preview.title === '')
          throw new UsageError(
            'task title is empty after token extraction',
            'quote literal text or remove stray tokens',
          )
        // Submit the RAW text unchanged — the server re-parses authoritatively with the same core
        // parser (the offline-identical contract). The CLI never sends parsed fields.
        const created = await ctx.api.quickAdd(raw)
        if (ctx.json) {
          io.out(jsonOut(created))
          return
        }
        io.out(`✓ added ${taskLine(created, ctx.fmt)}`)
        if (preview.tokens.length > 0) {
          const summary = parsedSummary(created, preview)
          if (summary !== '') io.out(`  parsed: ${summary}`)
        }
      }),
    )
}
