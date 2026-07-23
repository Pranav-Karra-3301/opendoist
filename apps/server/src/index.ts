import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createAuth } from './auth'
import { findLegacyEnv, loadConfig } from './config'
import { openDb, resolveDbPath } from './db/db'
import { EventBus } from './events/bus'
import { startJobs } from './jobs/registry'
import { createLogger } from './logger'
import { defaultSchedulerDeps, startReminderScheduler } from './reminders/scheduler'
import { ensureDataDirAndSecrets } from './secrets'

const config = loadConfig()
const logger = createLogger(config)
const legacyEnv = findLegacyEnv()
if (legacyEnv.length > 0)
  logger.warn(
    { vars: legacyEnv },
    'legacy OPENDOIST_* environment variables are honored but deprecated — rename to OPENTASK_*',
  )
const secrets = ensureDataDirAndSecrets(config.dataDir)
const { db, sqlite } = openDb(resolveDbPath(config.dataDir))
const auth = createAuth(db, config, secrets.sessionSecret)
const bus = new EventBus()
const app = createApp({ config, db, sqlite, secrets, bus, auth, logger })

// phase 6: reminder scheduler (30 s croner tick; immediate catch-up tick on boot)
const scheduler = process.env.VITEST ? null : startReminderScheduler(db, defaultSchedulerDeps(db))

// phase 9: nightly backup + productivity reconcile + daily update check (croner registry)
if (config.disableUpdateCheck)
  logger.info('update.check job disabled (OPENTASK_DISABLE_UPDATE_CHECK)')
const jobs = process.env.VITEST ? null : startJobs({ db, sqlite, config, logger })

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, () => {
  logger.info(`opentask v${config.version} listening on :${config.port}`)
})

const shutdown = () => {
  jobs?.stop()
  scheduler?.stop()
  server.close(() => {
    sqlite.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
