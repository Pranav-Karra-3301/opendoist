/**
 * Todoist live-API importer — phase 9 FROZEN signature (plan Task A Step 5), implemented by Task F.
 * Plain `fetchImpl ?? fetch` cursor-pagination loops against the unified Todoist API v1
 * (dossier §1.9) — no SDK, no db access. Produces one normalized ImportPlan; the shared
 * `applyImportPlan` (Task E) writes it. Priority is inverted to OpenDoist convention (1 = highest)
 * here so a plan is always in our convention.
 */
import type { ImportCounts, ImportPlan, ImportProgress } from './types'

const DEFAULT_BASE_URL = 'https://api.todoist.com/api/v1'
const PAGE_LIMIT = '200'
const MAX_RETRY_DELAY_MS = 60_000
const ERROR_SNIPPET_LEN = 200

/** ---- Todoist API v1 response shapes (only the fields we consume) --------------------- */

interface TodoistPage<T> {
  results?: T[]
  next_cursor?: string | null
}
interface TodoistDue {
  date?: string
  timezone?: string | null
  string?: string
  is_recurring?: boolean
}
interface TodoistDeadline {
  date?: string
}
interface TodoistDuration {
  amount?: number
  unit?: 'minute' | 'day' | string
}
interface TodoistProject {
  id: string
  name: string
  color?: string | null
  parent_id?: string | null
  inbox_project?: boolean
  shared?: boolean
  is_deleted?: boolean
}
interface TodoistSection {
  id: string
  name: string
  project_id: string
  section_order?: number
  is_deleted?: boolean
}
interface TodoistLabel {
  id: string
  name: string
  color?: string | null
  is_deleted?: boolean
}
interface TodoistTask {
  id: string
  project_id: string
  section_id?: string | null
  parent_id?: string | null
  content: string
  description?: string
  priority?: number
  due?: TodoistDue | null
  deadline?: TodoistDeadline | null
  duration?: TodoistDuration | null
  labels?: string[]
  child_order?: number
  responsible_uid?: string | null
  is_deleted?: boolean
}
interface TodoistFileAttachment {
  file_name?: string
}
interface TodoistComment {
  id: string
  content?: string
  posted_at?: string | null
  file_attachment?: TodoistFileAttachment | null
  is_deleted?: boolean
}

/** ---- Plan sub-types derived from the frozen ImportPlan schema ------------------------ */

type PlanProject = ImportPlan['projects'][number]
type PlanSection = ImportPlan['sections'][number]
type PlanLabel = ImportPlan['labels'][number]
type PlanTask = ImportPlan['tasks'][number]
type PlanComment = PlanTask['comments'][number]
type PlanSkip = ImportPlan['skips'][number]

/** ---- HTTP helpers -------------------------------------------------------------------- */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** `Retry-After` is seconds (Todoist); tolerate missing/garbage and clamp to a sane ceiling. */
function parseRetryAfter(header: string | null): number {
  const seconds = header ? Number.parseInt(header, 10) : Number.NaN
  const ms = (Number.isFinite(seconds) ? seconds : 1) * 1000
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, ms))
}

/**
 * GET `url` as JSON with Bearer auth. 401 → problem-style `invalid Todoist token`; a single 429 is
 * retried once after its `Retry-After`; any other non-2xx throws with a short body snippet.
 */
async function requestJson<T>(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  retried = false,
): Promise<T> {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (res.status === 401) {
    throw new Error('invalid Todoist token')
  }
  if (res.status === 429 && !retried) {
    await delay(parseRetryAfter(res.headers.get('retry-after')))
    return requestJson<T>(url, token, fetchImpl, true)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const snippet = body ? `: ${body.slice(0, ERROR_SNIPPET_LEN)}` : ''
    throw new Error(`Todoist API request failed (${res.status})${snippet}`)
  }
  return (await res.json()) as T
}

/** Walk every cursor page of a list endpoint, merging `results`. Always sends `limit=200`. */
async function fetchPaged<T>(
  fetchImpl: typeof fetch,
  base: string,
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  let more = true
  while (more) {
    const query: Record<string, string> = { ...params, limit: PAGE_LIMIT }
    if (cursor) query.cursor = cursor
    const url = `${base}${path}?${new URLSearchParams(query).toString()}`
    const page = await requestJson<TodoistPage<T>>(url, token, fetchImpl)
    if (Array.isArray(page.results)) out.push(...page.results)
    if (page.next_cursor) cursor = page.next_cursor
    else more = false
  }
  return out
}

/** ---- Field mapping ------------------------------------------------------------------- */

/** Todoist stores 4 = urgent; OpenDoist stores 1 = highest, so `ours = 5 − theirs`, clamped. */
function mapPriority(priority?: number): PlanTask['priority'] {
  const theirs = typeof priority === 'number' && Number.isFinite(priority) ? priority : 1
  const ours = Math.min(4, Math.max(1, Math.round(5 - theirs)))
  return ours as PlanTask['priority']
}

/** Split a Todoist `due.date` into an ISO date + optional wall-clock `HH:mm`. */
function splitDueDate(value?: string): { date: string | null; time: string | null } {
  if (!value) return { date: null, time: null }
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](([01]\d|2[0-3]):[0-5]\d))?/.exec(value)
  if (!m) return { date: null, time: null }
  return { date: m[1] ?? null, time: m[2] ?? null }
}

/** Deadlines are date-only; strip any stray time component and reject non-dates. */
function normalizeDate(value?: string): string | null {
  if (!value) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return m?.[1] ?? null
}

/** `day` units become minutes (×1440); everything clamps into the 1..1440 stored range. */
function toDurationMin(duration?: TodoistDuration | null): number | null {
  const amount = duration?.amount
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  const minutes = Math.round(duration?.unit === 'day' ? amount * 1440 : amount)
  if (minutes <= 0) return null
  return Math.min(1440, Math.max(1, minutes))
}

/** ---- Public API ---------------------------------------------------------------------- */

/** Fetches projects/sections/labels/tasks (+ per-task comments) into a normalized ImportPlan.
 *  Base URL default `https://api.todoist.com/api/v1`; header `Authorization: Bearer <token>`.
 *  Filters and reminders are out of scope and never fetched. */
export async function fetchTodoistExport(
  token: string,
  opts?: {
    baseUrl?: string
    fetchImpl?: typeof fetch
    onProgress?: (p: ImportProgress) => void
  },
): Promise<ImportPlan> {
  const base = (opts?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const fetchImpl = opts?.fetchImpl ?? fetch
  const onProgress = opts?.onProgress

  const skips: PlanSkip[] = []
  const fetched: Partial<ImportCounts> = {}
  const emit = (detail: string): void => {
    onProgress?.({ phase: 'fetching', detail, fetched: { ...fetched } })
  }

  // Projects — a shared project imports but drops its collaborators.
  const rawProjects = await fetchPaged<TodoistProject>(fetchImpl, base, token, '/projects')
  const projects: PlanProject[] = []
  for (const p of rawProjects) {
    if (p.is_deleted) continue
    if (p.shared) skips.push({ entity: 'project', ref: p.name, reason: 'collaborators dropped' })
    projects.push({
      key: p.id,
      name: p.name,
      color: p.color ?? null,
      parentKey: p.parent_id ?? null,
      isInbox: p.inbox_project === true,
    })
  }
  fetched.projects = projects.length
  emit('projects')

  // Sections.
  const rawSections = await fetchPaged<TodoistSection>(fetchImpl, base, token, '/sections')
  const sections: PlanSection[] = rawSections
    .filter((s) => !s.is_deleted)
    .map((s) => ({
      key: s.id,
      projectKey: s.project_id,
      name: s.name,
      order: s.section_order ?? 0,
    }))
  fetched.sections = sections.length
  emit('sections')

  // Labels.
  const rawLabels = await fetchPaged<TodoistLabel>(fetchImpl, base, token, '/labels')
  const labels: PlanLabel[] = rawLabels
    .filter((l) => !l.is_deleted)
    .map((l) => ({ key: l.id, name: l.name, color: l.color ?? null }))
  fetched.labels = labels.length
  emit('labels')

  // Tasks.
  const rawTasks = await fetchPaged<TodoistTask>(fetchImpl, base, token, '/tasks')
  const activeTasks = rawTasks.filter((t) => !t.is_deleted)
  fetched.tasks = activeTasks.length
  emit('tasks')

  // Per-task comments — assignees and file attachments drop with skip notes.
  const tasks: PlanTask[] = []
  let commentTotal = 0
  for (const t of activeTasks) {
    if (t.responsible_uid) {
      skips.push({ entity: 'task', ref: t.content, reason: 'assignee dropped' })
    }

    const rawComments = await fetchPaged<TodoistComment>(fetchImpl, base, token, '/comments', {
      task_id: t.id,
    })
    const comments: PlanComment[] = []
    for (const c of rawComments) {
      if (c.is_deleted) continue
      if (c.file_attachment) {
        skips.push({
          entity: 'comment',
          ref: c.file_attachment.file_name ?? t.content,
          reason: 'attachment dropped',
        })
      }
      comments.push({ content: c.content ?? '', postedAt: c.posted_at ?? null })
    }
    commentTotal += comments.length
    fetched.comments = commentTotal
    emit('comments')

    const { date: dueDate, time: dueTime } = splitDueDate(t.due?.date)
    tasks.push({
      key: t.id,
      projectKey: t.project_id,
      sectionKey: t.section_id ?? null,
      parentKey: t.parent_id ?? null,
      content: t.content,
      description: t.description ?? '',
      priority: mapPriority(t.priority),
      dueString: t.due?.string ?? null,
      dueDate,
      dueTime,
      deadline: normalizeDate(t.deadline?.date),
      durationMin: toDurationMin(t.duration),
      labels: Array.isArray(t.labels) ? t.labels : [],
      childOrder: t.child_order ?? 0,
      comments,
    })
  }

  return { source: 'todoist-api', projects, sections, labels, tasks, skips }
}
