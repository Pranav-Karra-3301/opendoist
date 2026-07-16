import { z } from '@hono/zod-openapi'

export const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export function encodeCursor(v: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url')
}

export function decodeCursor(s: string): Record<string, string | number> | null {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<
      string,
      string | number
    >
  } catch {
    return null
  }
}

/** Boolean query params: NEVER z.coerce.boolean() (any non-empty string is truthy). */
export const queryBool = (dflt: boolean) =>
  z
    .enum(['true', 'false'])
    .default(dflt ? 'true' : 'false')
    .transform((v) => v === 'true')
