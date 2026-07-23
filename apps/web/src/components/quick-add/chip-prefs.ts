/**
 * Pure Quick Add chip-preferences logic, shared by the composer chip row (chip-row.tsx) and the
 * Settings → Quick Add page (features/settings/pages/QuickAddPage.tsx). Operates on the frozen
 * `QuickAddPrefs.chips` array (`{ id, visible }[]`, plan Task A Step 1) and imports ONLY
 * @opentask/core, so it stays node-testable with no React/dnd dependency. Implements plan Task Q.
 */
import { QUICK_ADD_CHIP_IDS, type QuickAddChipId, type QuickAddPrefs } from '@opentask/core'

/** One stored chip preference: a frozen chip id plus its visibility. */
export type ChipPref = QuickAddPrefs['chips'][number]

const CHIP_ID_SET = new Set<string>(QUICK_ADD_CHIP_IDS)

/** Type guard: is `id` one of the seven frozen Quick Add chip ids? */
export function isChipId(id: string): id is QuickAddChipId {
  return CHIP_ID_SET.has(id)
}

/**
 * Reconcile stored chips against the frozen id set: drop unknown/duplicate ids (server or
 * schema drift), preserve the stored order, then append any missing frozen chips as visible.
 * Guarantees both the composer and the settings page always see all seven chips exactly once,
 * in a stable order, no matter what shape the persisted document has.
 */
export function normalizeChips(chips: readonly ChipPref[]): ChipPref[] {
  const seen = new Set<QuickAddChipId>()
  const out: ChipPref[] = []
  for (const chip of chips) {
    if (isChipId(chip.id) && !seen.has(chip.id)) {
      seen.add(chip.id)
      out.push({ id: chip.id, visible: chip.visible })
    }
  }
  for (const id of QUICK_ADD_CHIP_IDS) {
    if (!seen.has(id)) out.push({ id, visible: true })
  }
  return out
}

/** Split chips into visible and hidden buckets, preserving order (non-mutating). */
export function partitionChips(chips: readonly ChipPref[]): {
  visible: ChipPref[]
  hidden: ChipPref[]
} {
  const visible: ChipPref[] = []
  const hidden: ChipPref[] = []
  for (const chip of chips) {
    ;(chip.visible ? visible : hidden).push({ id: chip.id, visible: chip.visible })
  }
  return { visible, hidden }
}

/** Set a single chip's visibility, leaving order and the other chips untouched (non-mutating). */
export function setChipVisible(
  chips: readonly ChipPref[],
  id: QuickAddChipId,
  visible: boolean,
): ChipPref[] {
  return chips.map((chip) =>
    chip.id === id ? { id: chip.id, visible } : { id: chip.id, visible: chip.visible },
  )
}

/**
 * Move `activeId` onto `overId`'s slot (drag reorder), matching dnd-kit's `arrayMove` semantics.
 * Non-mutating; returns a fresh array. A missing id or a self-drop is a no-op copy.
 */
export function moveChip(chips: readonly ChipPref[], activeId: string, overId: string): ChipPref[] {
  const next = chips.map((chip) => ({ id: chip.id, visible: chip.visible }))
  const from = next.findIndex((chip) => chip.id === activeId)
  const to = next.findIndex((chip) => chip.id === overId)
  const moved = next[from]
  if (from === -1 || to === -1 || from === to || moved === undefined) return next
  next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
