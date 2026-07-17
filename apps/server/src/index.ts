import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createAuth } from './auth'
import { loadConfig } from './config'
import { openDb } from './db/db'
import { EventBus } from './events/bus'
import { createLogger } from './logger'
import { defaultSchedulerDeps, startReminderScheduler } from './reminders/scheduler'
import { ensureDataDirAndSecrets } from './secrets'

const config = loadConfig()
const logger = createLogger(config)
const secrets = ensureDataDirAndSecrets(config.dataDir)
const { db, sqlite } = openDb(join(config.dataDir, 'opendoist.db'))
const auth = createAuth(db, config, secrets.sessionSecret)
const bus = new EventBus()
const app = createApp({ config, db, sqlite, secrets, bus, auth, logger })

// phase 6: reminder scheduler (30 s croner tick; immediate catch-up tick on boot)
const scheduler = process.env.VITEST ? null : startReminderScheduler(db, defaultSchedulerDeps(db))

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, () => {
  logger.info(`opendoist v${config.version} listening on :${config.port}`)
})

const shutdown = () => {
  scheduler?.stop()
  server.close(() => {
    sqlite.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
