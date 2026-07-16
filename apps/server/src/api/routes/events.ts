import { OpenAPIHono, z } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import type { AppEnv } from '../../app'
import type { ServerEvent } from '../../events/bus'
import { problem } from '../../lib/problem'

/** Live-loop cadence: drain the queue every TICK_MS, heartbeat every HEARTBEAT_TICKS ticks. */
const TICK_MS = 250
const HEARTBEAT_TICKS = 100 // 100 * 250ms = 25s

/** Wire payload for a `sync` frame — the numeric id travels in the SSE `id:` field. */
function eventData(e: ServerEvent): string {
  return JSON.stringify({ type: e.type, entity: e.entity, ids: e.ids, at: e.at })
}

export const eventsRoutes = () => {
  const app = new OpenAPIHono<AppEnv>()

  // Documented separately from the handler: streaming responses can't ride `app.openapi`'s
  // typed-return contract, so we register the OpenAPI path and serve it with a plain GET.
  app.openAPIRegistry.registerPath({
    method: 'get',
    path: '/events',
    tags: ['events'],
    summary: 'Server-sent event stream',
    description:
      'Long-lived `text/event-stream` carrying only the authenticated user’s mutations. Emits ' +
      '`sync` frames (one per mutation, JSON body `{type,entity,ids,at}` with the sequence number ' +
      'in the SSE `id:` field) and periodic `ping` heartbeats. Reconnect with the `Last-Event-ID` ' +
      'header (or `?last_event_id=`; the header wins) to replay events buffered in the in-memory ' +
      'ring since that id.',
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    request: {
      query: z.object({
        last_event_id: z.string().optional().openapi({
          description: 'Replay events with a greater id (the Last-Event-ID header wins).',
        }),
      }),
    },
    responses: {
      200: {
        description: 'An open event stream of `sync` and `ping` frames.',
        content: {
          'text/event-stream': {
            schema: z.string().openapi({
              example:
                'event: sync\nid: 12\ndata: {"type":"task.completed","entity":"task","ids":["abc"],"at":"2026-07-15T09:00:00.000Z"}\n\n',
            }),
          },
        },
      },
      401: { description: 'Missing or invalid credentials.' },
    },
  })

  app.get('/events', (c) => {
    const auth = c.get('auth')
    if (!auth) return problem(c, 401, 'unauthorized')
    const { bus, logger } = c.get('deps')
    const userId = auth.userId
    const headerId = c.req.header('last-event-id')
    const queryId = c.req.query('last_event_id')
    const rawId = headerId ?? queryId
    const lastId = rawId === undefined ? Number.NaN : Number.parseInt(rawId, 10)

    return streamSSE(c, async (stream) => {
      const queue: ServerEvent[] = []
      // The bus is a global fan-out shared by every tenant: deliver (and replay) ONLY the
      // authenticated user's events, or entity ids/timing would leak across accounts.
      const unsubscribe = bus.subscribe((e) => {
        if (e.userId === userId) queue.push(e)
      })
      // Snapshot the replay set synchronously (before any await) so it can never overlap the
      // live queue: nothing else runs between subscribe and since, so the two sets are disjoint.
      const replay = Number.isFinite(lastId)
        ? bus.since(lastId).filter((e) => e.userId === userId)
        : []
      stream.onAbort(() => {
        unsubscribe()
      })
      try {
        for (const e of replay) {
          if (stream.aborted) break
          await stream.writeSSE({ event: 'sync', id: String(e.id), data: eventData(e) })
        }
        let ticks = 0
        while (!stream.aborted) {
          try {
            for (let e = queue.shift(); e !== undefined; e = queue.shift()) {
              await stream.writeSSE({ event: 'sync', id: String(e.id), data: eventData(e) })
            }
            ticks += 1
            if (ticks >= HEARTBEAT_TICKS) {
              ticks = 0
              await stream.writeSSE({ event: 'ping', data: '' })
            }
            await stream.sleep(TICK_MS)
          } catch (err) {
            // Mid-stream errors bypass Hono's onError (dossier 3.1), so handle them here.
            logger.error({ err }, 'sse stream write failed')
            break
          }
        }
      } finally {
        unsubscribe()
      }
    })
  })

  return app
}
