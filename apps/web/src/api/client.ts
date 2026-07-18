/**
 * FROZEN typed fetch layer (Task A). Problem-JSON errors surface as ApiError; every
 * response parses through zod. Request bodies pass through `serializeBody`, which maps
 * a client-side `due` (core `Due`) onto the as-built server's DueInput wire shape —
 * mutation call sites can hand over full `Due` objects untouched.
 */
import type { z } from 'zod'
import { getDesktopSession } from './desktop-session'
import { type DueInput, paginated, toDueInput } from './schemas'
import { type ApiSession, isTauri, resolveTransport, WEB_SESSION } from './transport'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: { title?: string; detail?: string } & Record<string, unknown>,
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`)
    this.name = 'ApiError'
  }
}

const BASE = '/api/v1'

/** AS-BUILT (Task A Step 2): POST/PATCH /tasks reject full `Due` objects (`time: null`
 *  fails validation). Rewrite a `due` key through `toDueInput` before sending. */
function serializeBody(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
  if (!('due' in body)) return body
  const { due, ...rest } = body as { due?: DueInput | Parameters<typeof toDueInput>[0] } & Record<
    string,
    unknown
  >
  const wire = toDueInput(due as Parameters<typeof toDueInput>[0])
  return wire === undefined ? rest : { ...rest, due: wire }
}

/** Desktop (Tauri) uses the paired instance's session; web — and a not-yet-paired desktop,
 *  which renders only the pairing screen — keeps the same-origin cookie session. */
async function resolveSession(): Promise<ApiSession> {
  if (!isTauri()) return WEB_SESSION
  return (await getDesktopSession()) ?? WEB_SESSION
}

async function request(path: string, opts: { method?: string; body?: unknown }): Promise<Response> {
  const body = serializeBody(opts.body)
  const session = await resolveSession()
  const transport = await resolveTransport()
  const res = await transport(session.baseUrl + BASE + path, {
    method: opts.method ?? 'GET',
    credentials: session.credentials,
    headers: {
      ...session.authHeaders(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const problem = await res.json().catch(() => ({ title: res.statusText }))
    throw new ApiError(res.status, problem as ConstructorParameters<typeof ApiError>[1])
  }
  return res
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; schema: z.ZodType<T> },
): Promise<T> {
  const res = await request(path, opts)
  return opts.schema.parse(await res.json())
}

export async function apiVoid(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<void> {
  await request(path, opts)
}

/** Follows next_cursor (limit=200) until exhausted, concatenating results. */
export async function apiAllPages<T>(path: string, item: z.ZodType<T>): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?'
  const page = paginated(item)
  const out: T[] = []
  let cursor: string | null = null
  do {
    const url: string = `${path}${sep}limit=200${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`
    const res: z.infer<typeof page> = await api(url, { schema: page })
    out.push(...res.results)
    cursor = res.next_cursor
  } while (cursor !== null)
  return out
}

/** Single source of truth for every server path this phase touches — reconciled against
 *  the as-built openapi.json (Task A Step 2): update verb is PATCH everywhere, close/move/
 *  reopen are POST subroutes, /search exists, and /tasks/reorder batch-updates child_order. */
export const endpoints = {
  tasks: '/tasks',
  task: (id: string) => `/tasks/${id}`,
  quick: '/tasks/quick',
  close: (id: string) => `/tasks/${id}/close`,
  reopen: (id: string) => `/tasks/${id}/reopen`,
  move: (id: string) => `/tasks/${id}/move`,
  /** AS-BUILT addition: POST body `{ items: [{ id, child_order }] }` (≥1 item). */
  reorder: '/tasks/reorder',
  projects: '/projects',
  project: (id: string) => `/projects/${id}`,
  sections: '/sections',
  section: (id: string) => `/sections/${id}`,
  labels: '/labels',
  label: (id: string) => `/labels/${id}`,
  comments: (taskId: string) => `/comments?task_id=${taskId}`,
  /** AS-BUILT addition: POST target for creating comments (body carries task_id). */
  commentsRoot: '/comments',
  comment: (id: string) => `/comments/${id}`,
  user: '/user',
  userSettings: '/user/settings',
  info: '/info',
  /** absolute — consumed by `new EventSource(endpoints.events)`, never by api() */
  events: '/api/v1/events',
  search: (q: string) => `/search?q=${encodeURIComponent(q)}`,
} as const
