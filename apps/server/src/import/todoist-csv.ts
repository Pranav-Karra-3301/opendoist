/**
 * Todoist backup-ZIP CSV importer — phase 9 Task E.
 * Pure parsing (no db access): both functions return normalized ImportPlan fragments.
 *
 * A Todoist backup zip holds one CSV per project. Each CSV uses the fixed 14-column header
 * (TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,
 *  DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG); older exports omit trailing columns.
 * `TYPE` is one of `section` | `task` | `note`; an all-empty row separates section groups.
 */
import type { Priority } from '@opendoist/core'
import { parse } from 'csv-parse/sync'
import StreamZip from 'node-stream-zip'
import type { ImportPlan } from './types'

type ImportTask = ImportPlan['tasks'][number]
type ImportSkip = ImportPlan['skips'][number]
type ProjectCsvResult = Pick<ImportPlan, 'sections' | 'tasks' | 'skips'> & { labels: string[] }

/** Todoist CSV priority is inverted (4 = urgent); OpenDoist uses 1 = highest. */
const PRIORITY_FROM_CSV: Record<number, Priority> = { 1: 4, 2: 3, 3: 2, 4: 1 }
/** @name label token; captures the leading boundary so the whole run can be stripped from content. */
const LABEL_RE = /(^|\s)@([\p{L}\p{N}_-]+)/gu
/** Todoist file-attachment marker inside a note, e.g. `[[file https://… "name.pdf"]]`. */
const FILE_MARKER_RE = /\[\[file\b[^\]]*\]\]/gi
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseIntOr(s: string, fallback: number): number {
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Pull `@labels` out of content (deduped, first-spelling, case-insensitive) and return the rest. */
function extractLabels(rawContent: string): { content: string; labels: string[] } {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const m of rawContent.matchAll(LABEL_RE)) {
    const name = m[2]
    if (name === undefined) continue
    const lc = name.toLowerCase()
    if (!seen.has(lc)) {
      seen.add(lc)
      labels.push(name)
    }
  }
  const content = rawContent
    .replace(LABEL_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { content, labels }
}

/** Convert a Todoist DURATION/DURATION_UNIT pair to minutes (day ⇒ ×1440), capped at 1440. */
function parseDuration(rawDur: string, rawUnit: string): { min: number | null; capped: boolean } {
  const amount = Number.parseInt(rawDur, 10)
  if (!Number.isFinite(amount) || amount < 1) return { min: null, capped: false }
  const raw = rawUnit.trim().toLowerCase().startsWith('day') ? amount * 1440 : amount
  return { min: Math.min(raw, 1440), capped: raw > 1440 }
}

function stripFileMarker(content: string): { text: string; hadAttachment: boolean } {
  const cleaned = content.replace(FILE_MARKER_RE, '')
  if (cleaned === content) return { text: content, hadAttachment: false }
  return { text: cleaned.replace(/\s{2,}/g, ' ').trim(), hadAttachment: true }
}

interface Ancestor {
  key: string
  indent: number
}

/**
 * Parse one project CSV export. `projectName` doubles as the plan-local `projectKey`.
 * `labels` returns label NAMES found across the project (deduped, first spelling).
 */
export function parseTodoistProjectCsv(projectName: string, csvText: string): ProjectCsvResult {
  const sections: ImportPlan['sections'] = []
  const tasks: ImportTask[] = []
  const skips: ImportSkip[] = []
  const labelSeen = new Set<string>()
  const labelNames: string[] = []

  const records = parse(csvText.replace(/^﻿/, ''), {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as string[][]

  const header = records[0]
  if (header === undefined) return { sections, tasks, skips, labels: labelNames }
  const col: Record<string, number> = {}
  header.forEach((h, i) => {
    col[h.trim().toUpperCase()] = i
  })
  const get = (row: string[], name: string): string => {
    const i = col[name]
    if (i === undefined) return ''
    return row[i] ?? ''
  }

  let currentSectionKey: string | null = null
  let sectionCounter = 0
  let taskCounter = 0
  let ancestors: Ancestor[] = []
  let lastTaskIndex: number | null = null

  const addLabels = (names: string[]): void => {
    for (const name of names) {
      const lc = name.toLowerCase()
      if (!labelSeen.has(lc)) {
        labelSeen.add(lc)
        labelNames.push(name)
      }
    }
  }

  for (let r = 1; r < records.length; r++) {
    const row = records[r]
    if (row === undefined) continue
    const type = get(row, 'TYPE').trim().toLowerCase()
    const empty = row.every((c) => (c ?? '').trim() === '')
    if (type === '' || empty) {
      // separator row: end the current indent/note grouping
      ancestors = []
      lastTaskIndex = null
      continue
    }

    if (type === 'section') {
      const name = get(row, 'CONTENT').trim()
      if (name === '') continue
      const key = `${projectName}::sec::${sectionCounter}`
      sections.push({ key, projectKey: projectName, name, order: sectionCounter })
      currentSectionKey = key
      sectionCounter += 1
      ancestors = []
      lastTaskIndex = null
      continue
    }

    if (type === 'note') {
      const { text, hadAttachment } = stripFileMarker(get(row, 'CONTENT'))
      const postedAt = get(row, 'DATE').trim() || null
      if (lastTaskIndex === null) {
        skips.push({ entity: 'comment', ref: text || '(note)', reason: 'orphan note dropped' })
        continue
      }
      const parent = tasks[lastTaskIndex]
      if (parent === undefined) continue
      parent.comments.push({ content: text, postedAt })
      if (hadAttachment) {
        skips.push({ entity: 'comment', ref: parent.content, reason: 'attachment dropped' })
      }
      continue
    }

    if (type !== 'task') continue

    const { content, labels } = extractLabels(get(row, 'CONTENT'))
    if (content === '') {
      skips.push({ entity: 'task', ref: '(empty)', reason: 'empty content' })
      continue
    }
    const csvPriority = clamp(parseIntOr(get(row, 'PRIORITY'), 1), 1, 4)
    const priority = PRIORITY_FROM_CSV[csvPriority] ?? 4
    const indent = clamp(parseIntOr(get(row, 'INDENT'), 1), 1, 99)

    while (ancestors.length > 0) {
      const top = ancestors[ancestors.length - 1]
      if (top !== undefined && top.indent >= indent) ancestors.pop()
      else break
    }
    let parentKey: string | null = null
    if (indent > 1) {
      const top = ancestors[ancestors.length - 1]
      if (top !== undefined) parentKey = top.key
      else skips.push({ entity: 'task', ref: content, reason: 'subtask promoted to top-level' })
    }

    const dueRaw = get(row, 'DATE').trim()
    const deadlineRaw = get(row, 'DEADLINE').trim()
    const { min: durationMin, capped } = parseDuration(
      get(row, 'DURATION'),
      get(row, 'DURATION_UNIT'),
    )
    if (capped) skips.push({ entity: 'task', ref: content, reason: 'duration capped to 1 day' })
    if (get(row, 'RESPONSIBLE').trim() !== '') {
      skips.push({ entity: 'task', ref: content, reason: 'assignee dropped' })
    }
    addLabels(labels)

    const key = `${projectName}::task::${taskCounter}`
    tasks.push({
      key,
      projectKey: projectName,
      sectionKey: currentSectionKey,
      parentKey,
      content,
      description: get(row, 'DESCRIPTION'),
      priority,
      dueString: dueRaw === '' ? null : dueRaw,
      dueDate: null,
      dueTime: null,
      deadline: ISO_DATE_RE.test(deadlineRaw) ? deadlineRaw : null,
      durationMin,
      labels,
      childOrder: taskCounter,
      comments: [],
    })
    ancestors.push({ key, indent })
    lastTaskIndex = tasks.length - 1
    taskCounter += 1
  }

  return { sections, tasks, skips, labels: labelNames }
}

/** Strip directory, `.csv`, and a trailing ` [digits]` id off a backup entry name. */
function cleanProjectName(entryName: string): string {
  const base = entryName.split('/').pop() ?? entryName
  const noExt = base.replace(/\.csv$/i, '')
  const noId = noExt.replace(/\s*\[\d+\]\s*$/, '').trim()
  return noId || noExt.trim() || base
}

/** Streams a Todoist backup zip (one CSV per project) into a normalized ImportPlan. */
export async function parseTodoistBackupZip(zipPath: string): Promise<ImportPlan> {
  const projects: ImportPlan['projects'] = []
  const sections: ImportPlan['sections'] = []
  const tasks: ImportTask[] = []
  const skips: ImportSkip[] = []
  const labelSeen = new Set<string>()
  const labelNames: string[] = []
  const usedNames = new Set<string>()

  const zip = new StreamZip.async({ file: zipPath })
  try {
    const entries = await zip.entries()
    const csvEntries = Object.values(entries)
      .filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.csv'))
      .sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of csvEntries) {
      const csvText = (await zip.entryData(entry.name)).toString('utf8')
      const cleaned = cleanProjectName(entry.name)
      let projectName = cleaned
      let n = 2
      while (usedNames.has(projectName.toLowerCase())) {
        projectName = `${cleaned} (${n})`
        n += 1
      }
      usedNames.add(projectName.toLowerCase())

      projects.push({
        key: projectName,
        name: projectName,
        color: null,
        parentKey: null,
        isInbox: projectName.toLowerCase() === 'inbox',
      })

      const parsed = parseTodoistProjectCsv(projectName, csvText)
      sections.push(...parsed.sections)
      tasks.push(...parsed.tasks)
      skips.push(...parsed.skips)
      for (const name of parsed.labels) {
        const lc = name.toLowerCase()
        if (!labelSeen.has(lc)) {
          labelSeen.add(lc)
          labelNames.push(name)
        }
      }
    }
  } finally {
    await zip.close()
  }

  const labels = labelNames.map((name) => ({
    key: `label::${name.toLowerCase()}`,
    name,
    color: null,
  }))
  return { source: 'todoist-csv', projects, sections, labels, tasks, skips }
}
