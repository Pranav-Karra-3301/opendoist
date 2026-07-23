import type { Priority } from '@opentask/core'
import { ApiError, AuthError, NetworkError } from './errors'

// DTOs are the CLI-consumed subset of the server's wire shapes (AS-BUILT reconciled against
// apps/server @ fb558ab — the server sends extra fields like updated_at/is_collapsed we ignore).
export interface DueDto {
  date: string
  time: string | null
  string: string
  is_recurring: boolean
}
export interface TaskDto {
  id: string
  content: string
  description: string
  project_id: string
  section_id: string | null
  parent_id: string | null
  priority: Priority
  due: DueDto | null
  deadline_date: string | null
  /** HH:mm wall-clock deadline time; null/absent = date-only (quick-add UX pass). */
  deadline_time?: string | null
  duration_min: number | null
  labels: string[]
  child_order: number
  day_order: number
  uncompletable: boolean
  completed_at: string | null
  created_at: string // phase 3's field name — NOT Todoist's added_at
}
export interface ProjectDto {
  id: string
  name: string
  color: string
  parent_id: string | null
  child_order: number
  is_favorite: boolean
  is_archived: boolean
  is_inbox: boolean
}
export interface SectionDto {
  id: string
  project_id: string
  name: string
  section_order: number
}
export interface LabelDto {
  id: string
  name: string
  color: string
  item_order: number
  is_favorite: boolean
}
export interface FilterDto {
  id: string
  name: string
  query: string
  color: string
  item_order: number
  is_favorite: boolean
}
/** phase 3's GET /user returns id/name/email/two_factor_enabled/created_at — NO timezone
 *  (timezone lives in the /user/settings document; the CLI parses/groups in the SYSTEM
 *  timezone and `login` warns when the account timezone differs — see commands/auth.ts). */
export interface UserDto {
  id: string
  email: string
  name: string
}
/** CLI-consumed subset of GET /user/settings (the document carries many more client prefs).
 *  `timezone` is what the server parses quick-add date phrases with — 'UTC' by default. */
export interface SettingsDto {
  timezone: string
  [key: string]: unknown
}
export interface InfoDto {
  version: string
  [key: string]: unknown
}
/** one hit from phase 3's GET /search */
export interface SearchHitDto {
  task: TaskDto
  matched_in: 'task' | 'comment'
}
export interface Page<T> {
  results: T[]
  next_cursor: string | null
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Query = Record<string, string | number | boolean | undefined>

/** Human-readable reason for a fetch() rejection. Node wraps network failures in
 *  `TypeError('fetch failed', { cause })`, and on macOS an ECONNREFUSED cause is an
 *  AggregateError whose own message is EMPTY — so walk the cause chain (and aggregate
 *  members) for the first real message, then fall back to an error code, then the
 *  literal 'fetch failed'. Never returns ''. */
function fetchFailureReason(rejection: unknown): string {
  let code: string | null = null
  const queue: unknown[] = [rejection]
  while (queue.length > 0) {
    const error = queue.shift()
    if (!(error instanceof Error)) continue
    if (error.message !== '' && error.message !== 'fetch failed') return error.message
    if (code === null) {
      const errorCode = (error as { code?: unknown }).code
      if (typeof errorCode === 'string' && errorCode !== '') code = errorCode
    }
    if (error instanceof AggregateError) queue.push(...error.errors)
    if (error.cause !== undefined) queue.push(error.cause)
  }
  return code ?? 'fetch failed'
}

export class ApiClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string | null,
  ) {}

  async request<T>(
    method: HttpMethod,
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.token !== null) headers.authorization = `Bearer ${this.token}`
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    } catch (cause) {
      throw new NetworkError(`cannot reach ${this.baseUrl} (${fetchFailureReason(cause)})`)
    }
    if (res.status === 401)
      throw new AuthError(
        'unauthorized (401): token missing, expired, or revoked',
        'run `opentask login` with a fresh ot_ token from Settings → Integrations (if a working token suddenly gets 401s, the server may be rate-limiting API keys)',
      )
    if (res.status === 403)
      throw new AuthError(
        'forbidden (403): token lacks the required scope',
        'create a token with read_write scope',
      )
    if (!res.ok) {
      let detail = res.statusText
      let problem: unknown = null
      try {
        problem = await res.json()
        const p = problem as { title?: string; detail?: string }
        detail = p.detail ?? p.title ?? detail
      } catch {} // non-JSON error body
      throw new ApiError(`${method} ${path} failed (${res.status}): ${detail}`, res.status, problem)
    }
    if (res.status === 204) return undefined as T
    try {
      return (await res.json()) as T
    } catch {
      // 2xx but not JSON — an SPA catch-all or some other website, not an OpenTask API.
      throw new ApiError(
        `${method} ${path} returned ${res.status} with a non-JSON body — not an OpenTask server?`,
        res.status,
        null,
      )
    }
  }

  /** Drains cursor pagination: {results, next_cursor} until next_cursor is null.
   *  Default page size 200; callers may override via query.limit (search caps at 50 server-side). */
  async listAll<T>(path: string, query: Query = {}): Promise<T[]> {
    const out: T[] = []
    let cursor: string | null = null
    do {
      const page: Page<T> = await this.request('GET', path, {
        query: { limit: 200, ...query, cursor: cursor ?? undefined },
      })
      out.push(...page.results)
      cursor = page.next_cursor
    } while (cursor !== null)
    return out
  }

  // resource methods — the CLI's single source of truth for server paths.
  // NOTE: there is NO /tasks/filter endpoint — filter queries are evaluated locally (Task E).
  private id = (id: string) => encodeURIComponent(id)
  info(): Promise<InfoDto> {
    return this.request('GET', '/api/v1/info')
  }
  me(): Promise<UserDto> {
    return this.request('GET', '/api/v1/user')
  }
  settings(): Promise<SettingsDto> {
    return this.request('GET', '/api/v1/user/settings')
  }
  quickAdd(text: string): Promise<TaskDto> {
    return this.request('POST', '/api/v1/tasks/quick', { body: { text } })
  }
  /** open tasks only */
  listTasks(query: { project_id?: string } = {}): Promise<TaskDto[]> {
    return this.listAll('/api/v1/tasks', query)
  }
  /** completed listing is its OWN route — no ?completed= param exists */
  listCompletedTasks(query: { project_id?: string } = {}): Promise<TaskDto[]> {
    return this.listAll('/api/v1/tasks/completed', query)
  }
  getTask(id: string): Promise<TaskDto> {
    return this.request('GET', `/api/v1/tasks/${this.id(id)}`)
  }
  closeTask(id: string): Promise<void> {
    return this.request('POST', `/api/v1/tasks/${this.id(id)}/close`)
  }
  reopenTask(id: string): Promise<void> {
    return this.request('POST', `/api/v1/tasks/${this.id(id)}/reopen`)
  }
  deleteTask(id: string): Promise<void> {
    return this.request('DELETE', `/api/v1/tasks/${this.id(id)}`)
  }
  listProjects(): Promise<ProjectDto[]> {
    return this.listAll('/api/v1/projects')
  }
  createProject(body: { name: string; color?: string; parent_id?: string }): Promise<ProjectDto> {
    return this.request('POST', '/api/v1/projects', { body })
  }
  listSections(query: { project_id?: string } = {}): Promise<SectionDto[]> {
    return this.listAll('/api/v1/sections', query)
  }
  createSection(body: { name: string; project_id: string }): Promise<SectionDto> {
    return this.request('POST', '/api/v1/sections', { body })
  }
  listLabels(): Promise<LabelDto[]> {
    return this.listAll('/api/v1/labels')
  }
  createLabel(body: { name: string; color?: string }): Promise<LabelDto> {
    return this.request('POST', '/api/v1/labels', { body })
  }
  listFilters(): Promise<FilterDto[]> {
    return this.listAll('/api/v1/filters')
  }
  createFilter(body: { name: string; query: string; color?: string }): Promise<FilterDto> {
    return this.request('POST', '/api/v1/filters', { body })
  }
  /** phase 3's search: param `q` (NOT `query`), limit ≤ 50, results are {task, matched_in} wrappers */
  async searchTasks(q: string): Promise<TaskDto[]> {
    const hits = await this.listAll<SearchHitDto>('/api/v1/search', { q, limit: 50 })
    return hits.map((hit) => hit.task)
  }
}
