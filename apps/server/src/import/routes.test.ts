/**
 * Import routes + job-runner tests (phase 9 Task G). The parse/fetch/apply modules are mocked so
 * this task is green before Tasks E/F land; every assertion is about the HTTP + job-lifecycle
 * behavior this task owns (start → run → poll → report, concurrency 409, error surfacing).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { createTestApp, json, type TestApp } from '../test/helpers'
import { ImportJobDtoSchema, type ImportPlan, type ImportReport } from './types'

vi.mock('./todoist-csv', () => ({
  parseTodoistBackupZip: vi.fn(),
  parseTodoistProjectCsv: vi.fn(),
}))
vi.mock('./todoist-api', () => ({
  fetchTodoistExport: vi.fn(),
}))
vi.mock('./apply', () => ({
  applyImportPlan: vi.fn(),
  dryRunReport: vi.fn(),
}))

import { applyImportPlan, dryRunReport } from './apply'
import { fetchTodoistExport } from './todoist-api'
import { parseTodoistBackupZip } from './todoist-csv'

const mockParseZip = vi.mocked(parseTodoistBackupZip)
const mockFetch = vi.mocked(fetchTodoistExport)
const mockApply = vi.mocked(applyImportPlan)
const mockDryRun = vi.mocked(dryRunReport)

type ImportJobDto = z.infer<typeof ImportJobDtoSchema>

const fakePlan: ImportPlan = {
  source: 'todoist-csv',
  projects: [{ key: 'Inbox', name: 'Inbox', color: null, parentKey: null, isInbox: true }],
  sections: [],
  labels: [],
  tasks: [],
  skips: [],
}
const emptyCounts = { projects: 0, sections: 0, labels: 0, tasks: 0, comments: 0, skips: 0 }
const fakeReport: ImportReport = {
  mode: 'dry-run',
  counts: { ...emptyCounts, projects: 1 },
  created: { ...emptyCounts },
  skips: [],
}

let apps: TestApp[] = []
async function make(opts?: Parameters<typeof createTestApp>[0]): Promise<TestApp> {
  const t = await createTestApp(opts)
  apps.push(t)
  return t
}
beforeEach(() => {
  mockParseZip.mockReset()
  mockFetch.mockReset()
  mockApply.mockReset()
  mockDryRun.mockReset()
})
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
})

function csvForm(mode?: 'dry-run' | 'apply'): FormData {
  const fd = new FormData()
  fd.append(
    'file',
    new File([new Uint8Array([80, 75, 3, 4])], 'backup.zip', { type: 'application/zip' }),
  )
  if (mode !== undefined) fd.append('mode', mode)
  return fd
}
function postCsv(t: TestApp, mode?: 'dry-run' | 'apply'): Promise<Response> {
  return t.request('/api/v1/import/todoist-csv', {
    method: 'POST',
    headers: { cookie: t.cookie },
    body: csvForm(mode),
  })
}

/** Poll the job endpoint until it leaves the `running` state (or time out). */
async function waitForJob(t: TestApp, id: string, timeoutMs = 5000): Promise<ImportJobDto> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await t.get(`/api/v1/import/jobs/${id}`)
    expect(res.status).toBe(200)
    const dto = ImportJobDtoSchema.parse(await res.json())
    if (dto.status !== 'running') return dto
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`import job ${id} did not finish within ${timeoutMs}ms`)
}

it('runs a CSV dry-run to completion without calling apply', async () => {
  const t = await make()
  mockParseZip.mockResolvedValue(fakePlan)
  mockDryRun.mockReturnValue({ ...fakeReport, mode: 'dry-run' })

  const res = await postCsv(t, 'dry-run')
  expect(res.status).toBe(202)
  const { jobId } = await json<{ jobId: string }>(res)
  expect(jobId).toBeTruthy()

  const dto = await waitForJob(t, jobId)
  expect(dto.status).toBe('done')
  expect(dto.source).toBe('todoist-csv')
  expect(dto.mode).toBe('dry-run')
  expect(dto.progress.phase).toBe('done')
  expect(dto.report).not.toBeNull()
  expect(dto.report?.mode).toBe('dry-run')
  expect(dto.error).toBeNull()
  expect(dto.finishedAt).not.toBeNull()

  expect(mockParseZip).toHaveBeenCalledTimes(1)
  expect(mockDryRun).toHaveBeenCalledTimes(1)
  expect(mockApply).not.toHaveBeenCalled()
  // the raw body zod-validates as an ImportJobDto
  const raw = await (await t.get(`/api/v1/import/jobs/${jobId}`)).json()
  expect(() => ImportJobDtoSchema.parse(raw)).not.toThrow()
})

it('runs a CSV apply import calling applyImportPlan exactly once with the authed user', async () => {
  const t = await make()
  mockParseZip.mockResolvedValue(fakePlan)
  mockApply.mockReturnValue({ ...fakeReport, mode: 'apply' })

  const { jobId } = await json<{ jobId: string }>(await postCsv(t, 'apply'))
  const dto = await waitForJob(t, jobId)
  expect(dto.status).toBe('done')
  expect(dto.mode).toBe('apply')
  expect(dto.report?.mode).toBe('apply')

  expect(mockApply).toHaveBeenCalledTimes(1)
  expect(mockDryRun).not.toHaveBeenCalled()
  const [deps, plan] = mockApply.mock.calls[0] ?? []
  expect(deps?.userId).toBe(t.userId)
  expect(plan).toEqual(fakePlan)
})

it('defaults the mode to dry-run when the field is omitted', async () => {
  const t = await make()
  mockParseZip.mockResolvedValue(fakePlan)
  mockDryRun.mockReturnValue(fakeReport)

  const { jobId } = await json<{ jobId: string }>(await postCsv(t))
  const dto = await waitForJob(t, jobId)
  expect(dto.mode).toBe('dry-run')
  expect(mockDryRun).toHaveBeenCalledTimes(1)
  expect(mockApply).not.toHaveBeenCalled()
})

it('marks the job as error when parsing throws, leaving no report', async () => {
  const t = await make()
  mockParseZip.mockRejectedValue(new Error('corrupt backup zip'))

  const { jobId } = await json<{ jobId: string }>(await postCsv(t, 'dry-run'))
  const dto = await waitForJob(t, jobId)
  expect(dto.status).toBe('error')
  expect(dto.error).toContain('corrupt backup zip')
  expect(dto.progress.phase).toBe('error')
  expect(dto.report).toBeNull()
  expect(dto.finishedAt).not.toBeNull()
  expect(mockDryRun).not.toHaveBeenCalled()
  expect(mockApply).not.toHaveBeenCalled()
})

it('rejects a second import while one is running with 409', async () => {
  const t = await make()
  // Hold job 1 in the running state with a promise we control.
  let resolvePlan: (plan: ImportPlan) => void = () => {}
  mockParseZip.mockReturnValue(
    new Promise<ImportPlan>((resolve) => {
      resolvePlan = resolve
    }),
  )
  mockDryRun.mockReturnValue(fakeReport)

  const res1 = await postCsv(t, 'dry-run')
  expect(res1.status).toBe(202)
  const { jobId } = await json<{ jobId: string }>(res1)

  const res2 = await postCsv(t, 'dry-run')
  expect(res2.status).toBe(409)
  expect(res2.headers.get('content-type')).toContain('application/problem+json')

  // Let job 1 finish so the app closes cleanly and a later import could start again.
  resolvePlan(fakePlan)
  const dto = await waitForJob(t, jobId)
  expect(dto.status).toBe('done')

  const res3 = await postCsv(t, 'dry-run')
  expect(res3.status).toBe(202)
  await waitForJob(t, (await json<{ jobId: string }>(res3)).jobId)
})

it('starts a todoist-api import from JSON without echoing the token', async () => {
  const t = await make()
  mockFetch.mockResolvedValue({ ...fakePlan, source: 'todoist-api' })
  mockDryRun.mockReturnValue(fakeReport)

  const res = await t.post('/api/v1/import/todoist-api', {
    token: 'super-secret-token',
    mode: 'dry-run',
    baseUrl: 'https://todoist.example.test/api/v1',
  })
  expect(res.status).toBe(202)
  const body = await json<{ jobId: string }>(res)
  expect(JSON.stringify(body)).not.toContain('super-secret-token')

  const dto = await waitForJob(t, body.jobId)
  expect(dto.status).toBe('done')
  expect(dto.source).toBe('todoist-api')

  expect(mockFetch).toHaveBeenCalledTimes(1)
  const [token, opts] = mockFetch.mock.calls[0] ?? []
  expect(token).toBe('super-secret-token')
  expect(opts?.baseUrl).toBe('https://todoist.example.test/api/v1')
  expect(mockParseZip).not.toHaveBeenCalled()
})

it('validates the todoist-api body (missing token → 400)', async () => {
  const t = await make()
  const res = await t.post('/api/v1/import/todoist-api', { mode: 'apply' })
  expect(res.status).toBe(400)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  expect(mockFetch).not.toHaveBeenCalled()
})

it('rejects a multipart form with no file field with 400', async () => {
  const t = await make()
  const fd = new FormData()
  fd.append('mode', 'dry-run')
  const res = await t.request('/api/v1/import/todoist-csv', {
    method: 'POST',
    headers: { cookie: t.cookie },
    body: fd,
  })
  expect(res.status).toBe(400)
  expect(mockParseZip).not.toHaveBeenCalled()
})

it('404s an unknown job id', async () => {
  const t = await make()
  const res = await t.get('/api/v1/import/jobs/does-not-exist')
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
})

it('requires authentication on every import route', async () => {
  const t = await make()
  const csv = await t.request('/api/v1/import/todoist-csv', { method: 'POST', body: csvForm() })
  expect(csv.status).toBe(401)
  const api = await t.request('/api/v1/import/todoist-api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'x' }),
  })
  expect(api.status).toBe(401)
  const jobs = await t.request('/api/v1/import/jobs/whatever')
  expect(jobs.status).toBe(401)
})

it('publishes all three import routes in the OpenAPI document', async () => {
  const t = await make()
  const doc = await json<{ paths: Record<string, Record<string, unknown>> }>(
    await t.get('/api/v1/openapi.json'),
  )
  expect(doc.paths['/api/v1/import/todoist-csv']).toHaveProperty('post')
  expect(doc.paths['/api/v1/import/todoist-api']).toHaveProperty('post')
  expect(doc.paths['/api/v1/import/jobs/{id}']).toHaveProperty('get')
})
