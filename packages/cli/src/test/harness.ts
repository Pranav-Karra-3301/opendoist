import { vi } from 'vitest'
import type { ProjectDto, TaskDto } from '../lib/api'
import { io } from '../lib/context'
import { buildProgram } from '../program'

export interface CliRun {
  code: number
  stdout: string
  stderr: string
  lines: string[]
}
/** Run the CLI in-process with captured io; returns exit code + output. */
export async function runCli(argv: string[]): Promise<CliRun> {
  const out: string[] = []
  const errLines: string[] = []
  const outSpy = vi.spyOn(io, 'out').mockImplementation((text) => void out.push(text))
  const errSpy = vi.spyOn(io, 'err').mockImplementation((text) => void errLines.push(text))
  const prevExit = process.exitCode
  process.exitCode = undefined
  try {
    await buildProgram().parseAsync(['node', 'opentask', ...argv])
  } catch (error) {
    const ce = error as { exitCode?: number }
    process.exitCode = typeof ce.exitCode === 'number' ? ce.exitCode : 1
  } finally {
    outSpy.mockRestore()
    errSpy.mockRestore()
  }
  const code = typeof process.exitCode === 'number' ? process.exitCode : 0
  process.exitCode = prevExit
  return { code, stdout: out.join('\n'), stderr: errLines.join('\n'), lines: out }
}

export interface RouteDef {
  method: string
  path: string
  status?: number
  body?: unknown
  /** all listed params must match exactly */
  query?: Record<string, string>
  /** consume this route after its first match (for pagination sequences) */
  once?: boolean
}
export interface RecordedCall {
  method: string
  url: URL
  body: unknown
  headers: Record<string, string>
}
const JSON_HEADERS = { 'content-type': 'application/json' }
/** Installs a fetch mock (vi.stubGlobal). Call vi.unstubAllGlobals() in afterEach. */
export function installMockFetch(routes: RouteDef[]): RecordedCall[] {
  const calls: RecordedCall[] = []
  const live = [...routes]
  vi.stubGlobal(
    'fetch',
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      calls.push({
        method,
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      })
      const index = live.findIndex(
        (r) =>
          r.method === method &&
          r.path === url.pathname &&
          (r.query === undefined ||
            Object.entries(r.query).every(([k, v]) => url.searchParams.get(k) === v)),
      )
      if (index === -1) {
        const problem = {
          title: 'not found',
          detail: `no mock for ${method} ${url.pathname}${url.search}`,
        }
        return new Response(JSON.stringify(problem), { status: 404, headers: JSON_HEADERS })
      }
      const route = live[index] as RouteDef
      if (route.once === true) live.splice(index, 1)
      const status = route.status ?? 200
      if (status === 204) return new Response(null, { status })
      return new Response(JSON.stringify(route.body ?? {}), { status, headers: JSON_HEADERS })
    },
  )
  return calls
}

export const TEST_URL = 'https://od.example.com'
/** Credentials via env; config path pointed at nowhere; colors off. Call vi.unstubAllEnvs() in afterEach. */
export function stubAuthEnv(url: string = TEST_URL): void {
  vi.stubEnv('OPENTASK_URL', url)
  vi.stubEnv('OPENTASK_TOKEN', 'ot_testtoken123')
  vi.stubEnv('OPENTASK_CONFIG_PATH', '/nonexistent/opentask-test/config.json')
  vi.stubEnv('NO_COLOR', '1')
  vi.stubEnv('FORCE_COLOR', '')
}
/** Wrap a list in a single cursor page. */
export function page<T>(
  results: T[],
  nextCursor: string | null = null,
): { results: T[]; next_cursor: string | null } {
  return { results, next_cursor: nextCursor }
}

export function sampleTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'tsk_1',
    content: 'Submit report',
    description: '',
    project_id: 'prj_inbox',
    section_id: null,
    parent_id: null,
    priority: 4,
    due: null,
    deadline_date: null,
    duration_min: null,
    labels: [],
    child_order: 1,
    day_order: 1,
    uncompletable: false,
    completed_at: null,
    created_at: '2026-07-15T12:00:00Z',
    ...overrides,
  }
}
export function sampleProject(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: 'prj_inbox',
    name: 'Inbox',
    color: 'grey',
    parent_id: null,
    child_order: 0,
    is_favorite: false,
    is_archived: false,
    is_inbox: true,
    ...overrides,
  }
}
