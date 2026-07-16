import { create } from 'zustand'
import { toast } from './toasts'

export interface UndoEntry {
  id: string
  label: string
  /** epoch ms when the entry disappears (10 s after push) */
  expiresAt: number
  run: () => Promise<void>
}

interface UndoState {
  entries: UndoEntry[]
  push: (label: string, run: () => Promise<void>) => void
  dismiss: (id: string) => void
  undo: (id: string) => void
}

const UNDO_WINDOW_MS = 10_000

export const useUndoStore = create<UndoState>((set, get) => ({
  entries: [],
  push: (label, run) => {
    const id = crypto.randomUUID()
    const entry: UndoEntry = { id, label, expiresAt: Date.now() + UNDO_WINDOW_MS, run }
    set((s) => ({ entries: [...s.entries, entry].slice(-3) }))
    setTimeout(() => get().dismiss(id), UNDO_WINDOW_MS)
  },
  dismiss: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  undo: (id) => {
    const entry = get().entries.find((e) => e.id === id)
    if (!entry) return
    get().dismiss(id)
    entry.run().catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Undo failed')
    })
  },
}))
