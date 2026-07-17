import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  /** optional single call-to-action */
  action?: { label: string; onClick: () => void }
  children?: ReactNode
}

/**
 * Centered empty-state block (max-width 320px): 48px icon in --od-text-tertiary,
 * title 16px/600, description 13px secondary, and an optional secondary CTA button
 * (32px tall, 5px radius). `role="status"` announces the block politely when it appears.
 */
export function EmptyState({ icon: Icon, title, description, action, children }: EmptyStateProps) {
  return (
    <div
      role="status"
      className="mx-auto flex max-w-[320px] flex-col items-center justify-center px-6 py-12 text-center"
    >
      <Icon aria-hidden size={48} strokeWidth={1.5} className="text-text-tertiary" />
      <p className="mt-4 font-medium text-subtitle text-text-primary">{title}</p>
      {description ? <p className="mt-1 text-copy text-text-secondary">{description}</p> : null}
      {children}
      {action ? (
        <Button variant="secondary" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
