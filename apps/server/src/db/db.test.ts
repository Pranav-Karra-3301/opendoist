import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openDb } from './db'

type Sqlite = ReturnType<typeof openDb>['sqlite']

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

function open(): { sqlite: Sqlite } {
  const dir = mkdtempSync(join(tmpdir(), 'od-db-'))
  const { sqlite } = openDb(join(dir, 'opendoist.db'))
  cleanups.push(() => {
    sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { sqlite }
}

describe('openDb pragmas', () => {
  test('applies WAL journal, foreign keys, and busy timeout', () => {
    const { sqlite } = open()
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000)
  })
})

describe('migrations', () => {
  test('create every application and auth table plus the FTS virtual tables', () => {
    const { sqlite } = open()
    const names = new Set(
      (
        sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
          name: string
        }[]
      ).map((r) => r.name),
    )
    for (const t of [
      'projects',
      'sections',
      'tasks',
      'labels',
      'task_labels',
      'filters',
      'comments',
      'attachments',
      'activity_log',
      'day_stats',
      'user_settings',
      'user',
      'session',
      'account',
      'verification',
      'two_factor',
      'apikey',
      'tasks_fts',
      'comments_fts',
    ]) {
      expect(names.has(t), `missing table: ${t}`).toBe(true)
    }
  })
})

describe('tasks_fts triggers', () => {
  test('keep the FTS index in sync when a task row is inserted and updated', () => {
    const { sqlite } = open()
    const nowMs = Date.now()
    const nowIso = new Date().toISOString()

    // Parent rows first so the ON foreign keys are satisfied.
    sqlite
      .prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('u1', 'Tester', 'tester@example.com', nowMs, nowMs)
    sqlite
      .prepare(
        'INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('p1', 'u1', 'Inbox', nowIso, nowIso)
    sqlite
      .prepare(
        'INSERT INTO tasks (id, user_id, project_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('t1', 'u1', 'p1', 'summon the unicorn', nowIso, nowIso)

    const match = (term: string) =>
      sqlite.prepare('SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ?').all(term)

    expect(match('unicorn').length).toBe(1)

    sqlite.prepare('UPDATE tasks SET content = ? WHERE id = ?').run('summon the dragon', 't1')
    expect(match('unicorn').length).toBe(0)
    expect(match('dragon').length).toBe(1)
  })
})
