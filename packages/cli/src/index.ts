#!/usr/bin/env node
import { CommanderError } from 'commander'
import { buildProgram } from './program'

try {
  await buildProgram().parseAsync(process.argv)
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode // --help/--version → 0 via exitOverride; usage errors → 1
  } else {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
