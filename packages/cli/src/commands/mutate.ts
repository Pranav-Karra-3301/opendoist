// REPLACED WHOLESALE BY TASK F — mutation commands: done, reopen, rm.
import type { Command } from 'commander'
import type { TaskDto } from '../lib/api'
import { type CommandContext, createContext, io, runAction } from '../lib/context'
import { ApiError, CliError } from '../lib/errors'
import { dueLabel, jsonOut, taskLine } from '../lib/format'
import { prompter } from '../lib/prompt'

interface MutateOpts {
  yes?: boolean
}

interface ResolveSpec {
  /** true → fuzzy pool comes from the completed listing (own route), false → active tasks. */
  completedPool: boolean
  /** true → confirm even on an exact-id hit (rm); false → confirm only on a fuzzy match. */
  alwaysConfirm: boolean
  /** imperative verb for the confirmation prompt, e.g. 'Delete'. */
  verb: string
}

/**
 * Resolve a task ref to exactly one task. Exact-id `getTask` first; a 404 (only) falls through to a
 * case-insensitive substring match over the relevant pool. 0 matches → error; ≥2 → list candidate
 * ids to stderr and error; 1 → fuzzy hit.
 */
async function resolveTask(
  ctx: CommandContext,
  ref: string,
  spec: { completedPool: boolean },
): Promise<{ task: TaskDto; fuzzy: boolean }> {
  try {
    return { task: await ctx.api.getTask(ref), fuzzy: false }
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error
  }
  const pool = spec.completedPool ? await ctx.api.listCompletedTasks() : await ctx.api.listTasks()
  const needle = ref.toLowerCase()
  const matches = pool.filter((task) => task.content.toLowerCase().includes(needle))
  if (matches.length === 0) throw new CliError(`no task matching "${ref}"`)
  if (matches.length > 1) {
    for (const task of matches.slice(0, 10)) io.err(`  ${taskLine(task, ctx.fmt)}`)
    throw new CliError('ambiguous match — pass the task id')
  }
  return { task: matches[0] as TaskDto, fuzzy: true }
}

/** Resolve then confirm per spec; a declined prompt throws before any mutation runs. */
async function resolveAndConfirm(
  ctx: CommandContext,
  ref: string,
  opts: MutateOpts,
  spec: ResolveSpec,
): Promise<TaskDto> {
  const { task, fuzzy } = await resolveTask(ctx, ref, { completedPool: spec.completedPool })
  if (opts.yes !== true && (fuzzy || spec.alwaysConfirm)) {
    const ok = await prompter.confirm(`${spec.verb} "${task.content}" (${task.id})?`)
    if (!ok) throw new CliError('aborted')
  }
  return task
}

function emitResult(ctx: CommandContext, task: TaskDto, action: 'reopened' | 'deleted'): void {
  if (ctx.json) io.out(jsonOut({ ok: true, id: task.id, action }))
  else io.out(`✓ ${action} ${task.content} (${task.id})`)
}

async function doneAction(ref: string, opts: MutateOpts, command: Command): Promise<void> {
  const ctx = createContext(command)
  const task = await resolveAndConfirm(ctx, ref, opts, {
    completedPool: false,
    alwaysConfirm: false,
    verb: 'Complete',
  })
  await ctx.api.closeTask(task.id)
  // Closing a recurring task advances it server-side; re-fetch to surface the next occurrence.
  let next: TaskDto | null = null
  if (task.due?.is_recurring === true) {
    const refetched = await ctx.api.getTask(task.id)
    if (refetched.completed_at === null && refetched.due !== null) next = refetched
  }
  if (ctx.json) {
    const payload: Record<string, unknown> = { ok: true, id: task.id, action: 'closed' }
    if (next !== null) payload.next_due = next.due
    io.out(jsonOut(payload))
  } else {
    io.out(`✓ completed ${task.content} (${task.id})`)
    if (next !== null) io.out(`  → next occurrence: ${dueLabel(next, ctx.fmt)}`)
  }
}

async function reopenAction(ref: string, opts: MutateOpts, command: Command): Promise<void> {
  const ctx = createContext(command)
  const task = await resolveAndConfirm(ctx, ref, opts, {
    completedPool: true,
    alwaysConfirm: false,
    verb: 'Reopen',
  })
  await ctx.api.reopenTask(task.id)
  emitResult(ctx, task, 'reopened')
}

async function rmAction(ref: string, opts: MutateOpts, command: Command): Promise<void> {
  const ctx = createContext(command)
  const task = await resolveAndConfirm(ctx, ref, opts, {
    completedPool: false,
    alwaysConfirm: true,
    verb: 'Delete',
  })
  await ctx.api.deleteTask(task.id)
  emitResult(ctx, task, 'deleted')
}

export function registerMutateCommands(program: Command): void {
  program
    .command('done <task>')
    .description('complete a task, by id or fuzzy content match')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(runAction(doneAction))
  program
    .command('reopen <task>')
    .description('reopen a completed task, by id or fuzzy content match')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(runAction(reopenAction))
  program
    .command('rm <task>')
    .description('delete a task, by id or fuzzy content match')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(runAction(rmAction))
}
