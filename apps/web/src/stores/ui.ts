import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type RowPopoverKind = 'schedule' | 'priority' | 'move' | 'labels' | 'more'

export interface RowPopover {
  taskId: string
  kind: RowPopoverKind
}

interface UiState {
  /** persisted (localStorage 'od-sidebar') */
  sidebarCollapsed: boolean
  /** persisted; clamped 210–420 */
  sidebarWidth: number
  quickAddOpen: boolean
  paletteOpen: boolean
  shortcutOverlayOpen: boolean
  activeRowPopover: RowPopover | null
  detailCommentFocus: boolean
  toggleSidebar: () => void
  setSidebarWidth: (px: number) => void
  setQuickAddOpen: (v: boolean) => void
  setPaletteOpen: (v: boolean) => void
  setShortcutOverlayOpen: (v: boolean) => void
  openRowPopover: (taskId: string, kind: RowPopoverKind) => void
  closeRowPopover: () => void
  setDetailCommentFocus: (v: boolean) => void
}

const SIDEBAR_MIN = 210
const SIDEBAR_MAX = 420

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarWidth: 280,
      quickAddOpen: false,
      paletteOpen: false,
      shortcutOverlayOpen: false,
      activeRowPopover: null,
      detailCommentFocus: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarWidth: (px) =>
        set({ sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px))) }),
      setQuickAddOpen: (v) => set({ quickAddOpen: v }),
      setPaletteOpen: (v) => set({ paletteOpen: v }),
      setShortcutOverlayOpen: (v) => set({ shortcutOverlayOpen: v }),
      openRowPopover: (taskId, kind) => set({ activeRowPopover: { taskId, kind } }),
      closeRowPopover: () => set({ activeRowPopover: null }),
      setDetailCommentFocus: (v) => set({ detailCommentFocus: v }),
    }),
    {
      name: 'od-sidebar',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, sidebarWidth: s.sidebarWidth }),
    },
  ),
)
