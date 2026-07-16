/**
 * Notifications settings (Task T) — per-channel enable toggles for the four reminder delivery
 * channels (Push, ntfy, Gotify, Webhook). Each switch persists intent NOW through the optimistic
 * `useUserSettings` PATCH (features/settings/useSettings.ts), sending the COMPLETE notifications
 * object so the top-level shallow merge never drops an untouched channel.
 *
 * This is placeholder wiring for phase 6 (reminders): delivery and per-channel configuration ship
 * then, so "Configure" is disabled and explains itself via tooltip, and the Push card surfaces the
 * browser's push-permission state (informational only — this page never requests permission).
 */
import { Bell, type LucideIcon, Radio, Server, Settings2, Webhook } from 'lucide-react'
import { useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserSettings } from '../useSettings'
import {
  type BrowserPermission,
  NOTIFICATION_CHANNELS,
  type NotificationChannelDef,
  type NotificationChannelKey,
  notificationsPatch,
  type PermissionBadge,
  permissionBadge,
  readNotificationPermission,
} from './notifications-logic'

const CHANNEL_ICONS: Record<NotificationChannelKey, LucideIcon> = {
  push: Bell,
  ntfy: Radio,
  gotify: Server,
  webhook: Webhook,
}

const TONE_CLASS: Record<BrowserPermission, string> = {
  granted: 'border-success/40 bg-success/10 text-success',
  denied: 'border-danger/40 bg-danger/10 text-danger',
  default: 'border-border bg-surface text-text-tertiary',
}

function PermissionPill({ badge }: { badge: PermissionBadge }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-caption',
        TONE_CLASS[badge.tone],
      )}
    >
      <span aria-hidden={true} className="size-1.5 rounded-full bg-current" />
      <span className="sr-only">Browser push permission: </span>
      {badge.label}
    </span>
  )
}

/**
 * The "Configure" affordance is intentionally inert until phase 6. It stays focusable and carries a
 * tooltip (rather than a hard `disabled`, which can't be hovered/focused for its explanation), so
 * both mouse and keyboard users can discover why it does nothing yet.
 */
function ConfigureButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-disabled={true}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'cursor-not-allowed opacity-60 hover:bg-surface-raised',
        )}
        onClick={(event) => event.preventDefault()}
      >
        <Settings2 size={16} aria-hidden={true} />
        Configure
      </TooltipTrigger>
      <TooltipContent>Configuration arrives with reminders (phase 6)</TooltipContent>
    </Tooltip>
  )
}

function ChannelCard({
  def,
  enabled,
  onToggle,
  permission,
}: {
  def: NotificationChannelDef
  enabled: boolean
  onToggle: (value: boolean) => void
  permission?: BrowserPermission
}) {
  const Icon = CHANNEL_ICONS[def.key]
  const badge = permission ? permissionBadge(permission) : null

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-sm bg-surface',
              enabled ? 'text-accent' : 'text-text-tertiary',
            )}
          >
            <Icon size={18} aria-hidden={true} />
          </span>
          <div className="min-w-0 truncate font-medium text-body text-text-primary">
            {def.title}
          </div>
        </div>
        <Switch
          aria-label={`Enable ${def.title} notifications`}
          checked={enabled}
          onCheckedChange={onToggle}
        />
      </div>
      <p className="text-copy text-text-secondary">{def.description}</p>
      <div className={cn('flex items-center gap-2', badge ? 'justify-between' : 'justify-end')}>
        {badge ? <PermissionPill badge={badge} /> : null}
        <ConfigureButton />
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  const { settings, update } = useUserSettings()
  const channels = settings.notifications
  // Push permission rarely changes while this page is open; read it once on mount.
  const [permission] = useState(readNotificationPermission)

  return (
    <TooltipProvider>
      <div className="max-w-2xl">
        <p className="mb-6 rounded-lg border border-border bg-surface px-4 py-3 text-copy text-text-secondary">
          Your choices are saved right away. Reminder delivery — and each channel's configuration —
          arrives with reminders in phase 6; these toggles decide where those reminders will go.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {NOTIFICATION_CHANNELS.map((def) => (
            <ChannelCard
              key={def.key}
              def={def}
              enabled={channels[def.key]}
              onToggle={(value) => update(notificationsPatch(channels, def.key, value))}
              permission={def.key === 'push' ? permission : undefined}
            />
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}
