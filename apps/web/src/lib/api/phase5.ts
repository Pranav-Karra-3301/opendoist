/**
 * FROZEN phase-5 typed API client (plan Task A Step 4) — Tasks B–W import from here.
 * AS-BUILT: phase 4 exports a typed fetch layer at `@/api/client` (ApiError problem-JSON,
 * `credentials: 'include'`, zod parsing), so the transport below delegates to it while
 * keeping the frozen internal signature; `z.void()` routes (phase-3 reorder → 204
 * No Content) go through `apiVoid`. Every EXPORTED signature is frozen — do not edit.
 */
import {
  ActivityPageSchema,
  ApiTokenSchema,
  CompletedPageSchema,
  CreatedApiTokenSchema,
  type FilterTaskView,
  SearchPageSchema,
  type UserSettingsPatch,
  UserSettingsSchema,
} from '@opendoist/core'
import { z } from 'zod'
import { apiVoid, api as clientApi } from '@/api/client'

/** AS-BUILT CHECK (done): phase 4's authed fetch helper is `api`/`apiVoid` in
 *  `@/api/client` — this delegates to it; the signature stays frozen. */
async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET'
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
  if (schema instanceof z.ZodVoid) {
    // phase-3 reorder/delete routes return 204 No Content
    await apiVoid(path, { method, body })
    return undefined as T
  }
  return clientApi(path, { method, body, schema })
}
const qs = (p: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(p).filter(([, v]) => v !== undefined && v !== '') as [string, string][],
  ).toString()

export const getUserSettings = () => api('/user/settings', UserSettingsSchema)
export const patchUserSettings = (patch: UserSettingsPatch) =>
  api('/user/settings', UserSettingsSchema, { method: 'PATCH', body: JSON.stringify(patch) })

export const listActivities = (p: {
  cursor?: string
  types?: string
  project_id?: string
  since?: string
  until?: string
  limit?: number
}) => api(`/activities?${qs(p)}`, ActivityPageSchema)
export const listCompleted = (p: {
  cursor?: string
  project_id?: string
  since?: string
  until?: string
  limit?: number
}) => api(`/tasks/completed?${qs(p)}`, CompletedPageSchema)
export const searchServer = (q: string, limit = 20) =>
  api(`/search?${qs({ q, limit })}`, SearchPageSchema)

export const listTokens = () => api('/tokens', z.array(ApiTokenSchema))
export const createToken = (b: { name: string; scope: 'read' | 'read_write' }) =>
  api('/tokens', CreatedApiTokenSchema, { method: 'POST', body: JSON.stringify(b) })
export const revokeToken = (id: string) =>
  api(`/tokens/${id}`, z.object({ ok: z.boolean() }), { method: 'DELETE' })

/** Phase 3's reorder contract: POST body {items: [{id, item_order}]} → 204 (mirrors tasks/projects
 *  {items: [{id, child_order}]}). Do NOT invent an {orderedIds} body — the routes already exist. */
export const reorderFilters = (orderedIds: string[]) =>
  api('/filters/reorder', z.void(), {
    method: 'POST',
    body: JSON.stringify({ items: orderedIds.map((id, i) => ({ id, item_order: i + 1 })) }),
  })
export const reorderLabels = (orderedIds: string[]) =>
  api('/labels/reorder', z.void(), {
    method: 'POST',
    body: JSON.stringify({ items: orderedIds.map((id, i) => ({ id, item_order: i + 1 })) }),
  })
export const restoreEntity = (kind: 'tasks' | 'projects' | 'sections', id: string) =>
  api(`/${kind}/${id}/restore`, z.object({ ok: z.boolean() }), { method: 'POST' })

/** Map a phase-3 task DTO to core FilterTaskView.
 *  AS-BUILT (reconciled): GET /api/v1/tasks serves snake_case TaskDto rows
 *  (project_id/section_id/parent_id/deadline_date/created_at, due {date,time,string,
 *  is_recurring,recurrence}) — the fallback chains below cover them; the OUTPUT shape
 *  is frozen by core types. */
export function toFilterTaskView(
  t: Record<string, unknown>,
  projects: ReadonlyMap<string, { name: string; parentId: string | null }>,
  sectionNames: ReadonlyMap<string, string>,
): FilterTaskView {
  const s = (v: unknown) => (typeof v === 'string' ? v : null)
  const due = (t.due ?? null) as {
    date?: string
    time?: string | null
    recurrence?: unknown
  } | null
  return {
    id: String(t.id),
    content: String(t.content ?? ''),
    description: String(t.description ?? ''),
    dueDate: due?.date ?? null,
    dueTime: due?.time ?? null,
    isRecurring: Boolean(due?.recurrence),
    deadline: s(t.deadlineDate ?? t.deadline_date),
    priority: (t.priority ?? 4) as FilterTaskView['priority'],
    labels: (t.labels ?? []) as string[],
    projectId: String(t.projectId ?? t.project_id ?? ''),
    projectName: projects.get(String(t.projectId ?? t.project_id ?? ''))?.name ?? '',
    sectionName: sectionNames.get(String(t.sectionId ?? t.section_id ?? '')) ?? null,
    parentId: s(t.parentId ?? t.parent_id),
    createdAt: String(t.createdAt ?? t.created_at ?? ''),
    uncompletable: Boolean(t.uncompletable),
  }
}
