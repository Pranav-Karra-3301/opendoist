import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import archiver from 'archiver'
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../db/db'
import { comments, labels, projects, sections, taskLabels, tasks } from '../db/schema'
import { createTestApp, type TestApp } from '../test/helpers'
import { applyImportPlan, dryRunReport, type ImportApplyDeps } from './apply'
import { parseTodoistBackupZip } from './todoist-csv'
import type { ImportPlan } from './types'

type ImportTask = ImportPlan['tasks'][number]

const fixtureDir = join(import.meta.dirname, 'fixtures')
const workCsv = readFileSync(join(fixtureDir, 'Work [220474322].csv'), 'utf8')
const inboxCsv = readFileSync(join(fixtureDir, 'Inbox.csv'), 'utf8')

function zipFiles(zipPath: string, files: { name: string; content: string }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip')
    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)
    for (const f of files) archive.append(f.content, { name: f.name })
    void archive.finalize()
  })
}

const depsOf = (t: TestApp): ImportApplyDeps => ({
  db: t.deps.db,
  userId: t.userId,
  bus: t.deps.bus,
})

function mkTask(
  o: Partial<ImportTask> & { key: string; projectKey: string; content: string },
): ImportTask {
  return {
    sectionKey: null,
    parentKey: null,
    description: '',
    priority: 4,
    dueString: null,
    dueDate: null,
    dueTime: null,
    deadline: null,
    durationMin: null,
    labels: [],
    childOrder: 0,
    comments: [],
    ...o,
  }
}

let fixturePlan: ImportPlan
let tmpRoot: string

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'opendoist-apply-'))
  const zipPath = join(tmpRoot, 'backup.zip')
  await zipFiles(zipPath, [
    { name: 'Work [220474322].csv', content: workCsv },
    { name: 'Inbox.csv', content: inboxCsv },
  ])
  fixturePlan = await parseTodoistBackupZip(zipPath)
})
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }))

describe('applyImportPlan', () => {
  it('writes projects (Inbox merged), sections, labels, tasks, comments and one event', async () => {
    const t = await createTestApp()
    try {
      const db = t.deps.db
      const events: { type: string; entity: string; ids: string[] }[] = []
      const unsub = t.deps.bus.subscribe((e) => events.push(e))
      const report = applyImportPlan(depsOf(t), fixturePlan)
      unsub()

      expect(report.mode).toBe('apply')
      expect(report.counts).toMatchObject({
        projects: 2,
        sections: 2,
        labels: 2,
        tasks: 6,
        comments: 1,
      })
      // Inbox merges into the existing project → only 1 project row created
      expect(report.created).toMatchObject({
        projects: 1,
        sections: 2,
        labels: 2,
        tasks: 6,
        comments: 1,
      })
      expect(report.skips).toContainEqual({
        entity: 'task',
        ref: 'Book flights',
        reason: 'assignee dropped',
      })

      const allProjects = db.select().from(projects).where(eq(projects.userId, t.userId)).all()
      expect(allProjects).toHaveLength(2) // inbox + Work
      expect(allProjects.filter((p) => p.isInbox)).toHaveLength(1)
      const inbox = allProjects.find((p) => p.isInbox)
      expect(allProjects.find((p) => p.name === 'Work')).toBeDefined()

      const allTasks = db.select().from(tasks).where(eq(tasks.userId, t.userId)).all()
      expect(allTasks).toHaveLength(6)

      const roadmap = allTasks.find((x) => x.content === 'Draft Q3 roadmap')
      expect(roadmap?.priority).toBe(1)
      expect(roadmap?.deadlineDate).toBe('2026-08-01')
      expect(roadmap?.durationMin).toBe(45)
      expect(roadmap?.recurrence).not.toBeNull()
      const roadmapRec = JSON.parse(roadmap?.recurrence ?? '{}')
      expect(roadmapRec.freq).toBe('weekly')
      expect(roadmapRec.weekdays).toContain(5)

      const ref = allTasks.find((x) => x.content === '* Reference material')
      expect(ref?.parentId).toBe(roadmap?.id)
      expect(ref?.uncompletable).toBe(true)

      const flights = allTasks.find((x) => x.content === 'Book flights')
      expect(flights?.recurrence).toBeNull()
      expect(flights?.dueString).toBe('Jul 22')
      expect(flights?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

      const water = allTasks.find((x) => x.content === 'Water plants')
      const waterRec = JSON.parse(water?.recurrence ?? '{}')
      expect(waterRec.anchor).toBe('completion')
      expect(waterRec.interval).toBe(3)

      const labelNamesFor = (taskId: string) =>
        db
          .select({ name: labels.name })
          .from(taskLabels)
          .innerJoin(labels, eq(taskLabels.labelId, labels.id))
          .where(eq(taskLabels.taskId, taskId))
          .all()
          .map((r) => r.name)
          .sort()
      expect(labelNamesFor(roadmap?.id ?? '')).toEqual(['work'])
      expect(labelNamesFor(flights?.id ?? '')).toEqual(['travel', 'work'])

      const inboxTasks = allTasks
        .filter((x) => x.projectId === inbox?.id)
        .map((x) => x.content)
        .sort()
      expect(inboxTasks).toEqual(['Buy milk', 'Call dentist'])

      const roadmapComments = db
        .select()
        .from(comments)
        .where(eq(comments.taskId, roadmap?.id ?? ''))
        .all()
      expect(roadmapComments).toHaveLength(1)
      expect(roadmapComments[0]?.content).toBe('Remember to include the hiring plan')
      // note DATE is preserved as the comment timestamp
      expect(roadmapComments[0]?.createdAt).toBe('2026-07-10T14:03:22Z')

      const importEvents = events.filter((e) => e.type === 'import.completed')
      expect(importEvents).toHaveLength(1)
      expect(importEvents[0]?.entity).toBe('task')
      expect(importEvents[0]?.ids).toHaveLength(6)
    } finally {
      t.close()
    }
  })

  it('reuses an existing label case-insensitively (counted, not created)', async () => {
    const t = await createTestApp()
    try {
      const db = t.deps.db
      db.insert(labels).values({ id: 'lbl-existing', userId: t.userId, name: 'work' }).run()

      const plan: ImportPlan = {
        source: 'todoist-csv',
        projects: [{ key: 'P', name: 'P', color: null, parentKey: null, isInbox: false }],
        sections: [],
        labels: [{ key: 'l', name: 'Work', color: null }],
        tasks: [mkTask({ key: 'P::t::0', projectKey: 'P', content: 'Tagged', labels: ['Work'] })],
        skips: [],
      }
      const report = applyImportPlan(depsOf(t), plan)
      expect(report.counts.labels).toBe(1)
      expect(report.created.labels).toBe(0)

      const remaining = db
        .select()
        .from(labels)
        .where(and(eq(labels.userId, t.userId), isNull(labels.deletedAt)))
        .all()
      expect(remaining).toHaveLength(1) // no new label row
      const task = db.select().from(tasks).where(eq(tasks.content, 'Tagged')).get()
      const link = db
        .select()
        .from(taskLabels)
        .where(eq(taskLabels.taskId, task?.id ?? ''))
        .get()
      expect(link?.labelId).toBe('lbl-existing')
    } finally {
      t.close()
    }
  })

  it('maps an unknown color to charcoal with a skip and keeps a valid palette color', async () => {
    const t = await createTestApp()
    try {
      const db = t.deps.db
      const plan: ImportPlan = {
        source: 'todoist-api',
        projects: [
          { key: 'A', name: 'Alpha', color: 'not_a_color', parentKey: null, isInbox: false },
          { key: 'B', name: 'Beta', color: 'blue', parentKey: null, isInbox: false },
        ],
        sections: [],
        labels: [],
        tasks: [],
        skips: [],
      }
      const report = applyImportPlan(depsOf(t), plan)
      const alpha = db
        .select()
        .from(projects)
        .where(and(eq(projects.userId, t.userId), eq(projects.name, 'Alpha')))
        .get()
      const beta = db
        .select()
        .from(projects)
        .where(and(eq(projects.userId, t.userId), eq(projects.name, 'Beta')))
        .get()
      expect(alpha?.color).toBe('charcoal')
      expect(beta?.color).toBe('blue')
      expect(report.skips).toContainEqual({
        entity: 'project',
        ref: 'Alpha',
        reason: "unknown color 'not_a_color' → charcoal",
      })
    } finally {
      t.close()
    }
  })

  it('drops an unparseable due with a skip note', async () => {
    const t = await createTestApp()
    try {
      const db = t.deps.db
      const plan: ImportPlan = {
        source: 'todoist-csv',
        projects: [{ key: 'P', name: 'P', color: null, parentKey: null, isInbox: false }],
        sections: [],
        labels: [],
        tasks: [
          mkTask({ key: 'P::t::0', projectKey: 'P', content: 'Vague', dueString: 'someday??' }),
        ],
        skips: [],
      }
      const report = applyImportPlan(depsOf(t), plan)
      const task = db.select().from(tasks).where(eq(tasks.content, 'Vague')).get()
      expect(task?.dueDate).toBeNull()
      expect(task?.dueString).toBeNull()
      expect(report.skips).toContainEqual({ entity: 'task', ref: 'Vague', reason: 'due dropped' })
    } finally {
      t.close()
    }
  })
})

describe('dryRunReport', () => {
  it('writes nothing and reports the same created counts as apply', async () => {
    const t = await createTestApp()
    try {
      const db = t.deps.db
      const nProjects = () =>
        db.select().from(projects).where(eq(projects.userId, t.userId)).all().length
      const nTasks = () => db.select().from(tasks).where(eq(tasks.userId, t.userId)).all().length
      const nLabels = () => db.select().from(labels).where(eq(labels.userId, t.userId)).all().length

      const projectsBefore = nProjects() // 1 (inbox)
      const dry = dryRunReport(depsOf(t), fixturePlan)
      expect(dry.mode).toBe('dry-run')
      expect(nProjects()).toBe(projectsBefore)
      expect(nTasks()).toBe(0)
      expect(nLabels()).toBe(0)

      const applied = applyImportPlan(depsOf(t), fixturePlan)
      expect(dry.created).toEqual(applied.created)
      expect(dry.counts).toEqual(applied.counts)
    } finally {
      t.close()
    }
  })
})

describe('applyImportPlan atomicity', () => {
  it('rolls back every write when the transaction throws mid-apply', async () => {
    const t = await createTestApp()
    try {
      const realDb = t.deps.db
      const boom = new Error('boom mid-apply')
      type TxT = Parameters<Parameters<Db['transaction']>[0]>[0]

      const rollbackDb = new Proxy(realDb, {
        get(target, prop, receiver) {
          if (prop !== 'transaction') {
            const v = Reflect.get(target, prop, receiver)
            return typeof v === 'function' ? v.bind(target) : v
          }
          return (fn: (tx: TxT) => unknown) =>
            target.transaction((tx) => {
              const proxyTx = new Proxy(tx, {
                get(txTarget, txProp, txRecv) {
                  if (txProp === 'insert') {
                    return (table: unknown) => {
                      if (table === tasks) throw boom
                      return (txTarget.insert as (tb: unknown) => unknown)(table)
                    }
                  }
                  const v = Reflect.get(txTarget, txProp, txRecv)
                  return typeof v === 'function' ? v.bind(txTarget) : v
                },
              })
              return fn(proxyTx as TxT)
            })
        },
      })

      const deps: ImportApplyDeps = { db: rollbackDb, userId: t.userId, bus: t.deps.bus }
      expect(() => applyImportPlan(deps, fixturePlan)).toThrow('boom mid-apply')

      expect(
        realDb
          .select()
          .from(projects)
          .where(and(eq(projects.userId, t.userId), eq(projects.isInbox, false)))
          .all(),
      ).toHaveLength(0)
      expect(
        realDb.select().from(sections).where(eq(sections.userId, t.userId)).all(),
      ).toHaveLength(0)
      expect(
        realDb
          .select()
          .from(labels)
          .where(and(eq(labels.userId, t.userId), isNull(labels.deletedAt)))
          .all(),
      ).toHaveLength(0)
      expect(realDb.select().from(tasks).where(eq(tasks.userId, t.userId)).all()).toHaveLength(0)
    } finally {
      t.close()
    }
  })
})
