import { FilterSyntaxError, parseFilter } from '@opentask/core'
import type { Command } from 'commander'
import { createContext, io, runAction } from '../lib/context'
import { UsageError } from '../lib/errors'
import { filterTable, jsonOut, labelTable } from '../lib/format'

interface ColorOption {
  color?: string
}

async function runLabelsList(_options: unknown, command: Command): Promise<void> {
  const ctx = createContext(command)
  const labels = await ctx.api.listLabels()
  const ordered = [...labels].sort((a, b) => a.item_order - b.item_order)
  if (ctx.json) {
    io.out(jsonOut(ordered))
    return
  }
  io.out(ordered.length === 0 ? 'no labels' : labelTable(ordered, ctx.fmt))
}

async function runLabelsAdd(name: string, options: ColorOption, command: Command): Promise<void> {
  const ctx = createContext(command)
  const body: { name: string; color?: string } = { name }
  if (options.color !== undefined) body.color = options.color
  const created = await ctx.api.createLabel(body)
  if (ctx.json) {
    io.out(jsonOut(created))
    return
  }
  io.out(`✓ created label @${created.name} (${created.id})`)
}

async function runFiltersList(_options: unknown, command: Command): Promise<void> {
  const ctx = createContext(command)
  const filters = await ctx.api.listFilters()
  const ordered = [...filters].sort((a, b) => a.item_order - b.item_order)
  if (ctx.json) {
    io.out(jsonOut(ordered))
    return
  }
  io.out(ordered.length === 0 ? 'no filters' : filterTable(ordered, ctx.fmt))
}

async function runFiltersAdd(
  name: string,
  query: string,
  options: ColorOption,
  command: Command,
): Promise<void> {
  // Validate the query locally FIRST (mirrors the web app) so a syntax error never hits the wire.
  try {
    parseFilter(query)
  } catch (error) {
    if (error instanceof FilterSyntaxError) {
      throw new UsageError(`filter syntax error at position ${error.position}: ${error.message}`)
    }
    throw error
  }
  const ctx = createContext(command)
  const body: { name: string; query: string; color?: string } = { name, query }
  if (options.color !== undefined) body.color = options.color
  const created = await ctx.api.createFilter(body)
  if (ctx.json) {
    io.out(jsonOut(created))
    return
  }
  io.out(`✓ created filter ${created.name} (${created.id})`)
}

export function registerLabelFilterCommands(program: Command): void {
  const labels = program
    .command('labels')
    .description('list labels')
    .action(runAction(runLabelsList))
  labels
    .command('add <name>')
    .description('create a label')
    .option('--color <name>', 'label color')
    .action(runAction(runLabelsAdd))

  const filters = program
    .command('filters')
    .description('list saved filters')
    .action(runAction(runFiltersList))
  filters
    .command('add <name> <query>')
    .description('create a saved filter')
    .option('--color <name>', 'filter color')
    .action(runAction(runFiltersAdd))
}
