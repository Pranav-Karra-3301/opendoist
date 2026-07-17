import { Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
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
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'

/**
 * App frame: resizable sidebar + topbar + scrollable content column. Each view owns
 * its own `max-w-[var(--content-max)] mx-auto` wrapper, so `<main>` is just the scroll
 * container. Global portals (Quick Add, task detail, palette, toasts, hotkeys,
 * multi-select toolbar) mount here, and SSE cache invalidation is wired once.
 */
export function AppLayout() {
  useSseInvalidation()
  useThemeSync()
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
      <div className="grid h-full grid-cols-[auto_1fr]">
        <Sidebar />
        <div className="flex min-w-0 flex-col overflow-hidden">
          <Topbar />
          <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
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
