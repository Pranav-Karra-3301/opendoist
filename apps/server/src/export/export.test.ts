import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecurrenceSpecSchema } from '@opendoist/core'
import { eq } from 'drizzle-orm'
import StreamZip from 'node-stream-zip'
import { afterEach, describe, expect, it } from 'vitest'
import type { Db } from '../db/db'
import {
  attachments,
  comments,
  labels,
  projects,
  reminders,
  sections,
  taskLabels,
  tasks,
} from '../db/schema'
import { parseTodoistBackupZip } from '../import/todoist-csv'
import { planCounts } from '../import/types'
import { newId } from '../lib/ids'
import { makeTestDb, seedUser } from '../reminders/test-helpers'
import { createTestApp, json } from '../test/helpers'
import {
  buildCsvFiles,
  escapeCsvField,
  renderProjectCsv,
  TODOIST_CSV_HEADER,
  zipCsvFiles,
} from './csv-export'
import { buildJsonExport, type OpendoistExport, OpendoistExportSchema } from './json-export'

/** Track temp dirs created for zip round-trips so afterEach can clean them all. */
const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function writeZipToDisk(buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'opendoist-export-'))
  tempDirs.push(dir)
  const path = join(dir, 'export.zip')
  writeFileSync(path, buffer)
  return path
}

const RECURRENCE = JSON.stringify(
  RecurrenceSpecSchema.parse({ anchor: 'schedule', freq: 'weekly', interval: 1, weekdays: [5] }),
)

/* ------------------------------------------------------------------ JSON export */

describe('buildJsonExport', () => {
  it('produces a schema-valid document with completed but not soft-deleted tasks', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const inboxId = newId()
      const workId = newId()
      db.insert(projects)
        .values({ id: inboxId, userId, name: 'Inbox', isInbox: true, childOrder: 0 })
        .run()
      db.insert(projects).values({ id: workId, userId, name: 'Work', childOrder: 1 }).run()
      db.insert(sections)
        .values({ id: newId(), userId, projectId: workId, name: 'Planning', sectionOrder: 0 })
        .run()
      const homeLabel = newId()
      db.insert(labels).values({ id: homeLabel, userId, name: 'home', itemOrder: 0 }).run()

      const milkId = newId()
      db.insert(tasks)
        .values({
          id: milkId,
          userId,
          projectId: inboxId,
          content: 'Buy milk',
          priority: 2,
          dueDate: '2026-07-20',
          dueString: 'Jul 20',
          childOrder: 0,
        })
        .run()
      db.insert(taskLabels).values({ taskId: milkId, labelId: homeLabel }).run()
      db.insert(tasks)
        .values({
          id: newId(),
          userId,
          projectId: workId,
          content: 'Daily standup',
          dueDate: '2026-07-16',
          dueString: 'every day',
          recurrence: RECURRENCE,
          childOrder: 0,
        })
        .run()
      db.insert(tasks)
        .values({
          id: newId(),
          userId,
          projectId: workId,
          content: 'Done thing',
          completedAt: '2026-07-14T10:00:00Z',
          childOrder: 1,
        })
        .run()
      db.insert(tasks)
        .values({
          id: newId(),
          userId,
          projectId: workId,
          content: 'Deleted thing',
          deletedAt: '2026-07-14T10:00:00Z',
          childOrder: 2,
        })
        .run()

      const attId = newId()
      db.insert(attachments)
        .values({
          id: attId,
          userId,
          fileName: 'plan.pdf',
          fileSize: 2048,
          fileType: 'application/pdf',
          filePath: `${attId}/plan.pdf`,
        })
        .run()
      db.insert(comments)
        .values({
          id: newId(),
          userId,
          taskId: milkId,
          content: 'get the oat one',
          attachmentId: attId,
          createdAt: '2026-07-10T14:03:22Z',
          updatedAt: '2026-07-10T14:03:22Z',
        })
        .run()
      db.insert(reminders)
        .values({
          id: newId(),
          userId,
          taskId: milkId,
          type: 'absolute',
          dueJson: JSON.stringify({
            date: '2026-07-20',
            time: '09:00',
            string: 'Jul 20 9am',
            recurrence: null,
          }),
          fireAtUtc: '2026-07-20T13:00:00.000Z',
        })
        .run()

      const doc = buildJsonExport({ db, userId }, '2026-07-15T00:00:00.000Z')
      expect(() => OpendoistExportSchema.parse(doc)).not.toThrow()
      expect(doc.format).toBe('opendoist-export')
      expect(doc.version).toBe(1)
      expect(doc.exportedAt).toBe('2026-07-15T00:00:00.000Z')

      expect(doc.projects.map((p) => p.name).sort()).toEqual(['Inbox', 'Work'])
      expect(doc.projects.find((p) => p.name === 'Inbox')?.isInbox).toBe(true)
      expect(doc.sections.map((s) => s.name)).toEqual(['Planning'])
      expect(doc.labels.map((l) => l.name)).toEqual(['home'])

      // Completed kept; soft-deleted dropped.
      const taskContents = doc.tasks.map((t) => t.content).sort()
      expect(taskContents).toEqual(['Buy milk', 'Daily standup', 'Done thing'])
      const milk = doc.tasks.find((t) => t.content === 'Buy milk')
      expect(milk?.labels).toEqual(['home'])
      expect(milk?.due).toEqual({
        date: '2026-07-20',
        time: null,
        string: 'Jul 20',
        recurrence: null,
      })
      const standup = doc.tasks.find((t) => t.content === 'Daily standup')
      expect(standup?.due?.recurrence).not.toBeNull()

      expect(doc.comments).toHaveLength(1)
      expect(doc.comments[0]?.attachment).toEqual({
        filename: 'plan.pdf',
        size: 2048,
        type: 'application/pdf',
      })
      expect(doc.reminders).toHaveLength(1)
      expect(doc.reminders[0]?.due?.string).toBe('Jul 20 9am')
    } finally {
      close()
    }
  })
})

/* ------------------------------------------------------------------ CSV rendering */

describe('escapeCsvField', () => {
  it('quotes fields with commas, quotes, or newlines and passes plain text through', () => {
    expect(escapeCsvField('plain')).toBe('plain')
    expect(escapeCsvField('a,b')).toBe('"a,b"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCsvField('')).toBe('')
  })
})

describe('renderProjectCsv', () => {
  it('separates sections with a blank row and keeps section-less tasks header-free', () => {
    const csv = renderProjectCsv({
      sections: [
        { id: 's1', name: 'Planning', sectionOrder: 0 },
        { id: 's2', name: 'Later', sectionOrder: 1 },
      ],
      tasks: [
        {
          id: 't0',
          parentId: null,
          sectionId: null,
          childOrder: 0,
          content: 'Loose task',
          description: '',
          priority: 4,
          dueString: null,
          dueDate: null,
          durationMin: null,
          deadlineDate: null,
          labels: [],
          comments: [],
        },
        {
          id: 't1',
          parentId: null,
          sectionId: 's1',
          childOrder: 0,
          content: 'Plan it',
          description: '',
          priority: 4,
          dueString: null,
          dueDate: null,
          durationMin: null,
          deadlineDate: null,
          labels: [],
          comments: [],
        },
        {
          id: 't2',
          parentId: null,
          sectionId: 's2',
          childOrder: 0,
          content: 'Do it later',
          description: '',
          priority: 4,
          dueString: null,
          dueDate: null,
          durationMin: null,
          deadlineDate: null,
          labels: [],
          comments: [],
        },
      ],
    })
    expect(csv).toBe(
      `${TODOIST_CSV_HEADER}\n` +
        'task,Loose task,,1,1,,,,,,,,,\n' +
        ',,,,,,,,,,,,,\n' +
        'section,Planning,,,,,,,,,,,,\n' +
        'task,Plan it,,1,1,,,,,,,,,\n' +
        ',,,,,,,,,,,,,\n' +
        'section,Later,,,,,,,,,,,,\n' +
        'task,Do it later,,1,1,,,,,,,,,\n',
    )
  })
})

describe('buildCsvFiles', () => {
  it('renders one project to the exact Todoist-compatible CSV', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const workId = newId()
      db.insert(projects).values({ id: workId, userId, name: 'Work', childOrder: 0 }).run()
      const secId = newId()
      db.insert(sections)
        .values({ id: secId, userId, projectId: workId, name: 'Planning', sectionOrder: 0 })
        .run()
      const workLabel = newId()
      const urgentLabel = newId()
      db.insert(labels).values({ id: workLabel, userId, name: 'work', itemOrder: 0 }).run()
      db.insert(labels).values({ id: urgentLabel, userId, name: 'urgent', itemOrder: 1 }).run()

      const draftId = newId()
      db.insert(tasks)
        .values({
          id: draftId,
          userId,
          projectId: workId,
          sectionId: secId,
          content: 'Draft roadmap',
          description: 'Outline the big rocks',
          priority: 1,
          dueDate: '2026-07-17',
          dueString: 'every friday',
          recurrence: RECURRENCE,
          durationMin: 45,
          deadlineDate: '2026-08-01',
          childOrder: 0,
        })
        .run()
      db.insert(taskLabels).values({ taskId: draftId, labelId: workLabel }).run()
      db.insert(taskLabels).values({ taskId: draftId, labelId: urgentLabel }).run()
      db.insert(comments)
        .values({
          id: newId(),
          userId,
          taskId: draftId,
          content: 'Remember: hiring plan, and budget',
          createdAt: '2026-07-10T14:03:22Z',
          updatedAt: '2026-07-10T14:03:22Z',
        })
        .run()
      db.insert(tasks)
        .values({
          id: newId(),
          userId,
          projectId: workId,
          sectionId: secId,
          parentId: draftId,
          content: 'Reference material',
          priority: 4,
          childOrder: 0,
        })
        .run()

      const files = buildCsvFiles({ db, userId })
      expect(files).toHaveLength(1)
      expect(files[0]?.name).toBe('Work.csv')
      expect(files[0]?.content).toBe(
        `${TODOIST_CSV_HEADER}\n` +
          'section,Planning,,,,,,,,,,,,\n' +
          'task,Draft roadmap @work @urgent,Outline the big rocks,4,1,,,every friday,en,,45,minute,2026-08-01,en\n' +
          'note,"Remember: hiring plan, and budget",,,,,,2026-07-10T14:03:22Z,,,,,,\n' +
          'task,Reference material,,1,2,,,,,,,,,\n',
      )
    } finally {
      close()
    }
  })

  it('excludes completed and archived rows and de-duplicates project filenames', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const a = newId()
      const b = newId()
      const archived = newId()
      db.insert(projects).values({ id: a, userId, name: 'Dupe', childOrder: 0 }).run()
      db.insert(projects).values({ id: b, userId, name: 'Dupe', childOrder: 1 }).run()
      db.insert(projects)
        .values({ id: archived, userId, name: 'Old', isArchived: true, childOrder: 2 })
        .run()
      db.insert(tasks)
        .values({ id: newId(), userId, projectId: a, content: 'Live', childOrder: 0 })
        .run()
      db.insert(tasks)
        .values({
          id: newId(),
          userId,
          projectId: a,
          content: 'Finished',
          completedAt: '2026-07-14T10:00:00Z',
          childOrder: 1,
        })
        .run()

      const files = buildCsvFiles({ db, userId })
      // archived project is skipped; duplicate names get a ` (2)` suffix.
      expect(files.map((f) => f.name)).toEqual(['Dupe.csv', 'Dupe (2).csv'])
      const dupeA = files[0]?.content ?? ''
      expect(dupeA).toContain('task,Live,,1,1,')
      expect(dupeA).not.toContain('Finished')
    } finally {
      close()
    }
  })
})

/* ------------------------------------------------------------------ round-trip through Task E */

describe('CSV export round-trips through the Todoist importer', () => {
  it('parses back to counts matching the seeded data', async () => {
    const { db, close } = await makeTestDb()
    try {
      const { userId } = await seedUser(db)
      const inboxId = newId()
      const workId = newId()
      db.insert(projects)
        .values({ id: inboxId, userId, name: 'Inbox', isInbox: true, childOrder: 0 })
        .run()
      db.insert(projects).values({ id: workId, userId, name: 'Work', childOrder: 1 }).run()
      const secId = newId()
      db.insert(sections)
        .values({ id: secId, userId, projectId: workId, name: 'Planning', sectionOrder: 0 })
        .run()
      const workLabel = newId()
      const urgentLabel = newId()
      db.insert(labels).values({ id: workLabel, userId, name: 'work', itemOrder: 0 }).run()
      db.insert(labels).values({ id: urgentLabel, userId, name: 'urgent', itemOrder: 1 }).run()

      db.insert(tasks)
        .values({ id: newId(), userId, projectId: inboxId, content: 'Buy milk', childOrder: 0 })
        .run()
      const draftId = newId()
      db.insert(tasks)
        .values({
          id: draftId,
          userId,
          projectId: workId,
          sectionId: secId,
          content: 'Draft roadmap',
          priority: 1,
          dueString: 'every friday',
          recurrence: RECURRENCE,
          durationMin: 45,
          deadlineDate: '2026-08-01',
          childOrder: 0,
        })
        .run()
      db.insert(taskLabels).values({ taskId: draftId, labelId: workLabel }).run()
      db.insert(taskLabels).values({ taskId: draftId, labelId: urgentLabel }).run()
      db.insert(comments)
        .values({
          id: newId(),
          userId,
          taskId: draftId,
          content: 'Remember the hiring plan',
          createdAt: '2026-07-10T14:03:22Z',
          updatedAt: '2026-07-10T14:03:22Z',
        })
        .run()
      db.insert(tasks)
        .values({
          id: newId(),
          userId,
          projectId: workId,
          sectionId: secId,
          parentId: draftId,
          content: 'Reference material',
          priority: 4,
          childOrder: 0,
        })
        .run()

      const zipPath = writeZipToDisk(await zipCsvFiles(buildCsvFiles({ db, userId })))
      const plan = await parseTodoistBackupZip(zipPath)
      const counts = planCounts(plan)
      expect(counts.projects).toBe(2)
      expect(counts.sections).toBe(1)
      expect(counts.labels).toBe(2)
      expect(counts.tasks).toBe(3)
      expect(counts.comments).toBe(1)
      expect(counts.skips).toBe(0)
      // The Inbox project is recognised from its filename, not created anew.
      expect(plan.projects.find((p) => p.isInbox)?.name).toBe('Inbox')
      // The subtask keeps its parent through the export → import cycle.
      const ref = plan.tasks.find((t) => t.content === 'Reference material')
      const draft = plan.tasks.find((t) => t.content === 'Draft roadmap')
      expect(ref?.parentKey).toBe(draft?.key)
    } finally {
      close()
    }
  })
})

/* ------------------------------------------------------------------ HTTP routes */

function inboxId(db: Db, userId: string): string {
  const row = db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)).get()
  if (row === undefined) throw new Error('no inbox project')
  return row.id
}

describe('export routes', () => {
  it('serves the JSON export as a schema-valid download', async () => {
    const t = await createTestApp()
    try {
      seedInboxTask(t.deps.db, t.userId, 'Exported task')
      const res = await t.get('/api/v1/export/json')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(res.headers.get('content-disposition')).toMatch(
        /^attachment; filename="opendoist-export-\d{4}-\d{2}-\d{2}\.json"$/,
      )
      const doc = OpendoistExportSchema.parse(await json<OpendoistExport>(res))
      expect(doc.tasks.some((task) => task.content === 'Exported task')).toBe(true)
    } finally {
      t.close()
    }
  })

  it('serves the CSV export as a zip of per-project files', async () => {
    const t = await createTestApp()
    try {
      seedInboxTask(t.deps.db, t.userId, 'Exported task')
      const res = await t.get('/api/v1/export/csv')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
      expect(res.headers.get('content-disposition')).toMatch(
        /^attachment; filename="opendoist-export-\d{4}-\d{2}-\d{2}\.zip"$/,
      )
      const zipPath = writeZipToDisk(Buffer.from(await res.arrayBuffer()))
      const zip = new StreamZip.async({ file: zipPath })
      try {
        const entries = await zip.entries()
        expect(Object.keys(entries)).toContain('Inbox.csv')
        const csv = (await zip.entryData('Inbox.csv')).toString('utf8')
        expect(csv.startsWith(TODOIST_CSV_HEADER)).toBe(true)
        expect(csv).toContain('task,Exported task,,1,1,')
      } finally {
        await zip.close()
      }
    } finally {
      t.close()
    }
  })

  it('rejects unauthenticated requests', async () => {
    const t = await createTestApp()
    try {
      expect((await t.request('/api/v1/export/json')).status).toBe(401)
      expect((await t.request('/api/v1/export/csv')).status).toBe(401)
    } finally {
      t.close()
    }
  })

  it('allows a read_write token but refuses a read-only token', async () => {
    const t = await createTestApp()
    try {
      const rw = (
        await json<{ token: string }>(
          await t.post('/api/v1/tokens', { name: 'rw', scope: 'read_write' }),
        )
      ).token
      const ro = (
        await json<{ token: string }>(await t.post('/api/v1/tokens', { name: 'ro', scope: 'read' }))
      ).token

      const okay = await t.request('/api/v1/export/json', {
        headers: { authorization: `Bearer ${rw}` },
      })
      expect(okay.status).toBe(200)

      const denied = await t.request('/api/v1/export/json', {
        headers: { authorization: `Bearer ${ro}` },
      })
      expect(denied.status).toBe(403)
    } finally {
      t.close()
    }
  })
})

/** Insert a plain task into the caller's Inbox (route tests don't need the seed-helper surface). */
function seedInboxTask(db: Db, userId: string, content: string): void {
  db.insert(tasks)
    .values({ id: newId(), userId, projectId: inboxId(db, userId), content, childOrder: 0 })
    .run()
}
