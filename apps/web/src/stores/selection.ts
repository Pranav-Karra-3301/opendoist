import { create } from 'zustand'

interface SelectionState {
  /** ordered ids of currently rendered rows (all lists merged, DOM order) */
  visibleIds: string[]
  focusedId: string | null
  selectedIds: ReadonlySet<string>
  /** Replace the visible order; focus/selection of ids no longer visible is dropped. */
  setVisibleIds: (ids: string[]) => void
  focusNext: () => void
  focusPrev: () => void
  setFocused: (id: string | null) => void
  toggleSelected: (id: string) => void
  /** Select the visible range from focusedId through `id` (inclusive); focus moves to `id`. */
  rangeSelectTo: (id: string) => void
  clearSelection: () => void
}

const EMPTY: ReadonlySet<string> = new Set()

export const useSelectionStore = create<SelectionState>((set, get) => ({
  visibleIds: [],
  focusedId: null,
  selectedIds: EMPTY,
  setVisibleIds: (ids) =>
    set((s) => {
      const visible = new Set(ids)
      const selected = new Set([...s.selectedIds].filter((id) => visible.has(id)))
      return {
        visibleIds: ids,
        focusedId: s.focusedId !== null && visible.has(s.focusedId) ? s.focusedId : null,
        selectedIds: selected.size === s.selectedIds.size ? s.selectedIds : selected,
      }
    }),
  focusNext: () => {
    const { visibleIds, focusedId } = get()
    if (visibleIds.length === 0) return
    const index = focusedId === null ? -1 : visibleIds.indexOf(focusedId)
    const next = visibleIds[Math.min(index + 1, visibleIds.length - 1)]
    if (next !== undefined) set({ focusedId: next })
  },
  focusPrev: () => {
    const { visibleIds, focusedId } = get()
    if (visibleIds.length === 0) return
    const index = focusedId === null ? visibleIds.length : visibleIds.indexOf(focusedId)
    const resolved = index === -1 ? visibleIds.length : index
    const prev = visibleIds[Math.max(resolved - 1, 0)]
    if (prev !== undefined) set({ focusedId: prev })
  },
  setFocused: (id) => set({ focusedId: id }),
  toggleSelected: (id) =>
    set((s) => {
      const selected = new Set(s.selectedIds)
      if (selected.has(id)) selected.delete(id)
      else selected.add(id)
      return { selectedIds: selected }
    }),
  rangeSelectTo: (id) =>
    set((s) => {
      const from = s.focusedId === null ? -1 : s.visibleIds.indexOf(s.focusedId)
      const to = s.visibleIds.indexOf(id)
      if (to === -1) return s
      const selected = new Set(s.selectedIds)
      if (from === -1) {
        selected.add(id)
      } else {
        const [lo, hi] = from <= to ? [from, to] : [to, from]
        for (const rangeId of s.visibleIds.slice(lo, hi + 1)) selected.add(rangeId)
      }
      return { selectedIds: selected, focusedId: id }
    }),
  clearSelection: () => set({ selectedIds: EMPTY }),
}))
