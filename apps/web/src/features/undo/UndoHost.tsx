/**
 * UndoHost — the single-slot undo toast (plan Task W). Renders the frozen
 * `useUndoStore.current` as one bottom-left toast: message + Undo action + dismiss, styled per
 * the visual law (surface-overlay, white text, 10px radius, `--shadow-toast`, z 400). It
 * auto-dismisses after 10s (paused while hovered); a fresh push replaces the current toast (the
 * store is single-slot, matching Todoist), and `mod+z` runs Undo while a toast is visible.
 * An Undo that rejects surfaces as a follow-up error toast via the shared toast store.
 *
 * Every task undo (complete / delete / reschedule / move — hooks/tasks.ts) and every dialog undo
 * (project archive/delete, section delete, filter/label delete — Tasks E/F) pushes through the
 * same store and renders here, so there is ONE undo system.
 */
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { useUndoStore } from './store'

/** Matches the auto-dismiss window Todoist uses for its undo toast. */
const UNDO_WINDOW_MS = 10_000

export default function UndoHost() {
  const current = useUndoStore((s) => s.current)
  const runUndo = useUndoStore((s) => s.runUndo)
  const dismiss = useUndoStore((s) => s.dismiss)

  const handleUndo = (): void => {
    // runUndo reads the live `current` from the store, so this stays correct regardless of
    // closure identity; a rejecting inverse op surfaces as an error toast (its single surface
    // unless the inverse op toasts on its own, e.g. reopen).
    runUndo().catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Undo failed')
    })
  }

  // `mod+z` runs the visible undo — registered here, not in the global keyboard map (plan Task W).
  // enableOnFormTags defaults to false, so native text-field undo keeps working while typing, and
  // `enabled` gates the binding so mod+z is free when no toast is showing.
  useHotkeys('mod+z', () => handleUndo(), { enabled: current !== null, preventDefault: true })

  if (current === null) return null
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[var(--z-toast)]">
      {/* keyed by id so a replacing push remounts the toast → fresh enter + auto-dismiss timer */}
      <UndoToast
        key={current.id}
        message={current.message}
        onUndo={handleUndo}
        onDismiss={dismiss}
      />
    </div>
  )
}

function UndoToast({
  message,
  onUndo,
  onDismiss,
}: {
  message: string
  onUndo: () => void
  onDismiss: () => void
}) {
  const [entered, setEntered] = useState(false)
  const [paused, setPaused] = useState(false)

  // 150ms fade/slide-in via a mount toggle (no keyframes plugin here); reduced motion collapses
  // it to an instant appearance through the `motion-reduce:` classes.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Auto-dismiss after the full window; hovering pauses it (clears the timer) and leaving restarts
  // a fresh window — the frozen store owns no timer, so the host is its single source.
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(onDismiss, UNDO_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [paused, onDismiss])

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        'pointer-events-auto flex min-w-[300px] max-w-[440px] items-center gap-3 rounded-lg bg-surface-overlay py-2.5 pr-2 pl-3.5 text-white [box-shadow:var(--shadow-toast)]',
        'transition-[opacity,transform] duration-150 ease-standard motion-reduce:transition-none',
        entered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        'motion-reduce:translate-y-0 motion-reduce:opacity-100',
      )}
    >
      <span className="min-w-0 flex-1 truncate text-copy">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 cursor-pointer rounded-sm px-1.5 py-1 font-medium text-accent text-copy transition-colors duration-150 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
      >
        Undo
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
