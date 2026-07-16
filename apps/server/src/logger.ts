import { type Logger, pino } from 'pino'
import type { Config } from './config'

export type { Logger }

export function createLogger(config: Config): Logger {
  return pino({ level: config.logLevel })
}
