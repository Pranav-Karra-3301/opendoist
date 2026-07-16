/**
 * Dialog-request store — FROZEN by Task A (plan Step 5). One dialog open at a time;
 * each dialog component reads `open` and renders nothing unless its `kind` matches.
 * Tasks D/E/F/J open dialogs exclusively through `openDialog`.
 */
import { create } from 'zustand'

export type DialogRequest =
  | { kind: 'project'; mode: 'create' | 'edit'; projectId?: string }
  | { kind: 'project-archive'; projectId: string }
  | { kind: 'project-delete'; projectId: string }
  | { kind: 'section-delete'; sectionId: string }
  | { kind: 'label'; mode: 'create' | 'edit'; labelId?: string }
  | { kind: 'filter'; mode: 'create' | 'edit'; filterId?: string }
interface DialogStore {
  open: DialogRequest | null
  openDialog: (d: DialogRequest) => void
  close: () => void
}
export const useDialogStore = create<DialogStore>((set) => ({
  open: null,
  openDialog: (d) => set({ open: d }),
  close: () => set({ open: null }),
}))
