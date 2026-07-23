import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as authSchema from './auth-schema'
import * as schema from './schema'

export const fullSchema = { ...schema, ...authSchema }

type Sqlite = InstanceType<typeof Database>
type DrizzleDb = BetterSQLite3Database<typeof fullSchema>
export type Db = DrizzleDb

/** The concrete open connection behind an app's db handle. Swapped wholesale by a restore. */
interface Inner {
  sqlite: Sqlite
  db: DrizzleDb
}

/**
 * A backup restore swaps the live SQLite file out from under the running process. Every consumer
 * captured its handle by reference at boot — `deps.db`, `deps.sqlite` (raw FTS in search.ts), and
 * better-auth's drizzle adapter — so the handle must be a STABLE indirection whose backing
 * connection we can replace without those references going stale. `openDb` therefore returns
 * forwarding Proxies over a mutable `Holder`; `closeDatabase`/`reopenDatabase` swap `holder.inner`.
 *
 * AS-BUILT ADAPTATION (phase 9 Task D): this codebase is deps-injected and opens one connection
 * per app (index.ts plus each test app), so the plan's global no-arg `closeDatabase()` /
 * `reopenDatabase()` take the db-or-sqlite handle instead — the only correct choice when several
 * connections coexist in one process. The behaviour (close the handle, reopen with PRAGMAs +
 * `migrate()`, so an older restored backup upgrades) is exactly as specified.
 */
interface Holder {
  file: string
  inner: Inner | null
}

/** Reaches the swappable Holder behind a db/sqlite proxy (used by close/reopen only). */
const HOLDER = Symbol('opentask.db.holder')

/**
 * Resolve the SQLite path inside `dataDir`, migrating a legacy OpenDoist-era `opendoist.db`
 * (plus its `-wal`/`-shm` sidecars) to `opentask.db` by rename the first time the renamed app
 * boots on an old data dir. Must run BEFORE the file is opened — sidecars only move safely while
 * the database is closed. A data dir that already has `opentask.db` is never touched.
 */
export function resolveDbPath(dataDir: string): string {
  const next = join(dataDir, 'opentask.db')
  const legacy = join(dataDir, 'opendoist.db')
  if (!existsSync(next) && existsSync(legacy)) {
    renameSync(legacy, next)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(legacy + suffix)) renameSync(legacy + suffix, next + suffix)
    }
  }
  return next
}

const MIGRATIONS_DIR = join(import.meta.dirname, '../../drizzle')

function openInner(file: string): Inner {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: fullSchema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return { sqlite, db }
}

/** Build a proxy that forwards every access to `pick(holder.inner)`, binding methods to the real
 *  target so `this` stays correct. Throws a clear error if used during the (millisecond) window a
 *  restore holds the connection closed. */
function forward<T extends object>(holder: Holder, pick: (inner: Inner) => T): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === HOLDER) return holder
      const inner = holder.inner
      if (inner === null) throw new Error('database connection is closed (restore in progress)')
      const target = pick(inner)
      const value = Reflect.get(target as object, prop, target)
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value
    },
    set(_t, prop, value) {
      const inner = holder.inner
      if (inner === null) return false
      return Reflect.set(pick(inner) as object, prop, value)
    },
    has(_t, prop) {
      const inner = holder.inner
      return inner !== null && prop in (pick(inner) as object)
    },
  })
}

export interface DbHandle {
  db: DrizzleDb
  sqlite: Sqlite
}

/** Open the database at `file`, run migrations, and return stable (restore-swappable) handles. */
export function openDb(file: string): DbHandle {
  const holder: Holder = { file, inner: openInner(file) }
  return {
    db: forward(holder, (i) => i.db),
    sqlite: forward(holder, (i) => i.sqlite),
  }
}

function holderOf(handle: object): Holder {
  const holder = (handle as Record<symbol, unknown>)[HOLDER] as Holder | undefined
  if (!holder) throw new Error('closeDatabase/reopenDatabase: not an openDb handle')
  return holder
}

/** Close the live connection behind `handle` so a restore can replace the file. Idempotent. */
export function closeDatabase(handle: object): void {
  const holder = holderOf(handle)
  holder.inner?.sqlite.close()
  holder.inner = null
}

/** Reopen the connection behind `handle` against its (possibly replaced) file — PRAGMAs + migrate(). */
export function reopenDatabase(handle: object): void {
  const holder = holderOf(handle)
  if (holder.inner) return
  holder.inner = openInner(holder.file)
}
