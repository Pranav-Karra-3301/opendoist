/**
 * The undo store — FROZEN by phase-5 Task A (plan Step 5). Single-slot (a new push
 * replaces the current toast, matching Todoist). UndoHost renders it; every undoable
 * action — single-task ops (hooks/tasks.ts), dialog undos (Tasks D/F), and the bulk
 * multi-select/overdue actions — pushes through here, so there is ONE undo system.
 * (Phase 4's parallel `stores/undo.ts` was migrated onto this store and deleted in
 * the phase-10 review pass.)
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
