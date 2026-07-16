/**
 * Pure data helpers for the Filters & Labels page (Task D). Zero React/DOM imports so it runs
 * under the app's `node`-environment Vitest harness.
 *
 * The `Filter` wire type + `useFilters` query live in `@/api/hooks/filters` (created by Task J
 * for the sidebar Favorites, on the `['filters']` key); this task consumes that hook rather than
 * redefining it, and keeps only the ordering/reorder/undo-payload transforms here.
 */

export interface FilterCreateBody {
  name: string
  query: string
  color: string
  is_favorite: boolean
}
/** Durable fields for recreating a filter after delete (undo path — there is no restore route
 *  for filters, so undo re-POSTs the captured object; the recreated row gets a fresh id). */
export function filterToCreate(f: {
  name: string
  query: string
  color: string
  is_favorite: boolean
}): FilterCreateBody {
  return { name: f.name, query: f.query, color: f.color, is_favorite: f.is_favorite }
}

export interface LabelCreateBody {
  name: string
  color: string
  is_favorite: boolean
}
/** Durable fields for recreating a label after delete (same undo-recreates-via-POST path). */
export function labelToCreate(l: {
  name: string
  color: string
  is_favorite: boolean
}): LabelCreateBody {
  return { name: l.name, color: l.color, is_favorite: l.is_favorite }
}

/** Stable order by `item_order`, id-tiebreak — matches the server's `ORDER BY item_order, id`. */
export function byItemOrder<T extends { item_order: number; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.item_order - b.item_order || a.id.localeCompare(b.id))
}

/**
 * Move `activeId` into `overId`'s slot, returning a NEW ordered id array (a copy on any
 * no-op — same id, missing id, or already in place). Equivalent to dnd-kit `arrayMove` but
 * dependency-free so it is unit-testable and drives the optimistic reorder.
 */
export function reorderIds(ids: readonly string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from === -1 || to === -1 || from === to) return [...ids]
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return [...ids]
  next.splice(to, 0, moved)
  return next
}

/**
 * Rewrite `item_order` (1-based) onto `rows` to match `orderedIds`, dropping ids not in
 * `rows`. Used both to build the optimistic cache after a drag and to derive the reorder
 * request payload; one function keeps the two in agreement.
 */
export function applyOrder<T extends { id: string; item_order: number }>(
  rows: readonly T[],
  orderedIds: readonly string[],
): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  return orderedIds.flatMap((id, i) => {
    const row = byId.get(id)
    return row ? [{ ...row, item_order: i + 1 }] : []
  })
}
