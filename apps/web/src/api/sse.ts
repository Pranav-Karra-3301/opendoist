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
 * - The SSE `id:` field carries the sequence number; the server replays events buffered in its
 *   in-memory ring from a given id via the `Last-Event-ID` header OR the `?last_event_id=` query
 *   param (the header wins — events.ts).
 *
 * Phase 10 (Task I): reconnection is driven here, not by the browser's built-in EventSource retry,
 * with capped exponential backoff + full jitter. On error we `close()` (which halts the native
 * retry) and schedule our own reconnect; a fresh EventSource sends no `Last-Event-ID` header, so we
 * track the last seen id and replay through `?last_event_id=` instead. A successful `open` resets
 * the backoff, and returning the tab to the foreground reconnects immediately.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { endpoints } from './client'
import { qk } from './keys'
import { type SseEvent, SseEventSchema } from './schemas'

/** Coalesce bursts of same-entity events into one refetch. */
const DEBOUNCE_MS = 250

/** A single cache to invalidate for one SSE frame, plus its debounce/dedupe key. */
interface SseInvalidation {
  dedupeKey: string
  queryKey: readonly unknown[]
}

/**
 * Map an SSE `sync` frame (entity + affected ids) to the ONE query cache it should invalidate,
 * or `null` when the frame targets no cache we hold. Pure so the routing is unit-testable in the
 * node test env (the hook itself needs a DOM + EventSource we don't rig).
 *
 * INVARIANT (reminders-dup guard): a `reminders` frame invalidates `qk.reminders` and NEVER
 * `qk.tasks`. Reminders are not joined into the task list, so a reminder write must never trigger
 * a task refetch — that is the only path by which "adding a reminder" could surface a task twice.
 */
export function sseInvalidationTarget(
  entity: SseEvent['entity'],
  ids: readonly string[],
): SseInvalidation | null {
  switch (entity) {
    case 'task':
      return { dedupeKey: 'task', queryKey: qk.tasks }
    case 'project':
      return { dedupeKey: 'project', queryKey: qk.projects }
    case 'section':
      return { dedupeKey: 'section', queryKey: qk.sections }
    case 'label':
      return { dedupeKey: 'label', queryKey: qk.labels }
    case 'comment': {
      const taskId = ids[0]
      return taskId === undefined
        ? null
        : { dedupeKey: `comment:${taskId}`, queryKey: qk.comments(taskId) }
    }
    case 'settings':
      return { dedupeKey: 'settings', queryKey: qk.userSettings }
    case 'filter':
      // No phase-4 consumer; phase 5 adds the ['filters'] key.
      return null
    case 'reminders':
      return { dedupeKey: 'reminders', queryKey: qk.reminders }
    case 'push_subscriptions':
      return { dedupeKey: 'push_subscriptions', queryKey: qk.pushSubscriptions }
    case 'notification_channels':
      return { dedupeKey: 'notification_channels', queryKey: qk.channels }
  }
}

/** Reconnect backoff: full-jitter exponential, `delay = random(0, min(CAP, BASE * FACTOR ** attempt))`. */
const BACKOFF_BASE_MS = 1_000
const BACKOFF_FACTOR = 2
const BACKOFF_CAP_MS = 30_000

export function useSseInvalidation(): void {
  const qc = useQueryClient()

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let lastEventId: string | null = null
    let disposed = false

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

    // Function declarations (hoisted) for the mutually-recursive reconnect cycle:
    // connect → onError → teardownSource + scheduleReconnect → connect.
    function onSync(event: MessageEvent): void {
      // The dispatched frame carries the SSE `id:` in `lastEventId`; remember it so a
      // client-driven reconnect can ask the server to replay from here.
      if (event.lastEventId !== '') lastEventId = event.lastEventId
      let raw: unknown
      try {
        raw = JSON.parse(event.data)
      } catch {
        return
      }
      const parsed = SseEventSchema.safeParse(raw)
      if (!parsed.success) return
      const { entity, ids } = parsed.data
      const target = sseInvalidationTarget(entity, ids)
      if (target !== null) invalidate(target.dedupeKey, target.queryKey)
    }

    function onOpen(): void {
      attempt = 0
    }

    function onError(): void {
      // Take over from the browser's built-in retry: close() so it stops, then back off ourselves.
      teardownSource()
      scheduleReconnect()
    }

    function teardownSource(): void {
      if (source === null) return
      source.removeEventListener('open', onOpen)
      source.removeEventListener('sync', onSync as EventListener)
      source.removeEventListener('error', onError)
      source.close()
      source = null
    }

    function connect(): void {
      if (disposed) return
      const url =
        lastEventId === null
          ? endpoints.events
          : `${endpoints.events}?last_event_id=${encodeURIComponent(lastEventId)}`
      source = new EventSource(url)
      source.addEventListener('open', onOpen)
      source.addEventListener('sync', onSync as EventListener)
      source.addEventListener('error', onError)
    }

    function scheduleReconnect(): void {
      if (disposed || reconnectTimer !== null) return
      const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * BACKOFF_FACTOR ** attempt)
      const delay = Math.random() * ceiling
      attempt += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') return
      // Foreground again — reconnect now rather than waiting out the backoff timer.
      if (source !== null && source.readyState !== EventSource.CLOSED) return
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      attempt = 0
      connect()
    }

    connect()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      for (const timer of timers.values()) clearTimeout(timer)
      teardownSource()
    }
  }, [qc])
}
