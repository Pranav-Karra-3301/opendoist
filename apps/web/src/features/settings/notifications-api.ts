/**
 * Notifications settings data layer (phase 6 Task L) — thin TanStack Query wrappers over the
 * frozen typed fetch client (`@/api/client`) for the reminder-test, push-subscription, and
 * notification-channel endpoints, plus the client-side channel config schemas the Add-channel
 * forms validate against.
 *
 * The three channel config schemas are RE-DECLARED here on purpose: web must never import server
 * code. They mirror `apps/server/src/reminders/contracts.ts` (Ntfy/Gotify/WebhookConfigSchema and
 * the ChannelDto/TestFireResult/PushSubscriptionDto shapes) — keep the two in sync by hand.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api, apiVoid } from '@/api/client'
import { qk } from '@/api/keys'

/* ---------- channel config schemas (mirror server contracts.ts) ---------- */
export const ntfyConfigSchema = z.object({
  server: z.string().url().default('https://ntfy.sh'),
  topic: z.string().min(1).max(256),
  token: z.string().max(256).optional(),
})
export const gotifyConfigSchema = z.object({
  server: z.string().url(),
  app_token: z.string().min(1).max(256),
})
export const webhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(8).max(256),
})
export type NtfyConfig = z.infer<typeof ntfyConfigSchema>
export type GotifyConfig = z.infer<typeof gotifyConfigSchema>
export type WebhookConfig = z.infer<typeof webhookConfigSchema>

export const channelTypeSchema = z.enum(['ntfy', 'gotify', 'webhook'])
export type ChannelType = z.infer<typeof channelTypeSchema>

/* ---------- DTOs (mirror server contracts.ts) ---------- */
const channelCommon = {
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  consecutive_failures: z.number().int(),
  disabled_reason: z.string().nullable(),
  created_at: z.string(),
}
export const channelDtoSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ntfy'), config: ntfyConfigSchema, ...channelCommon }),
  z.object({ type: z.literal('gotify'), config: gotifyConfigSchema, ...channelCommon }),
  z.object({ type: z.literal('webhook'), config: webhookConfigSchema, ...channelCommon }),
])
export type ChannelDto = z.infer<typeof channelDtoSchema>

export const pushSubscriptionDtoSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
  user_agent: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
})
export type PushSubscriptionDto = z.infer<typeof pushSubscriptionDtoSchema>

const sendOutcomeSchema = z.enum(['delivered', 'gone', 'error'])
export type SendOutcome = z.infer<typeof sendOutcomeSchema>

export const testFireResultSchema = z.object({
  push: z.object({ sent: z.number().int(), gone: z.number().int(), errors: z.number().int() }),
  channels: z.array(z.object({ id: z.string(), name: z.string(), outcome: sendOutcomeSchema })),
})
export type TestFireResult = z.infer<typeof testFireResultSchema>

const channelTestResultSchema = z.object({ outcome: sendOutcomeSchema })

const channelListSchema = z.object({ results: z.array(channelDtoSchema) })
const pushSubscriptionListSchema = z.object({ results: z.array(pushSubscriptionDtoSchema) })

/* ---------- request bodies (mirror server CreateChannelBody/UpdateChannelBody) ---------- */
export type CreateChannelBody =
  | { type: 'ntfy'; name: string; config: NtfyConfig }
  | { type: 'gotify'; name: string; config: GotifyConfig }
  | { type: 'webhook'; name: string; config: WebhookConfig }

export interface UpdateChannelBody {
  name?: string
  enabled?: boolean
  config?: NtfyConfig | GotifyConfig | WebhookConfig
}

/* ---------- transport (thin wrappers over the frozen client) ---------- */
export const sendReminderTest = () =>
  api('/reminders/test', { method: 'POST', body: {}, schema: testFireResultSchema })

export const listPushSubscriptions = () =>
  api('/push-subscriptions', { schema: pushSubscriptionListSchema }).then((r) => r.results)

export const deletePushSubscription = (id: string) =>
  apiVoid(`/push-subscriptions/${id}`, { method: 'DELETE' })

export const listChannels = () =>
  api('/channels', { schema: channelListSchema }).then((r) => r.results)

export const createChannel = (body: CreateChannelBody) =>
  api('/channels', { method: 'POST', body, schema: channelDtoSchema })

export const updateChannel = (id: string, body: UpdateChannelBody) =>
  api(`/channels/${id}`, { method: 'PATCH', body, schema: channelDtoSchema })

export const deleteChannel = (id: string) => apiVoid(`/channels/${id}`, { method: 'DELETE' })

export const testChannel = (id: string) =>
  api(`/channels/${id}/test`, { method: 'POST', body: {}, schema: channelTestResultSchema })

/* ---------- TanStack Query hooks ---------- */
export function useReminderTest() {
  return useMutation({ mutationFn: sendReminderTest })
}

export function usePushSubscriptions() {
  return useQuery({
    queryKey: qk.pushSubscriptions,
    queryFn: listPushSubscriptions,
    staleTime: 30_000,
  })
}

export function useDeletePushSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deletePushSubscription,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.pushSubscriptions }),
  })
}

export function useChannels() {
  return useQuery({ queryKey: qk.channels, queryFn: listChannels, staleTime: 30_000 })
}

export function useCreateChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createChannel,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.channels }),
  })
}

export function useUpdateChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateChannelBody }) => updateChannel(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.channels }),
  })
}

export function useDeleteChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteChannel,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.channels }),
  })
}

export function useTestChannel() {
  return useMutation({ mutationFn: testChannel })
}

/* ---------- pure display helpers ---------- */
/** One-line toast summary of a reminder test-fire (`TestFireResult`) — push counts then each
 *  channel's outcome by name, e.g. `Push: 2 sent · phone: delivered · HA: error`. */
export function summarizeTestFire(result: TestFireResult): string {
  const push: string[] = [`${result.push.sent} sent`]
  if (result.push.gone > 0) push.push(`${result.push.gone} expired`)
  if (result.push.errors > 0) push.push(`${result.push.errors} failed`)
  const parts = [`Push: ${push.join(', ')}`]
  for (const c of result.channels) parts.push(`${c.name}: ${c.outcome}`)
  return parts.join(' · ')
}
