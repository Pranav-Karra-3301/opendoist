/**
 * Undo toast — one 10 s undo entry: label + Undo action + a draining progress bar +
 * dismiss. Rendered by <Toaster/>; the undo store (stores/undo.ts) owns the
 * run / dismiss / expiry contract, so this component is purely presentational. Task P.
 */
import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { type UndoEntry, useUndoStore } from '@/stores/undo'

/** Mirrors UNDO_WINDOW_MS in stores/undo.ts — used only to size the bar's start width. */
const UNDO_WINDOW_MS = 10_000

/** 150 ms fade/slide-in via a mount toggle (no keyframes plugin in this repo); reduced
 *  motion collapses it to an instant appearance through the `motion-reduce:` classes. */
export function useToastEnter(): boolean {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  return entered
}

export function UndoToast({ entry }: { entry: UndoEntry }) {
  const undo = useUndoStore((s) => s.undo)
  const dismiss = useUndoStore((s) => s.dismiss)
  const barRef = useRef<HTMLDivElement>(null)
  const entered = useToastEnter()

  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const remaining = entry.expiresAt - Date.now()
    const fraction = Math.max(0, Math.min(1, remaining / UNDO_WINDOW_MS))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || remaining <= 0) {
      el.style.width = `${fraction * 100}%`
      return
    }
    // Drain from the current fraction to empty over exactly the remaining window.
    el.style.transition = 'none'
    el.style.width = `${fraction * 100}%`
    void el.offsetWidth // force reflow so the next width change animates
    el.style.transition = `width ${remaining}ms linear`
    el.style.width = '0%'
  }, [entry.expiresAt])

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto relative flex min-w-[300px] max-w-[440px] items-center gap-3 overflow-hidden rounded-lg bg-surface-overlay py-2.5 pr-2 pl-3.5 text-white [box-shadow:var(--shadow-toast)]',
        'transition-[opacity,transform] duration-150 ease-standard motion-reduce:transition-none',
        entered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        'motion-reduce:translate-y-0 motion-reduce:opacity-100',
      )}
    >
      <span className="min-w-0 flex-1 truncate text-copy">{entry.label}</span>
      <button
        type="button"
        onClick={() => undo(entry.id)}
        className="shrink-0 cursor-pointer rounded-sm px-1.5 py-1 font-medium text-accent text-copy transition-colors duration-150 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
      >
        Undo
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(entry.id)}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
      >
        <X size={16} aria-hidden="true" />
      </button>
      <div
        ref={barRef}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-white/60"
        style={{ width: '100%' }}
      />
    </div>
  )
}
