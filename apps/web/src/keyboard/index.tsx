/**
 * `<GlobalHotkeys/>` — one component (mounted once by the app layout) that binds the whole
 * SHORTCUTS map via react-hotkeys-hook and renders the `?` overlay. All bindings source their
 * key strings from `keyboard/map.ts`, so the overlay and the live bindings can never drift.
 *
 * Design notes:
 * - Task verbs act on the multi-selection when one exists, else the focused row (see
 *   `targetIds`/`primaryTarget`). `complete` = `close.mutate` (the checkbox completion
 *   animation is bypassed on keypress — acceptable per plan).
 * - Handlers read stores/router imperatively via `getState()` / `router.state`, so they always
 *   see live values; react-hotkeys-hook keeps the latest callback (no deps array passed).
 * - `enabled`/`preventDefault` predicates are stable (`useCallback`) so the hooks don't
 *   re-subscribe every render. Route-scoped shortcuts pass a route predicate to BOTH so the
 *   browser default (e.g. Home scroll) is only suppressed inside that view.
 * - Sequence guard: react-hotkeys-hook fires each `useHotkeys` independently, so the second key
 *   of `g … ` (e.g. `t`) would ALSO trigger the standalone `t` (schedule). A capture-phase
 *   listener flags "this keydown continues a `g` sequence" and standalone bare keys skip it.
 * - Esc chain: if any base-ui layer is open it owns the key (it self-closes); otherwise Esc
 *   clears a multi-selection. Modal dialogs (Quick Add / palette / detail / this overlay) also
 *   suppress the row/nav verbs so they never fire behind an open dialog.
 */

import type { Priority } from '@opendoist/core'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { type ReactElement, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTaskMutations } from '@/api/hooks/tasks'
import { qk } from '@/api/keys'
import type { Task } from '@/api/schemas'
import { useSelectionStore } from '@/stores/selection'
import { toast } from '@/stores/toasts'
import { useUiStore } from '@/stores/ui'
// Cross-task frozen exports: Task K's `useUpcomingStore` (gotoWeek/gotoToday) and Task L's
// `useProjectViewStore`/`indentTask`/`outdentTask`. Route-scoped shortcuts drive them.
import { indentTask, outdentTask, useProjectViewStore } from '@/views/project/use-project-dnd'
import { useUpcomingStore } from '@/views/upcoming/use-upcoming-days'
import { SHORTCUTS, shortcutKeys } from './map'
import { ShortcutOverlay } from './shortcut-overlay'
import { useFocusNav } from './use-focus-nav'

/** A modal dialog (Quick Add, palette, task detail, this overlay) is on top. */
function modalOpen(): boolean {
  return document.querySelector('[data-slot="dialog-content"][data-open]') !== null
}

/** Any base-ui layer (dialog, menu, popover, tooltip) is currently open. */
function anyLayerOpen(): boolean {
  return document.querySelector('[data-open]') !== null
}

// --- sequence guard ---------------------------------------------------------------------
// Prefix keys that start a `>` sequence, derived from the map (currently just `g`; phase 5's
// `o>` sequences extend it automatically).
const SEQUENCE_PREFIXES: ReadonlySet<string> = (() => {
  const set = new Set<string>()
  for (const s of SHORTCUTS) {
    for (const rawChord of s.keys.split(',')) {
      const chord = rawChord.trim()
      const arrow = chord.indexOf('>')
      if (arrow > 0) set.add(chord.slice(0, arrow).toLowerCase())
    }
  }
  return set
})()
const SEQUENCE_WINDOW_MS = 1000
let prefixPressedAt = 0
let continuesSequence = false

if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      const key = e.key.toLowerCase()
      if (bare && SEQUENCE_PREFIXES.has(key)) {
        prefixPressedAt = Date.now()
        continuesSequence = false
      } else {
        continuesSequence = bare && Date.now() - prefixPressedAt < SEQUENCE_WINDOW_MS
        prefixPressedAt = 0
      }
    },
    true, // capture: runs before react-hotkeys-hook's bubble-phase document listeners
  )
}

/** True while the current keydown is the tail of a `g … ` navigation sequence. */
function inSequence(): boolean {
  return continuesSequence
}

/** Ids the task verbs act on: the multi-selection if any, else the focused row. */
function targetIds(): string[] {
  const { selectedIds, focusedId } = useSelectionStore.getState()
  if (selectedIds.size > 0) return [...selectedIds]
  return focusedId ? [focusedId] : []
}

/** Single task for verbs that only make sense on one row (popovers, detail). */
function primaryTarget(): string | null {
  const { focusedId, selectedIds } = useSelectionStore.getState()
  return focusedId ?? [...selectedIds][0] ?? null
}

function focusMultiSelectToolbar(): void {
  // Task F renders the multi-select pill as the app's only role="toolbar"; focus its first action.
  document.querySelector<HTMLButtonElement>('[role="toolbar"] button')?.focus()
}

function copyTaskLink(id: string): void {
  const url = `${window.location.origin}/task/${id}`
  if (!navigator.clipboard) {
    toast.error('Clipboard unavailable')
    return
  }
  navigator.clipboard.writeText(url).then(
    () => toast.info('Link copied'),
    () => toast.error('Copy failed'),
  )
}

/** Esc: defer to any open base-ui layer (it self-closes), else clear a multi-selection. */
function handleEscape(): void {
  if (anyLayerOpen()) return
  const sel = useSelectionStore.getState()
  if (sel.selectedIds.size > 0) sel.clearSelection()
}

const GLOBAL_OPTS = { enableOnFormTags: false, preventDefault: true } as const
const ESC_OPTS = { enableOnFormTags: true, preventDefault: false } as const

export function GlobalHotkeys(): ReactElement {
  const navigate = useNavigate()
  const router = useRouter()
  const qc = useQueryClient()
  const mutations = useTaskMutations()
  const { focusDown, focusUp } = useFocusNav()

  const openDetail = useCallback(
    (id: string) => {
      void navigate({ to: '.', search: (prev) => ({ ...prev, task: id }) })
    },
    [navigate],
  )

  // Stable predicates — evaluated live on each keypress.
  const seqEnabled = useCallback(() => !modalOpen(), [])
  const standaloneEnabled = useCallback(() => !modalOpen() && !inSequence(), [])
  const notInSequence = useCallback(() => !inSequence(), [])
  const inProject = useCallback(
    () => router.state.location.pathname.startsWith('/project/') && !modalOpen() && !inSequence(),
    [router],
  )
  const inUpcoming = useCallback(
    () => router.state.location.pathname.startsWith('/upcoming') && !modalOpen() && !inSequence(),
    [router],
  )
  const canOpenTask = useCallback(() => {
    if (modalOpen() || inSequence() || primaryTarget() === null) return false
    const el = document.activeElement
    // Don't hijack Enter when an interactive control (link/button/menu/input) is focused.
    return !(
      el instanceof HTMLElement &&
      el.matches(
        'input, textarea, select, button, a, [role="menuitem"], [role="button"], [contenteditable="true"]',
      )
    )
  }, [])

  const toggleOpts = { ...GLOBAL_OPTS, enabled: notInSequence }
  const rowOpts = { ...GLOBAL_OPTS, enabled: standaloneEnabled }
  const seqOpts = { ...GLOBAL_OPTS, enabled: seqEnabled, sequenceTimeoutMs: SEQUENCE_WINDOW_MS }
  const enterOpts = { ...GLOBAL_OPTS, enabled: canOpenTask, preventDefault: canOpenTask }
  const projectOpts = { enableOnFormTags: false, enabled: inProject, preventDefault: inProject }
  const upcomingOpts = { enableOnFormTags: false, enabled: inUpcoming, preventDefault: inUpcoming }

  // ---- General ----
  useHotkeys(
    shortcutKeys('quick-add'),
    () => useUiStore.getState().setQuickAddOpen(true),
    toggleOpts,
  )
  useHotkeys(shortcutKeys('search'), () => useUiStore.getState().setPaletteOpen(true), toggleOpts)
  useHotkeys(shortcutKeys('palette'), () => useUiStore.getState().setPaletteOpen(true), GLOBAL_OPTS)
  useHotkeys(shortcutKeys('sidebar'), () => useUiStore.getState().toggleSidebar(), toggleOpts)
  useHotkeys(
    shortcutKeys('shortcuts'),
    () => useUiStore.getState().setShortcutOverlayOpen(true),
    GLOBAL_OPTS,
  )
  useHotkeys(shortcutKeys('dismiss'), handleEscape, ESC_OPTS)

  // ---- Navigation ----
  // react-hotkeys-hook v5 cannot hold two `>`-sequences in ONE binding string: all chords of a
  // call share a single recorded-keys buffer, so on every 'g' the second chord ('g>h') mismatches
  // and wipes the first chord's progress — 'g>t, g>h' never fires (verified against v5.3.3).
  // Bind the map's go-today chords as separate calls instead.
  const goToday = useCallback(() => void navigate({ to: '/today' }), [navigate])
  const [goTodayChord = 'g>t', goTodayAlias = 'g>h'] = shortcutKeys('go-today')
    .split(',')
    .map((chord) => chord.trim())
  useHotkeys(goTodayChord, goToday, seqOpts)
  useHotkeys(goTodayAlias, goToday, seqOpts)
  useHotkeys(shortcutKeys('go-inbox'), () => void navigate({ to: '/inbox' }), seqOpts)
  useHotkeys(shortcutKeys('go-upcoming'), () => void navigate({ to: '/upcoming' }), seqOpts)

  // Phase-5 destinations. `g>v`/`g>l` both anchor Filters & Labels and `g>a`/`o>p` both anchor
  // Reporting — like go-today, each aliased chord is bound as its own call (v5 can't hold two
  // `>`-sequences in one binding string). The `o>` prefix feeds SEQUENCE_PREFIXES automatically.
  const goFiltersLabels = useCallback(() => void navigate({ to: '/filters-labels' }), [navigate])
  const goReporting = useCallback(() => void navigate({ to: '/reporting' }), [navigate])
  const goSettings = useCallback(
    () => void navigate({ to: '/settings/$page', params: { page: 'account' } }),
    [navigate],
  )
  const goThemeSettings = useCallback(
    () => void navigate({ to: '/settings/$page', params: { page: 'theme' } }),
    [navigate],
  )
  const [filtersChord = 'g>v', filtersAlias = 'g>l'] = shortcutKeys('go-filters-labels')
    .split(',')
    .map((chord) => chord.trim())
  useHotkeys(filtersChord, goFiltersLabels, seqOpts)
  useHotkeys(filtersAlias, goFiltersLabels, seqOpts)
  const [reportChord = 'g>a', reportAlias = 'o>p'] = shortcutKeys('go-reporting')
    .split(',')
    .map((chord) => chord.trim())
  useHotkeys(reportChord, goReporting, seqOpts)
  useHotkeys(reportAlias, goReporting, seqOpts)
  useHotkeys(shortcutKeys('open-settings'), goSettings, seqOpts)
  useHotkeys(shortcutKeys('open-theme'), goThemeSettings, seqOpts)

  useHotkeys(shortcutKeys('focus-down'), focusDown, rowOpts)
  useHotkeys(shortcutKeys('focus-up'), focusUp, rowOpts)

  // ---- Add tasks (v1: both open the Quick Add dialog; in-list composer arrives phase 5) ----
  useHotkeys(shortcutKeys('add-bottom'), () => useUiStore.getState().setQuickAddOpen(true), rowOpts)
  useHotkeys(shortcutKeys('add-top'), () => useUiStore.getState().setQuickAddOpen(true), rowOpts)

  // ---- Manage tasks ----
  useHotkeys(
    shortcutKeys('open-task'),
    () => {
      const id = primaryTarget()
      if (id) openDetail(id)
    },
    enterOpts,
  )
  useHotkeys(
    shortcutKeys('complete'),
    () => {
      for (const id of targetIds()) mutations.close.mutate({ id })
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('schedule'),
    () => {
      const id = primaryTarget()
      if (id) useUiStore.getState().openRowPopover(id, 'schedule')
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('remove-date'),
    () => {
      for (const id of targetIds()) mutations.update.mutate({ id, patch: { due: null } })
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('priority'),
    (e) => {
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > 4) return
      const priority = n as Priority
      for (const id of targetIds()) mutations.update.mutate({ id, patch: { priority } })
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('priority-menu'),
    () => {
      const id = primaryTarget()
      if (id) useUiStore.getState().openRowPopover(id, 'priority')
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('comment'),
    () => {
      const id = primaryTarget()
      if (id) {
        useUiStore.getState().setDetailCommentFocus(true)
        openDetail(id)
      }
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('labels'),
    () => {
      const id = primaryTarget()
      if (id) useUiStore.getState().openRowPopover(id, 'labels')
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('move'),
    () => {
      const id = primaryTarget()
      if (id) useUiStore.getState().openRowPopover(id, 'move')
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('more'),
    () => {
      const id = primaryTarget()
      if (id) useUiStore.getState().openRowPopover(id, 'more')
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('select'),
    () => {
      const { focusedId, toggleSelected } = useSelectionStore.getState()
      if (focusedId) toggleSelected(focusedId)
    },
    rowOpts,
  )
  useHotkeys(shortcutKeys('focus-toolbar'), focusMultiSelectToolbar, rowOpts)
  useHotkeys(
    shortcutKeys('delete'),
    () => {
      for (const id of targetIds()) mutations.remove.mutate({ id })
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('copy-link'),
    () => {
      const id = primaryTarget()
      if (id) copyTaskLink(id)
    },
    rowOpts,
  )
  useHotkeys(
    shortcutKeys('toggle-subtasks'),
    () => {
      const id = primaryTarget()
      if (!id) return
      const task = qc.getQueryData<Task[]>(qk.tasks)?.find((t) => t.id === id)
      if (task) {
        mutations.update.mutate({ id, patch: { is_collapsed: !task.is_collapsed }, silent: true })
      }
    },
    rowOpts,
  )

  // ---- Project view (route-scoped) ----
  useHotkeys(
    shortcutKeys('indent'),
    () => {
      const id = primaryTarget()
      if (id) indentTask(id)
    },
    projectOpts,
  )
  useHotkeys(
    shortcutKeys('outdent'),
    () => {
      const id = primaryTarget()
      if (id) outdentTask(id)
    },
    projectOpts,
  )
  useHotkeys(
    shortcutKeys('add-section'),
    () => useProjectViewStore.getState().startAddSection(),
    projectOpts,
  )

  // ---- Upcoming view (route-scoped) ----
  useHotkeys(
    shortcutKeys('prev-week'),
    () => useUpcomingStore.getState().gotoWeek(-1),
    upcomingOpts,
  )
  useHotkeys(shortcutKeys('next-week'), () => useUpcomingStore.getState().gotoWeek(1), upcomingOpts)
  useHotkeys(
    shortcutKeys('goto-today'),
    () => useUpcomingStore.getState().gotoToday(),
    upcomingOpts,
  )

  return <ShortcutOverlay />
}
