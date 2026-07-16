/**
 * Toaster — fixed bottom-left stack of transient info/error toasts (toasts store) plus
 * 10 s undo entries (undo store). Mounted once by the app layout. Newest sits nearest
 * the corner; the stack grows upward. Task P.
 */
import { CircleAlert, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type Toast, useToastStore } from '@/stores/toasts'
import { useUndoStore } from '@/stores/undo'
import { UndoToast, useToastEnter } from './undo-toast'

const TOAST_ICON = { info: Info, error: CircleAlert } as const

function MessageToast({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss)
  const entered = useToastEnter()
  const Icon = TOAST_ICON[toast.kind]
  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex min-w-[280px] max-w-[420px] items-center gap-2.5 rounded-lg bg-surface-overlay py-2.5 pr-2 pl-3.5 text-white [box-shadow:var(--shadow-toast)]',
        'transition-[opacity,transform] duration-150 ease-standard motion-reduce:transition-none',
        entered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        'motion-reduce:translate-y-0 motion-reduce:opacity-100',
      )}
    >
      <Icon
        size={16}
        aria-hidden="true"
        className={cn('shrink-0', toast.kind === 'error' && 'text-danger')}
      />
      <span className="min-w-0 flex-1 text-copy">{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const entries = useUndoStore((s) => s.entries)
  if (toasts.length === 0 && entries.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[var(--z-toast)] flex flex-col gap-2">
      {toasts.map((t) => (
        <MessageToast key={t.id} toast={t} />
      ))}
      {entries.map((e) => (
        <UndoToast key={e.id} entry={e} />
      ))}
    </div>
  )
}
