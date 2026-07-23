import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import archiver from 'archiver'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseTodoistBackupZip, parseTodoistProjectCsv } from './todoist-csv'

const HEADER =
  'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG'

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

describe('parseTodoistProjectCsv', () => {
  const result = parseTodoistProjectCsv('Work', workCsv)
  const byContent = (c: string) => result.tasks.find((t) => t.content === c)
  const sectionKey = (name: string) => result.sections.find((s) => s.name === name)?.key ?? null

  it('parses sections in order, ignoring separator/header rows', () => {
    expect(result.sections.map((s) => [s.name, s.order])).toEqual([
      ['Planning', 0],
      ['Later', 1],
    ])
    expect(result.sections.every((s) => s.projectKey === 'Work')).toBe(true)
  })

  it('parses all four tasks', () => {
    expect(result.tasks).toHaveLength(4)
  })

  it('maps priority (inverted), strips labels, and keeps due/deadline/duration/comment', () => {
    const roadmap = byContent('Draft Q3 roadmap')
    expect(roadmap).toBeDefined()
    expect(roadmap?.labels).toEqual(['work'])
    expect(roadmap?.priority).toBe(1) // CSV 4 → 5 - 4
    expect(roadmap?.dueString).toBe('every friday')
    expect(roadmap?.dueDate).toBeNull()
    expect(roadmap?.durationMin).toBe(45)
    expect(roadmap?.deadline).toBe('2026-08-01')
    expect(roadmap?.description).toBe('Outline the big rocks')
    expect(roadmap?.sectionKey).toBe(sectionKey('Planning'))
    expect(roadmap?.parentKey).toBeNull()
    expect(roadmap?.comments).toEqual([
      { content: 'Remember to include the hiring plan', postedAt: '2026-07-10T14:03:22Z' },
    ])
  })

  it('nests an indented subtask under the preceding task and keeps its "* " prefix', () => {
    const roadmap = byContent('Draft Q3 roadmap')
    const ref = byContent('* Reference material')
    expect(ref).toBeDefined()
    expect(ref?.parentKey).toBe(roadmap?.key)
    expect(ref?.priority).toBe(4) // CSV 1 → 5 - 1
    expect(ref?.content).toBe('* Reference material')
    expect(ref?.sectionKey).toBe(sectionKey('Planning'))
  })

  it('extracts multiple labels and drops the assignee with a skip', () => {
    const flights = byContent('Book flights')
    expect(flights?.labels).toEqual(['travel', 'work'])
    expect(flights?.priority).toBe(2) // CSV 3 → 5 - 3
    expect(flights?.dueString).toBe('Jul 22')
    expect(flights?.parentKey).toBeNull()
    expect(result.skips).toEqual([
      { entity: 'task', ref: 'Book flights', reason: 'assignee dropped' },
    ])
  })

  it('assigns the task after a separator to the next section', () => {
    const water = byContent('Water plants')
    expect(water?.sectionKey).toBe(sectionKey('Later'))
    expect(water?.dueString).toBe('every! 3 days')
    expect(water?.priority).toBe(4)
  })

  it('returns project label names deduped, first spelling', () => {
    expect(result.labels).toEqual(['work', 'travel'])
  })
})

describe('parseTodoistProjectCsv — tolerances and edge cases', () => {
  it('tolerates a UTF-8 BOM', () => {
    const withBom = parseTodoistProjectCsv('Work', `﻿${workCsv}`)
    expect(withBom.tasks).toHaveLength(4)
    expect(withBom.sections).toHaveLength(2)
  })

  it('tolerates old exports missing DURATION/DEADLINE columns', () => {
    const short = `TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE\ntask,Legacy task,,1,1,Me,,tomorrow`
    const r = parseTodoistProjectCsv('Old', short)
    expect(r.tasks).toHaveLength(1)
    expect(r.tasks[0]?.durationMin).toBeNull()
    expect(r.tasks[0]?.deadline).toBeNull()
    expect(r.tasks[0]?.dueString).toBe('tomorrow')
    expect(r.tasks[0]?.priority).toBe(4)
  })

  it('dedupes labels case-insensitively keeping the first spelling', () => {
    const r = parseTodoistProjectCsv('L', `${HEADER}\ntask,Ping @Work @work @WORK team,,1,1,Me,,,`)
    expect(r.labels).toEqual(['Work'])
    expect(r.tasks[0]?.content).toBe('Ping team')
    expect(r.tasks[0]?.labels).toEqual(['Work'])
  })

  it('strips [[file …]] markers from notes and records an attachment skip', () => {
    const csv = `${HEADER}\ntask,Has attachment,,1,1,Me,,,\nnote,See the doc [[file https://x/y.pdf "y.pdf"]] thanks,,,,Me,,2026-01-01T00:00:00Z,`
    const r = parseTodoistProjectCsv('A', csv)
    expect(r.tasks[0]?.comments).toEqual([
      { content: 'See the doc thanks', postedAt: '2026-01-01T00:00:00Z' },
    ])
    expect(r.skips).toContainEqual({
      entity: 'comment',
      ref: 'Has attachment',
      reason: 'attachment dropped',
    })
  })

  it('promotes an indented task with no eligible ancestor to top-level with a skip', () => {
    const r = parseTodoistProjectCsv('O', `${HEADER}\nsection,S,,,,,,\ntask,Orphan sub,,1,2,Me,,,`)
    expect(r.tasks[0]?.parentKey).toBeNull()
    expect(r.skips).toContainEqual({
      entity: 'task',
      ref: 'Orphan sub',
      reason: 'subtask promoted to top-level',
    })
  })

  it('converts a day-unit duration to minutes, capping at 1440 with a skip', () => {
    const capped = parseTodoistProjectCsv('D', `${HEADER}\ntask,Long thing,,1,1,Me,,,,,2,day,,`)
    expect(capped.tasks[0]?.durationMin).toBe(1440)
    expect(capped.skips).toContainEqual({
      entity: 'task',
      ref: 'Long thing',
      reason: 'duration capped to 1 day',
    })
    const oneDay = parseTodoistProjectCsv('D', `${HEADER}\ntask,One day,,1,1,Me,,,,,1,day,,`)
    expect(oneDay.tasks[0]?.durationMin).toBe(1440)
    expect(oneDay.skips).toHaveLength(0)
  })
})

describe('parseTodoistBackupZip', () => {
  let dir: string
  let zipPath: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'opentask-import-'))
    zipPath = join(dir, 'todoist-backup.zip')
    await zipFiles(zipPath, [
      { name: 'Work [220474322].csv', content: workCsv },
      { name: 'Inbox.csv', content: inboxCsv },
    ])
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('derives project names from filenames and flags the Inbox', async () => {
    const plan = await parseTodoistBackupZip(zipPath)
    expect(plan.source).toBe('todoist-csv')
    const projects = plan.projects.map((p) => [p.name, p.isInbox])
    expect(projects).toContainEqual(['Work', false])
    expect(projects).toContainEqual(['Inbox', true])
    expect(plan.projects).toHaveLength(2)
  })

  it('aggregates sections, tasks, and labels across projects', async () => {
    const plan = await parseTodoistBackupZip(zipPath)
    expect(plan.sections).toHaveLength(2)
    expect(plan.tasks).toHaveLength(6) // 4 Work + 2 Inbox
    expect(plan.labels.map((l) => l.name)).toEqual(['work', 'travel'])
    expect(plan.labels.every((l) => l.color === null)).toBe(true)
    const inboxTasks = plan.tasks.filter((t) => t.projectKey === 'Inbox').map((t) => t.content)
    expect(inboxTasks).toEqual(['Buy milk', 'Call dentist'])
  })
})
