import { Outlet } from '@tanstack/react-router'
import { PanelLeft } from 'lucide-react'
import { type MouseEvent, useEffect } from 'react'
import { useSseInvalidation } from '@/api/sse'
import { CommandPalette } from '@/components/palette/command-palette'
import { QuickAddDialog } from '@/components/quick-add/quick-add-dialog'
import { MultiSelectToolbar } from '@/components/task/multi-select-toolbar'
import { TaskDetailDialog } from '@/components/task-detail/task-detail-dialog'
import { Toaster } from '@/components/toast/toaster'
import DialogHost from '@/features/dialogs/DialogHost'
import UndoHost from '@/features/undo/UndoHost'
import { GlobalHotkeys } from '@/keyboard'
import { useThemeSync } from '@/lib/theme'
import { initPushOnBoot, PushPrompts } from '@/push'
import { RambleReview } from '@/ramble/RambleReview'
import { useSelectionStore } from '@/stores/selection'
import { useUiStore } from '@/stores/ui'
import { Sidebar } from './sidebar'

/**
 * Selectors that mean "not empty space": a task row, any interactive control, or a
 * menu/dialog surface. A mousedown that lands outside all of these is bare content-area
 * whitespace and clears the current focus + multi-selection (Todoist click-to-deselect).
 * Popovers/dialogs are portaled outside `<main>`, so their clicks never reach this handler.
 */
const KEEP_SELECTION =
  '[id^="task-"], button, a, input, textarea, select, [role="menu"], [role="menuitem"], [role="dialog"], [role="listbox"], [contenteditable="true"]'

function clearSelectionOnEmptyClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (target === null || target.closest(KEEP_SELECTION) !== null) return
  const sel = useSelectionStore.getState()
  if (sel.focusedId !== null) sel.setFocused(null)
  if (sel.selectedIds.size > 0) sel.clearSelection()
}

/**
 * App frame: resizable sidebar (which now owns the account menu, notifications, Add task +
 * mic, and Search — the former global top bar is gone) + a scrollable content column. Each
 * view owns its own `max-w-[var(--content-max)] mx-auto` wrapper, so `<main>` is just the
 * scroll container; a mousedown on its empty space clears the task selection. When the
 * sidebar is collapsed a floating toggle re-opens it. Global portals (Quick Add, task detail,
 * palette, toasts, hotkeys, multi-select toolbar) mount here, and SSE cache invalidation is
 * wired once.
 */
export function AppLayout() {
  useSseInvalidation()
  useThemeSync()
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  // phase 6: re-sync any existing push subscription once per app boot (Task K implements)
  useEffect(() => {
    initPushOnBoot()
  }, [])

  return (
    <div className="relative h-screen overflow-hidden bg-bg font-sans text-body text-text-primary antialiased">
      <a
        href="#main"
        className="sr-only rounded-sm bg-surface px-4 py-2 font-medium text-body text-text-primary shadow-menu focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[var(--z-toast)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--od-focus-ring)]"
      >
        Skip to content
      </a>
      {sidebarCollapsed && (
        <button
          type="button"
          aria-label="Toggle sidebar"
          title="Toggle sidebar · M"
          onClick={toggleSidebar}
          className="absolute top-2.5 left-2 z-[var(--z-sidebar)] flex size-8 items-center justify-center rounded-sm bg-surface text-text-secondary shadow-menu outline-none transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <PanelLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      <div className="grid h-full grid-cols-[auto_1fr]">
        <Sidebar />
        <div className="flex min-w-0 flex-col overflow-hidden">
          <main
            id="main"
            tabIndex={-1}
            onMouseDown={clearSelectionOnEmptyClick}
            className="min-h-0 flex-1 overflow-y-auto outline-none"
          >
            <Outlet />
          </main>
        </div>
      </div>
      <QuickAddDialog />
      <TaskDetailDialog />
      {/* phase-7 (Task K): voice-note review-confirm dialog, opened by the Quick Add mic button */}
      <RambleReview />
      <CommandPalette />
      {/* info/error message toasts only — undo toasts render via UndoHost below */}
      <Toaster />
      <GlobalHotkeys />
      <MultiSelectToolbar />
      {/* phase-5 hosts (Task A): dialogs (Tasks E/F) + THE single-slot undo toast (Task W) —
          the app's one undo system (features/undo/store.ts) */}
      <DialogHost />
      <UndoHost />
      {/* phase-6 host (Task A wiring): push permission pre-prompt + iOS install screen (Task K) */}
      <PushPrompts />
    </div>
  )
}
