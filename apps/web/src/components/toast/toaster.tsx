/**
 * Toaster — fixed bottom-left stack of transient info/error message toasts (toasts store).
 * Mounted once by the app layout. Newest sits nearest the corner; the stack grows upward.
 *
 * Undo toasts do NOT render here: every undoable action — single-task ops (hooks/tasks.ts),
 * dialog undos, and the bulk multi-select/overdue actions — pushes through the single-slot
 * undo store (features/undo/store.ts) and renders via UndoHost, so there is ONE undo system.
 * (Phase 4's parallel `stores/undo.ts` + drain-bar toast were retired by the phase-10 review.)
 */
import { CircleAlert, Info, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { type Toast, useToastStore } from '@/stores/toasts'

const TOAST_ICON = { info: Info, error: CircleAlert } as const

/** 150 ms fade/slide-in via a mount toggle (no keyframes plugin in this repo); reduced
 *  motion collapses it to an instant appearance through the `motion-reduce:` classes. */
function useToastEnter(): boolean {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  return entered
}

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
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[var(--z-toast)] flex flex-col gap-2">
      {toasts.map((t) => (
        <MessageToast key={t.id} toast={t} />
      ))}
    </div>
  )
}
