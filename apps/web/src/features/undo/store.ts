/**
 * Phase-5 undo store — FROZEN by Task A (plan Step 5). Single-slot (a new push
 * replaces the current toast, matching Todoist). Task W builds UndoHost on this and
 * migrates phase 4's undo usage (apps/web/src/stores/undo.ts) onto it so there is
 * ONE system; Tasks D/F push their own undos through here.
 */
import { create } from 'zustand'

export interface UndoableAction {
  id: number
  message: string
  undo: () => Promise<void>
}
interface UndoStore {
  current: UndoableAction | null
  push: (a: { message: string; undo: () => Promise<void> }) => void
  runUndo: () => Promise<void>
  dismiss: () => void
}
let seq = 0
export const useUndoStore = create<UndoStore>((set, get) => ({
  current: null,
  push: (a) => set({ current: { ...a, id: ++seq } }),
  runUndo: async () => {
    const c = get().current
    set({ current: null })
    if (c) await c.undo()
  },
  dismiss: () => set({ current: null }),
}))
