/**
 * Server-Sent-Events → TanStack Query invalidation. Task B's replacement of the Task A stub.
 * Mutations already invalidate their own caches optimistically; this stream mainly keeps other
 * browser tabs (and out-of-band server changes) in sync.
 *
 * AS-BUILT (Task A verified against the live server, 2026-07-16):
 * - GET /api/v1/events emits NAMED SSE frames: `event: sync` with
 *   `data: {"type","entity","ids","at"}` plus `event: ping` heartbeats (~25 s).
 *   `EventSource.onmessage` never fires — we listen on the `sync` event; `ping` is ignored.
 * - The extra `at` field is stripped by SseEventSchema (unknown keys dropped).
 * - The SSE `id:` field carries the sequence number; the browser auto-sends `Last-Event-ID`
 *   on reconnect and the server replays from its ring buffer — `onerror` needs no handler.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { endpoints } from './client'
import { qk } from './keys'
import { SseEventSchema } from './schemas'

/** Coalesce bursts of same-entity events into one refetch. */
const DEBOUNCE_MS = 250

export function useSseInvalidation(): void {
  const qc = useQueryClient()

  useEffect(() => {
    const source = new EventSource(endpoints.events)
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const invalidate = (dedupeKey: string, queryKey: readonly unknown[]): void => {
      const pending = timers.get(dedupeKey)
      if (pending !== undefined) clearTimeout(pending)
      timers.set(
        dedupeKey,
        setTimeout(() => {
          timers.delete(dedupeKey)
          void qc.invalidateQueries({ queryKey })
        }, DEBOUNCE_MS),
      )
    }

    const onSync = (event: MessageEvent): void => {
      let raw: unknown
      try {
        raw = JSON.parse(event.data)
      } catch {
        return
      }
      const parsed = SseEventSchema.safeParse(raw)
      if (!parsed.success) return
      const { entity, ids } = parsed.data
      switch (entity) {
        case 'task':
          invalidate('task', qk.tasks)
          break
        case 'project':
          invalidate('project', qk.projects)
          break
        case 'section':
          invalidate('section', qk.sections)
          break
        case 'label':
          invalidate('label', qk.labels)
          break
        case 'comment': {
          const taskId = ids[0]
          if (taskId !== undefined) invalidate(`comment:${taskId}`, qk.comments(taskId))
          break
        }
        case 'settings':
          invalidate('settings', qk.userSettings)
          break
        case 'filter':
          // No phase-4 consumer; phase 5 adds the ['filters'] key.
          break
        case 'reminders':
          invalidate('reminders', qk.reminders)
          break
        case 'push_subscriptions':
          invalidate('push_subscriptions', qk.pushSubscriptions)
          break
        case 'notification_channels':
          invalidate('notification_channels', qk.channels)
          break
      }
    }

    source.addEventListener('sync', onSync as EventListener)
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      source.removeEventListener('sync', onSync as EventListener)
      source.close()
    }
  }, [qc])
}
