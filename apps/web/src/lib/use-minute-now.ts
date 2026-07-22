/**
 * A shared minute clock: ONE global interval, every subscriber re-renders when the wall-clock
 * minute rolls over. Lets time-sensitive paint (the `missed` due tone) flip live without a
 * per-row timer — hundreds of task rows share the same tick.
 */
import { useSyncExternalStore } from 'react'

let currentMinute = Math.floor(Date.now() / 60_000)
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function ensureTicking(): void {
  if (timer !== null) return
  // Poll well under a minute so the flip lands close to the boundary; notify only on change.
  timer = setInterval(() => {
    const minute = Math.floor(Date.now() / 60_000)
    if (minute === currentMinute) return
    currentMinute = minute
    for (const notify of listeners) notify()
  }, 10_000)
}

function subscribe(onChange: () => void): () => void {
  ensureTicking()
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

const getSnapshot = (): number => currentMinute

/** Subscribe to the shared minute tick; returns the current epoch minute (value rarely needed —
 *  calling the hook is what keeps the component repainting as time passes). */
export function useMinuteNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
