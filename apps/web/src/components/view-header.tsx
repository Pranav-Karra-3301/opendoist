/**
 * Shared view header — 20px weight-700 title row at the top of the 800px content
 * column. FROZEN by Task A — later tasks import, never edit.
 */
import type { ReactNode } from 'react'

export interface ViewHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function ViewHeader({ title, subtitle, actions }: ViewHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 pt-8 pb-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="truncate font-strong text-header text-text-primary">{title}</h1>
        {subtitle !== undefined && <p className="text-caption text-text-tertiary">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
