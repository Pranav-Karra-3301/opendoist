/**
 * Keyboard map — the single source of truth for BOTH the global bindings
 * (`keyboard/index.tsx`) and the `?` shortcut overlay (`keyboard/shortcut-overlay.tsx`).
 *
 * Adopted from the Todoist web map (dossier §1.6) minus the keys OpenTask v1 does not
 * implement — the omission is deliberate and recorded here:
 *   - Collaboration: `Shift+R` (assign), `Shift+S` (share project) — single-user, no sharing.
 *   - Desktop-only globals: `Option/Ctrl+Space` Quick Add, `Option+Shift+R` Quick Ramble,
 *     window management, macOS `Cmd+1..5` — the PWA has no OS-level hooks.
 *   - Sort keys `D/P/N/R`, layout `Shift+V`/`W`, and the whole Display menu — phase 5.
 *   - Zoom `Cmd+±/0`, Print `Cmd+P`, `Cmd+Alt+0` collapse-all — browser/native concerns.
 *   - Extra navigation: `Shift+G` (open in project), `Tab` focus cycling, `→`/`←` focus, and the
 *     still-unbuilt `o>h`/`o>n`/`o>u` and `g>p`/`g>/` sequences. Phase 5 lands the rest: `g>v`/`g>l`
 *     (Filters & Labels), `g>a` (Reporting), `o>s`/`o>t` (Settings), `o>p` (Productivity) — see the
 *     Navigation group.
 *   - In-editor: `Cmd+E` edit, `Cmd+↑/↓` move-while-editing, `Cmd+V` paste-as-task, `Shift+Enter`.
 *
 * `keys` is the react-hotkeys-hook binding string (default split `+`, sequence `>`, list
 * delimiter `,`). Special keys use `event.code` names — `slash` `period` `comma`
 * `bracketright` `bracketleft` `backspace` `delete` `home` `down` `up` — so physical keys
 * match regardless of layout. `display` is the human string the overlay renders as <kbd>
 * caps: it is space-split, the words `or`/`then`/`–` render as plain separators, and the
 * token `Mod` becomes ⌘ on macOS / Ctrl elsewhere.
 */

export type ShortcutGroup =
  | 'General'
  | 'Navigation'
  | 'Add tasks'
  | 'Manage tasks'
  | 'Project view'
  | 'Upcoming'

export interface Shortcut {
  id: string
  keys: string
  display: string
  group: ShortcutGroup
  desc: string
  /** Bind even while a form control is focused (only `esc`, which defers to open layers). */
  enabledOnForms?: boolean
}

export const SHORTCUTS = [
  // ---- General ----
  // `q` and Space both open the centered dialog; they bind separately (index.tsx) because Space is
  // gated on the focus target (it must keep activating a focused button/checkbox and scrolling the
  // page while an interactive element is focused — Task H entry-point semantics).
  { id: 'quick-add', keys: 'q, space', display: 'Q or Space', group: 'General', desc: 'Quick Add' },
  { id: 'search', keys: 'slash, f', display: '/ or F', group: 'General', desc: 'Search' },
  { id: 'palette', keys: 'mod+k', display: 'Mod K', group: 'General', desc: 'Command menu' },
  { id: 'sidebar', keys: 'm', display: 'M', group: 'General', desc: 'Toggle sidebar' },
  {
    id: 'shortcuts',
    keys: 'shift+slash',
    display: '?',
    group: 'General',
    desc: 'Keyboard shortcuts',
  },
  {
    id: 'dismiss',
    keys: 'esc',
    display: 'Esc',
    group: 'General',
    desc: 'Close / clear selection',
    enabledOnForms: true,
  },
  // ---- Navigation ----
  {
    id: 'go-today',
    keys: 'g>t, g>h',
    display: 'G then T',
    group: 'Navigation',
    desc: 'Go to Today',
  },
  { id: 'go-inbox', keys: 'g>i', display: 'G then I', group: 'Navigation', desc: 'Go to Inbox' },
  {
    id: 'go-upcoming',
    keys: 'g>u',
    display: 'G then U',
    group: 'Navigation',
    desc: 'Go to Upcoming',
  },
  {
    id: 'go-filters-labels',
    keys: 'g>v, g>l',
    display: 'G then V',
    group: 'Navigation',
    desc: 'Go to Filters & Labels',
  },
  {
    id: 'go-reporting',
    keys: 'g>a',
    display: 'G then A',
    group: 'Navigation',
    desc: 'Go to Reporting',
  },
  {
    id: 'productivity',
    keys: 'o>p',
    display: 'O then P',
    group: 'Navigation',
    desc: 'Productivity stats',
  },
  {
    id: 'open-settings',
    keys: 'o>s',
    display: 'O then S',
    group: 'Navigation',
    desc: 'Go to Settings',
  },
  {
    id: 'open-theme',
    keys: 'o>t',
    display: 'O then T',
    group: 'Navigation',
    desc: 'Go to Theme settings',
  },
  {
    id: 'focus-down',
    keys: 'j, down',
    display: 'J or ↓',
    group: 'Navigation',
    desc: 'Move focus down',
  },
  { id: 'focus-up', keys: 'k, up', display: 'K or ↑', group: 'Navigation', desc: 'Move focus up' },
  // ---- Add tasks ----
  { id: 'add-bottom', keys: 'a', display: 'A', group: 'Add tasks', desc: 'Add task (bottom)' },
  {
    id: 'add-top',
    keys: 'shift+a',
    display: 'Shift A',
    group: 'Add tasks',
    desc: 'Add task (top)',
  },
  // ---- Manage tasks ----
  { id: 'open-task', keys: 'enter', display: 'Enter', group: 'Manage tasks', desc: 'Open task' },
  { id: 'complete', keys: 'e', display: 'E', group: 'Manage tasks', desc: 'Complete task' },
  { id: 'schedule', keys: 't', display: 'T', group: 'Manage tasks', desc: 'Schedule' },
  {
    id: 'remove-date',
    keys: 'shift+t',
    display: 'Shift T',
    group: 'Manage tasks',
    desc: 'Remove date',
  },
  {
    id: 'priority',
    keys: '1, 2, 3, 4',
    display: '1 – 4',
    group: 'Manage tasks',
    desc: 'Set priority',
  },
  { id: 'priority-menu', keys: 'y', display: 'Y', group: 'Manage tasks', desc: 'Change priority' },
  { id: 'comment', keys: 'c', display: 'C', group: 'Manage tasks', desc: 'Comment' },
  { id: 'labels', keys: 'l', display: 'L', group: 'Manage tasks', desc: 'Edit labels' },
  { id: 'move', keys: 'v', display: 'V', group: 'Manage tasks', desc: 'Move to project' },
  { id: 'more', keys: 'period', display: '.', group: 'Manage tasks', desc: 'More actions' },
  { id: 'select', keys: 'x', display: 'X', group: 'Manage tasks', desc: 'Select task' },
  {
    id: 'focus-toolbar',
    keys: 'comma',
    display: ',',
    group: 'Manage tasks',
    desc: 'Focus selection toolbar',
  },
  {
    id: 'delete',
    keys: 'mod+backspace, shift+delete',
    display: 'Mod ⌫ or Shift Del',
    group: 'Manage tasks',
    desc: 'Delete task',
  },
  {
    id: 'copy-link',
    keys: 'shift+mod+c',
    display: 'Shift Mod C',
    group: 'Manage tasks',
    desc: 'Copy task link',
  },
  {
    id: 'toggle-subtasks',
    keys: 'shift+e',
    display: 'Shift E',
    group: 'Manage tasks',
    desc: 'Toggle subtasks',
  },
  // ---- Project view ----
  {
    id: 'indent',
    keys: 'ctrl+bracketright',
    display: 'Ctrl ]',
    group: 'Project view',
    desc: 'Indent (make subtask)',
  },
  {
    id: 'outdent',
    keys: 'ctrl+bracketleft',
    display: 'Ctrl [',
    group: 'Project view',
    desc: 'Un-indent',
  },
  { id: 'add-section', keys: 's', display: 'S', group: 'Project view', desc: 'Add section' },
  // ---- Upcoming ----
  {
    id: 'prev-week',
    keys: 'shift+left',
    display: 'Shift ←',
    group: 'Upcoming',
    desc: 'Previous week',
  },
  {
    id: 'next-week',
    keys: 'shift+right',
    display: 'Shift →',
    group: 'Upcoming',
    desc: 'Next week',
  },
  { id: 'goto-today', keys: 'home', display: 'Home', group: 'Upcoming', desc: 'Jump to today' },
] as const satisfies readonly Shortcut[]

export type ShortcutId = (typeof SHORTCUTS)[number]['id']

/** Rendering order of the groups in the overlay. */
export const GROUP_ORDER: readonly ShortcutGroup[] = [
  'General',
  'Navigation',
  'Add tasks',
  'Manage tasks',
  'Project view',
  'Upcoming',
]

const KEYS_BY_ID: ReadonlyMap<string, string> = new Map(SHORTCUTS.map((s) => [s.id, s.keys]))

/** The react-hotkeys-hook binding string for a shortcut — keeps bindings and overlay in sync. */
export function shortcutKeys(id: ShortcutId): string {
  return KEYS_BY_ID.get(id) ?? ''
}
