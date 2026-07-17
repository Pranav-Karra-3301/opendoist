/**
 * Notifications settings (phase 6 Task L) — real delivery wiring. Two sections:
 *
 *   1. Push notifications — this device's Web Push state (via `@/push`: supported / iOS-needs-install
 *      / subscribed) with enable/disable, plus the list of every registered push device with revoke.
 *   2. Notification channels — CRUD over ntfy / Gotify / webhook channels: per-channel enable Switch,
 *      failure badge, auto-disable banner, per-channel Test, delete, and an Add-channel dialog whose
 *      per-type forms validate against the config schemas re-declared in `../notifications-api`.
 *
 * Data flows through the TanStack hooks in `../notifications-api`; SSE (Task A) also invalidates the
 * ['push-subscriptions'] and ['channels'] keys, so lists stay live across devices.
 */
import { useQueryClient } from '@tanstack/react-query'
import {
  BellRing,
  type LucideIcon,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Server,
  Smartphone,
  Trash2,
  TriangleAlert,
  Webhook,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { qk } from '@/api/keys'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  getPushState,
  maybeShowReminderPermissionPrompt,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/push'
import type { PushState } from '@/push/types'
import { toast } from '@/stores/toasts'
import {
  type ChannelDto,
  type ChannelType,
  type CreateChannelBody,
  gotifyConfigSchema,
  ntfyConfigSchema,
  type PushSubscriptionDto,
  type SendOutcome,
  useChannels,
  useCreateChannel,
  useDeleteChannel,
  useDeletePushSubscription,
  usePushSubscriptions,
  useTestChannel,
  useUpdateChannel,
  webhookConfigSchema,
} from '../notifications-api'
import { SettingsSection } from '../ui'

const CHANNEL_ICON: Record<ChannelType, LucideIcon> = {
  ntfy: Radio,
  gotify: Server,
  webhook: Webhook,
}
const CHANNEL_LABEL: Record<ChannelType, string> = {
  ntfy: 'ntfy',
  gotify: 'Gotify',
  webhook: 'Webhook',
}
const CHANNEL_TYPE_OPTIONS: readonly { type: ChannelType; label: string; Icon: LucideIcon }[] = [
  { type: 'ntfy', label: 'ntfy', Icon: Radio },
  { type: 'gotify', label: 'Gotify', Icon: Server },
  { type: 'webhook', label: 'Webhook', Icon: Webhook },
]

export default function NotificationsPage() {
  return (
    <div className="max-w-2xl">
      <PushSection />
      <ChannelsSection />
    </div>
  )
}

/* ============================ Push ============================ */

function usePushState() {
  const [state, setState] = useState<PushState | null>(null)
  const refresh = useCallback(() => {
    void getPushState().then(setState)
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])
  return { state, refresh }
}

function PushSection() {
  const qc = useQueryClient()
  const { state, refresh } = usePushState()
  const subs = usePushSubscriptions()
  const del = useDeletePushSubscription()
  const [busy, setBusy] = useState(false)

  const afterChange = () => {
    refresh()
    void qc.invalidateQueries({ queryKey: qk.pushSubscriptions })
  }

  const enable = async () => {
    setBusy(true)
    try {
      await subscribeToPush()
      toast.info('Push notifications enabled on this device.')
      afterChange()
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? (err.problem.detail ?? err.problem.title ?? err.message)
          : 'Could not enable push notifications on this device.',
      )
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      await unsubscribeFromPush()
      toast.info('Push notifications disabled on this device.')
      afterChange()
    } catch {
      toast.error('Could not disable push notifications on this device.')
    } finally {
      setBusy(false)
    }
  }

  const devices = subs.data ?? []

  return (
    <SettingsSection
      title="Push notifications"
      description="Web Push delivers reminders to this browser or an installed app — the default on desktop and Android."
    >
      <div className="px-4 py-3">
        <PushStatus state={state} busy={busy} onEnable={enable} onDisable={disable} />
      </div>
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-caption text-text-tertiary">
          <Smartphone size={14} aria-hidden={true} />
          Registered devices
        </div>
        {subs.isLoading ? (
          <p className="text-caption text-text-tertiary">Loading devices…</p>
        ) : devices.length === 0 ? (
          <p className="text-caption text-text-tertiary">
            No devices registered yet. Enable push above to add this one.
          </p>
        ) : (
          <DevicesTable
            devices={devices}
            revokingId={del.isPending ? (del.variables ?? null) : null}
            onRevoke={(id) =>
              del.mutate(id, {
                onSuccess: () => toast.info('Device removed.'),
                onError: () => toast.error('Could not remove that device.'),
              })
            }
          />
        )}
      </div>
    </SettingsSection>
  )
}

function PushStatus({
  state,
  busy,
  onEnable,
  onDisable,
}: {
  state: PushState | null
  busy: boolean
  onEnable: () => void
  onDisable: () => void
}) {
  if (state === null) {
    return <p className="text-copy text-text-tertiary">Checking this device…</p>
  }

  if (!state.supported) {
    if (state.ios && !state.standalone) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-copy text-text-secondary">
            iOS delivers Web Push only to an installed app. Add OpenDoist to your Home Screen, then
            open it from there to turn on notifications.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => maybeShowReminderPermissionPrompt()}>
              <Smartphone size={16} aria-hidden={true} />
              How to install
            </Button>
            <span className="text-caption text-text-tertiary">
              Or add an ntfy channel below as a fallback.
            </span>
          </div>
        </div>
      )
    }
    return (
      <p className="text-copy text-text-secondary">
        This browser doesn't support Web Push. Add an ntfy, Gotify, or webhook channel below to
        receive reminders instead.
      </p>
    )
  }

  if (state.subscribed) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-copy text-success">
          <BellRing size={16} aria-hidden={true} />
          Notifications are on for this device.
        </span>
        <Button variant="outline" onClick={onDisable} disabled={busy}>
          {busy ? 'Working…' : 'Disable on this device'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-copy text-text-secondary">Turn on reminders for this browser.</p>
      <Button onClick={onEnable} disabled={busy}>
        <BellRing size={16} aria-hidden={true} />
        {busy ? 'Enabling…' : 'Enable on this device'}
      </Button>
    </div>
  )
}

function DevicesTable({
  devices,
  revokingId,
  onRevoke,
}: {
  devices: PushSubscriptionDto[]
  revokingId: string | null
  onRevoke: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-left">
        <thead>
          <tr className="text-caption text-text-tertiary">
            <th scope="col" className="py-2 pr-4 font-medium">
              Device
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Added
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Last used
            </th>
            <th scope="col" className="py-2 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle border-border-subtle border-t">
          {devices.map((d) => (
            <tr key={d.id}>
              <td
                className="max-w-[220px] truncate py-3 pr-4 text-body text-text-primary"
                title={d.user_agent ?? undefined}
              >
                {d.user_agent ?? 'Unknown device'}
              </td>
              <td className="whitespace-nowrap py-3 pr-4 text-caption text-text-tertiary">
                {formatDateTime(d.created_at)}
              </td>
              <td className="whitespace-nowrap py-3 pr-4 text-caption text-text-tertiary">
                {formatDateTime(d.last_used_at)}
              </td>
              <td className="py-3 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10 hover:text-danger"
                  disabled={revokingId === d.id}
                  onClick={() => onRevoke(d.id)}
                >
                  Revoke
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ============================ Channels ============================ */

function ChannelsSection() {
  const channels = useChannels()
  const update = useUpdateChannel()
  const test = useTestChannel()
  const remove = useDeleteChannel()
  const [addOpen, setAddOpen] = useState(false)
  const [deleting, setDeleting] = useState<ChannelDto | null>(null)

  const list = channels.data ?? []
  const togglingId = update.isPending ? (update.variables?.id ?? null) : null
  const testingId = test.isPending ? (test.variables ?? null) : null

  const runTest = (c: ChannelDto) => {
    test.mutate(c.id, {
      onSuccess: ({ outcome }) => {
        const { kind, message } = channelTestFeedback(c.name, outcome)
        toast[kind](message)
      },
      onError: () => toast.error(`Could not reach “${c.name}”.`),
    })
  }

  const toggle = (c: ChannelDto, enabled: boolean) => {
    update.mutate(
      { id: c.id, body: { enabled } },
      { onError: () => toast.error(`Could not update “${c.name}”.`) },
    )
  }

  return (
    <>
      <SettingsSection
        title="Notification channels"
        description="Reminders fan out to every enabled channel — in addition to Web Push above."
      >
        {channels.isLoading ? (
          <div className="px-4 py-6 text-copy text-text-tertiary">Loading channels…</div>
        ) : list.length === 0 ? (
          <EmptyChannels />
        ) : (
          list.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              toggling={togglingId === c.id}
              testing={testingId === c.id}
              onToggle={(v) => toggle(c, v)}
              onTest={() => runTest(c)}
              onDelete={() => setDeleting(c)}
            />
          ))
        )}
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-caption text-text-tertiary">
            ntfy, Gotify, or a signed webhook. Configuration stays on this instance.
          </span>
          <Button className="shrink-0" onClick={() => setAddOpen(true)}>
            <Plus size={16} aria-hidden={true} />
            Add channel
          </Button>
        </div>
      </SettingsSection>

      <AddChannelDialog open={addOpen} onOpenChange={setAddOpen} />
      <DeleteChannelDialog
        channel={deleting}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={(id) =>
          remove.mutate(id, {
            onSuccess: () => {
              toast.info('Channel deleted.')
              setDeleting(null)
            },
            onError: () => toast.error('Could not delete the channel.'),
          })
        }
      />
    </>
  )
}

function ChannelRow({
  channel,
  toggling,
  testing,
  onToggle,
  onTest,
  onDelete,
}: {
  channel: ChannelDto
  toggling: boolean
  testing: boolean
  onToggle: (value: boolean) => void
  onTest: () => void
  onDelete: () => void
}) {
  const Icon = CHANNEL_ICON[channel.type]
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-sm bg-surface',
              channel.enabled ? 'text-accent' : 'text-text-tertiary',
            )}
          >
            <Icon size={18} aria-hidden={true} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-body text-text-primary">{channel.name}</div>
            <div className="flex flex-wrap items-center gap-2 text-caption text-text-tertiary">
              <span>{CHANNEL_LABEL[channel.type]}</span>
              {channel.consecutive_failures > 0 && channel.disabled_reason === null ? (
                <FailureBadge count={channel.consecutive_failures} />
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            aria-label={`Enable ${channel.name}`}
            checked={channel.enabled}
            disabled={toggling}
            onCheckedChange={onToggle}
          />
          <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
            <Send size={14} aria-hidden={true} />
            {testing ? 'Testing…' : 'Test'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete ${channel.name}`}
            className="text-danger hover:bg-danger/10 hover:text-danger"
            onClick={onDelete}
          >
            <Trash2 size={14} aria-hidden={true} />
          </Button>
        </div>
      </div>
      {channel.disabled_reason !== null ? (
        <div className="flex items-start gap-2 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger">
          <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden={true} />
          <span>{channel.disabled_reason}</span>
        </div>
      ) : null}
    </div>
  )
}

function FailureBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-medium text-warning">
      <TriangleAlert size={11} aria-hidden={true} />
      {count} failed {count === 1 ? 'delivery' : 'deliveries'}
    </span>
  )
}

function EmptyChannels() {
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-6">
      <div className="flex items-center gap-2 text-body text-text-primary">
        <Radio size={16} className="text-text-tertiary" aria-hidden={true} />
        No channels yet
      </div>
      <p className="text-caption text-text-tertiary">
        Add ntfy, Gotify, or a webhook to receive reminders outside the browser.
      </p>
    </div>
  )
}

function DeleteChannelDialog({
  channel,
  pending,
  onCancel,
  onConfirm,
}: {
  channel: ChannelDto | null
  pending: boolean
  onCancel: () => void
  onConfirm: (id: string) => void
}) {
  return (
    <Dialog
      open={channel !== null}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      {channel && (
        <DialogContent className="w-full max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Delete channel</DialogTitle>
            <DialogDescription>
              {`“${channel.name}” stops receiving reminders immediately. This can't be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => onConfirm(channel.id)}
            >
              Delete channel
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

/* ============================ Add-channel form ============================ */

interface ChannelFormFields {
  type: ChannelType
  name: string
  ntfyServer: string
  ntfyTopic: string
  ntfyToken: string
  gotifyServer: string
  gotifyAppToken: string
  webhookUrl: string
  webhookSecret: string
}

type ChannelFormResult =
  | { ok: true; body: CreateChannelBody }
  | { ok: false; errors: Record<string, string> }

const FIELD_ERROR: Record<string, string> = {
  server: 'Enter a valid server URL.',
  topic: 'Topic is required.',
  app_token: 'App token is required.',
  url: 'Enter a valid URL.',
  secret: 'Use a secret of at least 8 characters.',
}

function issuesToErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'config')
    if (!(key in out)) out[key] = FIELD_ERROR[key] ?? issue.message
  }
  return out
}

export function validateChannelForm(f: ChannelFormFields): ChannelFormResult {
  const errors: Record<string, string> = {}
  const name = f.name.trim()
  if (name === '') errors.name = 'Give this channel a name.'
  else if (name.length > 120) errors.name = 'Keep the name to 120 characters or fewer.'

  if (f.type === 'ntfy') {
    const parsed = ntfyConfigSchema.safeParse({
      server: f.ntfyServer.trim() === '' ? undefined : f.ntfyServer.trim(),
      topic: f.ntfyTopic.trim(),
      token: f.ntfyToken.trim() === '' ? undefined : f.ntfyToken.trim(),
    })
    if (!parsed.success) Object.assign(errors, issuesToErrors(parsed.error.issues))
    if (parsed.success && Object.keys(errors).length === 0) {
      return { ok: true, body: { type: 'ntfy', name, config: parsed.data } }
    }
    return { ok: false, errors }
  }

  if (f.type === 'gotify') {
    const parsed = gotifyConfigSchema.safeParse({
      server: f.gotifyServer.trim(),
      app_token: f.gotifyAppToken.trim(),
    })
    if (!parsed.success) Object.assign(errors, issuesToErrors(parsed.error.issues))
    if (parsed.success && Object.keys(errors).length === 0) {
      return { ok: true, body: { type: 'gotify', name, config: parsed.data } }
    }
    return { ok: false, errors }
  }

  const parsed = webhookConfigSchema.safeParse({
    url: f.webhookUrl.trim(),
    secret: f.webhookSecret,
  })
  if (!parsed.success) Object.assign(errors, issuesToErrors(parsed.error.issues))
  if (parsed.success && Object.keys(errors).length === 0) {
    return { ok: true, body: { type: 'webhook', name, config: parsed.data } }
  }
  return { ok: false, errors }
}

function AddChannelDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateChannel()
  const [type, setType] = useState<ChannelType>('ntfy')
  const [name, setName] = useState('')
  const [ntfyServer, setNtfyServer] = useState('https://ntfy.sh')
  const [ntfyTopic, setNtfyTopic] = useState('')
  const [ntfyToken, setNtfyToken] = useState('')
  const [gotifyServer, setGotifyServer] = useState('')
  const [gotifyAppToken, setGotifyAppToken] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const reset = () => {
    setType('ntfy')
    setName('')
    setNtfyServer('https://ntfy.sh')
    setNtfyTopic('')
    setNtfyToken('')
    setGotifyServer('')
    setGotifyAppToken('')
    setWebhookUrl('')
    setWebhookSecret('')
    setErrors({})
    setFormError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const submit = () => {
    const result = validateChannelForm({
      type,
      name,
      ntfyServer,
      ntfyTopic,
      ntfyToken,
      gotifyServer,
      gotifyAppToken,
      webhookUrl,
      webhookSecret,
    })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setFormError(null)
    create.mutate(result.body, {
      onSuccess: () => {
        toast.info('Channel added.')
        handleOpenChange(false)
      },
      onError: (err) => {
        setFormError(
          err instanceof ApiError
            ? (err.problem.detail ?? err.problem.title ?? err.message)
            : 'Could not add the channel. Please try again.',
        )
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {open && (
        <DialogContent className="w-full max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add notification channel</DialogTitle>
            <DialogDescription>Reminders are delivered to every enabled channel.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className="grid gap-1.5">
              <span className="font-medium text-caption text-text-secondary">Type</span>
              <div className="grid grid-cols-3 gap-2">
                {CHANNEL_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    aria-pressed={type === opt.type}
                    onClick={() => {
                      setType(opt.type)
                      setErrors({})
                    }}
                    className={cn(
                      'flex cursor-pointer flex-col items-center gap-1 rounded-sm border px-3 py-2 text-caption transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]',
                      type === opt.type
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-input-border text-text-secondary hover:bg-hover',
                    )}
                  >
                    <opt.Icon size={18} aria-hidden={true} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Field id="channel-name" label="Name" error={errors.name}>
              <Input
                id="channel-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Phone"
                autoFocus
              />
            </Field>

            {type === 'ntfy' && (
              <>
                <Field id="ntfy-server" label="Server" error={errors.server}>
                  <Input
                    id="ntfy-server"
                    value={ntfyServer}
                    onChange={(event) => setNtfyServer(event.target.value)}
                    placeholder="https://ntfy.sh"
                  />
                </Field>
                <Field id="ntfy-topic" label="Topic" error={errors.topic}>
                  <Input
                    id="ntfy-topic"
                    value={ntfyTopic}
                    onChange={(event) => setNtfyTopic(event.target.value)}
                    placeholder="my-opendoist-alerts"
                  />
                </Field>
                <Field
                  id="ntfy-token"
                  label="Access token"
                  hint="Optional — only for protected topics."
                  error={errors.token}
                >
                  <Input
                    id="ntfy-token"
                    value={ntfyToken}
                    onChange={(event) => setNtfyToken(event.target.value)}
                    placeholder="tk_…"
                  />
                </Field>
              </>
            )}

            {type === 'gotify' && (
              <>
                <Field id="gotify-server" label="Server" error={errors.server}>
                  <Input
                    id="gotify-server"
                    value={gotifyServer}
                    onChange={(event) => setGotifyServer(event.target.value)}
                    placeholder="https://gotify.example.com"
                  />
                </Field>
                <Field id="gotify-token" label="App token" error={errors.app_token}>
                  <Input
                    id="gotify-token"
                    value={gotifyAppToken}
                    onChange={(event) => setGotifyAppToken(event.target.value)}
                    placeholder="A…"
                  />
                </Field>
              </>
            )}

            {type === 'webhook' && (
              <>
                <Field id="webhook-url" label="Endpoint URL" error={errors.url}>
                  <Input
                    id="webhook-url"
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                    placeholder="https://example.com/hook"
                  />
                </Field>
                <Field
                  id="webhook-secret"
                  label="Signing secret"
                  hint="At least 8 characters. Signs the X-Signature header."
                  error={errors.secret}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      id="webhook-secret"
                      value={webhookSecret}
                      onChange={(event) => setWebhookSecret(event.target.value)}
                      placeholder="a long random string"
                      className="font-mono text-caption"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setWebhookSecret(crypto.randomUUID())}
                    >
                      <RefreshCw size={14} aria-hidden={true} />
                      Generate
                    </Button>
                  </div>
                </Field>
                <WebhookNote />
              </>
            )}

            {formError !== null && (
              <p role="alert" className="text-caption text-danger">
                {formError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Adding…' : 'Add channel'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  )
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-medium text-caption text-text-secondary">
        {label}
      </label>
      {children}
      {hint && !error ? <span className="text-caption text-text-tertiary">{hint}</span> : null}
      {error ? (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  )
}

const WEBHOOK_BODY_EXAMPLE = `{
  "event": "reminder.due",
  "task": {
    "id": "6c…",
    "title": "Renew passport",
    "due": { "date": "2026-07-16", "time": "17:00" },
    "url": "https://your-instance/task/6c…"
  },
  "firedAt": "2026-07-16T20:30:00.000Z"
}`

function WebhookNote() {
  return (
    <details className="rounded-sm border border-border-subtle bg-surface px-3 py-2 text-caption text-text-secondary">
      <summary className="cursor-pointer select-none font-medium text-text-secondary">
        Payload &amp; signature
      </summary>
      <div className="mt-2 grid gap-2">
        <p>
          Each reminder is POSTed as JSON with header{' '}
          <code className="rounded-sm bg-surface-raised px-1 font-mono">
            X-Signature: sha256=&lt;hex&gt;
          </code>{' '}
          — an HMAC-SHA256 of the raw request body, keyed with your secret. Verify it before
          trusting the payload.
        </p>
        <pre className="overflow-x-auto rounded-sm bg-surface-raised p-2 font-mono text-caption text-text-secondary">
          {WEBHOOK_BODY_EXAMPLE}
        </pre>
      </div>
    </details>
  )
}

/* ============================ helpers ============================ */

function formatDateTime(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function channelTestFeedback(
  name: string,
  outcome: SendOutcome,
): { kind: 'info' | 'error'; message: string } {
  switch (outcome) {
    case 'delivered':
      return { kind: 'info', message: `Test delivered to “${name}”.` }
    case 'gone':
      return { kind: 'error', message: `“${name}” is no longer reachable (endpoint gone).` }
    default:
      return { kind: 'error', message: `Test to “${name}” failed.` }
  }
}
