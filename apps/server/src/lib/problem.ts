import type { Context } from 'hono'

/** RFC 9457 problem details document (`application/problem+json`). */
export interface Problem {
  type: string
  title: string
  status: number
  detail?: string
  errors?: unknown
}

export function problem(
  c: Context,
  status: number,
  title: string,
  detail?: string,
  extra?: Record<string, unknown>,
) {
  return c.json(
    {
      type: `https://opendoist.dev/problems/${title.toLowerCase().replaceAll(' ', '-')}`,
      title,
      status,
      ...(detail ? { detail } : {}),
      ...extra,
    },
    status as never,
    { 'content-type': 'application/problem+json' },
  )
}
