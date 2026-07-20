/**
 * `openListComposer` — the imperative bridge from the `a` / `Shift+A` shortcuts
 * (`keyboard/index.tsx`) to the in-list "+ Add task" rows that each list view (Inbox / Today /
 * Upcoming day / Project section) renders. Task H's rule: those list-anchored triggers open the
 * INLINE composer, never the centered dialog.
 *
 * The views own the row↔composer swap with local state (there is no shared store), so the shortcut
 * reaches them the same way a pointer does: it finds the trigger button and dispatches a real
 * click, which mounts the {@link InlineComposer} in place and autofocuses it. `a` targets the LAST
 * trigger in the scroll container (the bottom of the view), `Shift+A` the FIRST (the top) —
 * restoring Todoist's add-at-bottom / add-at-top semantics.
 *
 * Returns `false` when the current view exposes no such rows (Filters & Labels, Reporting,
 * Settings, an empty detail route …); the caller then falls back to the centered Quick Add dialog.
 */

/**
 * The in-list "+ Add task" trigger rows live inside the app scroll container `<main id="main">` and
 * carry the accessible text "Add task". The composer's own "Add task" submit button shares that
 * label, so any button inside an already-open composer (`[data-slot="inline-composer"]`) is
 * excluded — only the collapsed row triggers count. Ordered top-to-bottom by DOM order.
 */
function addTaskTriggers(): HTMLButtonElement[] {
  const main = document.getElementById('main')
  if (main === null) return []
  return [...main.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) =>
      button.closest('[data-slot="inline-composer"]') === null &&
      button.textContent?.replace(/\s+/g, ' ').trim() === 'Add task',
  )
}

/**
 * Open the list view's inline composer at the given end. Returns `true` if a trigger was found and
 * clicked (list context), `false` otherwise (non-list context — the caller opens the dialog).
 */
export function openListComposer(placement: 'top' | 'bottom'): boolean {
  const triggers = addTaskTriggers()
  if (triggers.length === 0) return false
  const target = placement === 'top' ? triggers[0] : triggers[triggers.length - 1]
  if (target === undefined) return false
  target.scrollIntoView({ block: placement === 'top' ? 'start' : 'nearest' })
  target.click()
  return true
}
