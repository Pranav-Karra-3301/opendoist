import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as authSchema from './auth-schema'
import * as schema from './schema'

export const fullSchema = { ...schema, ...authSchema }
export type Db = ReturnType<typeof openDb>['db']

export function openDb(file: string) {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: fullSchema })
  migrate(db, { migrationsFolder: join(import.meta.dirname, '../../drizzle') })
  return { db, sqlite }
}
