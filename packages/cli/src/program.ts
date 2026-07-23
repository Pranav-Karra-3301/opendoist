import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { registerAddCommand } from './commands/add'
import { registerAuthCommands } from './commands/auth'
import { registerLabelFilterCommands } from './commands/labels'
import { registerMutateCommands } from './commands/mutate'
import { registerOpenCommand } from './commands/open'
import { registerProjectCommands } from './commands/projects'
import { registerSearchCommand } from './commands/search'
import { registerViewCommands } from './commands/views'

export const CLI_VERSION: string = pkg.version

export function buildProgram(): Command {
  const program = new Command('opentask')
  program
    .description('OpenTask CLI — self-hosted, keyboard-first task manager\nTip: alias od=opentask')
    .version(CLI_VERSION, '-V, --version')
    .option('--json', 'stable machine-readable JSON on stdout (exit codes: 0 ok, 1 error, 2 auth)')
    .exitOverride()
  registerAuthCommands(program)
  registerAddCommand(program)
  registerViewCommands(program)
  registerMutateCommands(program)
  registerProjectCommands(program)
  registerLabelFilterCommands(program)
  registerSearchCommand(program)
  registerOpenCommand(program)
  return program
}
