import { describe, expect, it } from 'vitest'
import {
  availableSources,
  countRows,
  fetchedSummary,
  ImportJobSchema,
  ImportStartResponseSchema,
  phaseLabel,
} from './import-format'

describe('availableSources', () => {
  it('detects both sources', () => {
    expect(availableSources(['todoist-csv', 'todoist-api'])).toEqual({ csv: true, api: true })
  })
  it('detects a single source', () => {
    expect(availableSources(['todoist-api'])).toEqual({ csv: false, api: true })
    expect(availableSources(['todoist-csv'])).toEqual({ csv: true, api: false })
  })
  it('treats undefined / empty / unknown as none available', () => {
    expect(availableSources(undefined)).toEqual({ csv: false, api: false })
    expect(availableSources([])).toEqual({ csv: false, api: false })
    expect(availableSources(['asana', 'trello'])).toEqual({ csv: false, api: false })
  })
})

describe('phaseLabel', () => {
  it('maps every phase to a non-empty label', () => {
    for (const phase of [
      'uploading',
      'fetching',
      'parsing',
      'applying',
      'done',
      'error',
    ] as const) {
      expect(phaseLabel(phase).length).toBeGreaterThan(0)
    }
  })
})

describe('fetchedSummary', () => {
  it('joins only positive counts, lowercased and ordered', () => {
    expect(fetchedSummary({ projects: 2, labels: 0, tasks: 4 })).toBe('2 projects, 4 tasks')
  })
  it('is empty when nothing was fetched', () => {
    expect(fetchedSummary(undefined)).toBe('')
    expect(fetchedSummary({})).toBe('')
    expect(fetchedSummary({ projects: 0, tasks: 0 })).toBe('')
  })
})

describe('countRows', () => {
  it('pairs found with created for every entity in a fixed order', () => {
    const counts = { projects: 2, sections: 3, labels: 4, tasks: 10, comments: 5, skips: 1 }
    const created = { projects: 1, sections: 3, labels: 2, tasks: 10, comments: 5, skips: 0 }
    const rows = countRows({ counts, created })
    expect(rows.map((r) => r.key)).toEqual(['projects', 'sections', 'labels', 'tasks', 'comments'])
    expect(rows[0]).toEqual({ key: 'projects', label: 'Projects', found: 2, created: 1 })
    expect(rows[3]).toEqual({ key: 'tasks', label: 'Tasks', found: 10, created: 10 })
    // `skips` is a report-level list, never a count row.
    expect(rows.some((r) => r.key === 'skips')).toBe(false)
  })
})

describe('ImportStartResponseSchema', () => {
  it('parses a 202 start response', () => {
    expect(ImportStartResponseSchema.parse({ jobId: 'imp_123' })).toEqual({ jobId: 'imp_123' })
  })
  it('rejects a missing jobId', () => {
    expect(() => ImportStartResponseSchema.parse({})).toThrow()
  })
})

describe('ImportJobSchema', () => {
  it('parses a running job with partial fetched counts', () => {
    const job = ImportJobSchema.parse({
      id: 'j1',
      source: 'todoist-api',
      mode: 'dry-run',
      status: 'running',
      progress: { phase: 'fetching', detail: '', fetched: { projects: 2, tasks: 4 } },
      report: null,
      error: null,
      createdAt: '2026-07-15T00:00:00Z',
      finishedAt: null,
    })
    expect(job.status).toBe('running')
    expect(job.progress.fetched?.tasks).toBe(4)
    expect(job.report).toBeNull()
  })

  it('parses a finished dry-run job carrying a report and skips', () => {
    const counts = { projects: 2, sections: 2, labels: 1, tasks: 6, comments: 1, skips: 1 }
    const job = ImportJobSchema.parse({
      id: 'j2',
      source: 'todoist-csv',
      mode: 'dry-run',
      status: 'done',
      progress: { phase: 'done', detail: '' },
      report: {
        mode: 'dry-run',
        counts,
        created: { ...counts, projects: 1 },
        skips: [{ entity: 'task', ref: 'Book flights', reason: 'assignee dropped' }],
      },
      error: null,
      createdAt: '2026-07-15T00:00:00Z',
      finishedAt: '2026-07-15T00:00:01Z',
    })
    expect(job.report?.created.projects).toBe(1)
    expect(job.report?.skips[0]?.reason).toBe('assignee dropped')
  })

  it('rejects an unknown status', () => {
    expect(() =>
      ImportJobSchema.parse({
        id: 'x',
        source: 'todoist-csv',
        mode: 'apply',
        status: 'queued',
        progress: { phase: 'parsing' },
        report: null,
        error: null,
        createdAt: 'x',
        finishedAt: null,
      }),
    ).toThrow()
  })
})
