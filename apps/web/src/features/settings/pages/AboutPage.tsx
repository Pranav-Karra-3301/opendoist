/**
 * About — the one REAL settings page Task A ships (plan Step 5). Phase 9 Task N owns
 * it: app version from GET /api/v1/info, the update status (`info.update`, added by the
 * phase-9 update check), and a "View changelog" button opening the What's New dialog
 * (mounted globally by the account menu's WhatsNewProvider).
 */
import { ExternalLink } from 'lucide-react'
import { z } from 'zod'
import { useInfo } from '@/api/hooks/info'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWhatsNew } from '@/whats-new/WhatsNewDialog'
import { SettingRow, SettingsSection } from '../ui'

/** `info.update` shape (server: `{ available, latestVersion, url } | null`). `InfoSchema`
 *  is `.passthrough()`, so `info.update` is untyped — parse it here. */
const UpdateInfoSchema = z
  .object({ available: z.boolean(), latestVersion: z.string(), url: z.string() })
  .nullable()
type UpdateInfo = z.infer<typeof UpdateInfoSchema>

function UpdateStatus({ update }: { update: UpdateInfo }) {
  if (update === null) {
    return <span className="text-copy text-text-tertiary">Not checked</span>
  }
  if (!update.available) {
    return <span className="text-copy text-text-secondary">Up to date</span>
  }
  return (
    <a
      href={update.url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'px-0')}
    >
      v{update.latestVersion} available
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  )
}

export default function AboutPage() {
  const { data: info } = useInfo()
  const show = useWhatsNew((s) => s.show)
  const parsedUpdate = UpdateInfoSchema.safeParse(info?.update)
  const update: UpdateInfo = parsedUpdate.success ? parsedUpdate.data : null

  return (
    <div className="max-w-2xl">
      <SettingsSection title="About" description="OpenTask — self-hosted tasks, done properly.">
        <SettingRow
          label="Version"
          control={
            <span className="font-mono text-copy text-text-secondary">
              {info ? `v${info.version}` : '…'}
            </span>
          }
        />
        <SettingRow
          label="Updates"
          description="Checked daily against GitHub releases."
          control={
            info ? (
              <UpdateStatus update={update} />
            ) : (
              <span className="text-copy text-text-tertiary">…</span>
            )
          }
        />
        <SettingRow
          label="What's New"
          description="Release notes for this and earlier versions."
          control={
            <Button variant="outline" size="sm" onClick={() => show()}>
              View changelog
            </Button>
          }
        />
      </SettingsSection>
    </div>
  )
}
