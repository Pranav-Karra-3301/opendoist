/**
 * Settings layout primitives — FROZEN by Task A (plan Step 5).
 * ALL settings pages (Tasks M–V + About) must compose these; never redeclare them.
 */
import type { ReactNode } from 'react'

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 font-medium text-subtitle text-text-primary">{title}</h2>
      {description ? (
        <p className="mb-3 max-w-prose text-copy text-text-secondary">{description}</p>
      ) : null}
      <div className="divide-y divide-border-subtle rounded-lg border border-border bg-surface-raised">
        {children}
      </div>
    </section>
  )
}
export function SettingRow({
  label,
  description,
  control,
}: {
  label: string
  description?: string
  control: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-body text-text-primary">{label}</div>
        {description ? <div className="text-caption text-text-tertiary">{description}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}
