/**
 * Phase 7 FROZEN ramble/integrations API client + polling hooks (plan Task A Step 8).
 * Wire format is camelCase end-to-end (recorded deviation; mirrors the server's
 * `apps/server/src/rambles/schemas.ts` verbatim — no mapping layer). Self-contained on
 * purpose: the shared `api/client.ts` helper requires zod-schema parsing, which this
 * frozen schema-less client does not use. Upload rides XHR (not fetch) for progress events.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type RambleStatus = 'uploaded' | 'transcribed' | 'extracted' | 'confirmed' | 'failed'
export interface ExtractedTask {
  title: string
  notes: string | null
  due: string | null
  priority: 1 | 2 | 3 | 4 | null
  labels: string[]
}
export interface Ramble {
  id: string
  status: RambleStatus
  audioMime: string
  audioBytes: number
  durationSec: number | null
  transcript: string | null
  extractedTasks: ExtractedTask[] | null
  error: string | null
  failedStage: 'transcribe' | 'extract' | null
  createdAt: string
  updatedAt: string
}
export interface IntegrationSlot {
  provider: string | null
  baseUrl: string | null
  model: string | null
  hasApiKey: boolean
  source: 'user' | 'env' | 'none'
}
export interface Integrations {
  stt: IntegrationSlot
  llm: IntegrationSlot
}
export interface IntegrationSlotPatch {
  provider: string | null
  baseUrl: string | null
  model: string | null
  apiKey?: string | null
}

const BASE = '/api/v1'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as {
      detail?: string
      title?: string
    } | null
    throw new Error(problem?.detail ?? problem?.title ?? `request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** Multipart upload with progress callback (0..100). Field name MUST be 'audio'. */
export function uploadRamble(
  blob: Blob,
  mimeType: string,
  onProgress: (pct: number) => void,
): Promise<Ramble> {
  const ext = mimeType.includes('mp4') ? 'm4a' : 'webm'
  const fd = new FormData()
  fd.append('audio', blob, `ramble.${ext}`)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/rambles`)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as Ramble)
      else {
        try {
          const p = JSON.parse(xhr.responseText) as { detail?: string }
          reject(new Error(p.detail ?? `upload failed (${xhr.status})`))
        } catch {
          reject(new Error(`upload failed (${xhr.status})`))
        }
      }
    }
    xhr.onerror = () => reject(new Error('upload failed (network)'))
    xhr.send(fd)
  })
}

export const rambleKeys = {
  all: ['rambles'] as const,
  one: (id: string) => ['rambles', id] as const,
  integrations: ['settings', 'integrations'] as const,
}

const PENDING: RambleStatus[] = ['uploaded', 'transcribed']

/** Polls every 1.5 s while the pipeline is running; stops on extracted/confirmed/failed. */
export function useRamble(id: string | null) {
  return useQuery({
    queryKey: rambleKeys.one(id ?? 'none'),
    enabled: id !== null,
    queryFn: () => json<Ramble>(`/rambles/${id}`),
    refetchInterval: (q) => (q.state.data && PENDING.includes(q.state.data.status) ? 1500 : false),
  })
}

export function useRambleList() {
  return useQuery({
    queryKey: rambleKeys.all,
    queryFn: async () => (await json<{ results: Ramble[] }>('/rambles')).results,
  })
}

export function useRetryStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: 'transcribe' | 'extract' }) =>
      json<Ramble>(`/rambles/${id}/${stage}`, { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData(rambleKeys.one(r.id), r),
  })
}

export function useConfirmRamble() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, tasks }: { id: string; tasks: ExtractedTask[] }) =>
      json<{ createdTaskIds: string[] }>(`/rambles/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ tasks }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rambleKeys.all })
      void qc.invalidateQueries({ queryKey: ['tasks'] }) // verified: matches qk.tasks (api/keys.ts)
    },
  })
}

export function useDiscardRamble() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => json<void>(`/rambles/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rambleKeys.all }),
  })
}

export function useIntegrations() {
  return useQuery({
    queryKey: rambleKeys.integrations,
    queryFn: () => json<Integrations>('/settings/integrations'),
  })
}

export function useSaveIntegrations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { stt?: IntegrationSlotPatch; llm?: IntegrationSlotPatch }) =>
      json<void>('/settings/integrations', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rambleKeys.integrations }),
  })
}

export function testIntegration(
  kind: 'stt' | 'llm',
  candidate?: IntegrationSlotPatch,
): Promise<{ ok: boolean; detail: string | null }> {
  return json(`/settings/integrations/${kind}/test`, {
    method: 'POST',
    body: JSON.stringify(candidate ? { candidate } : {}),
  })
}
