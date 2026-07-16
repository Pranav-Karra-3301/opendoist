import { expect, type Page } from '@playwright/test'

/**
 * Shared E2E helpers + the frozen selector map for the phase-4 web shell.
 *
 * Every selector below is verified against a real component (not guessed): the Quick Add
 * dialog title, the `data-kind` highlight spans, the task row `id`/`data-focused` attrs, the
 * `role="checkbox"` + `aria-label="Complete task"` widget, the `aria-label="More actions"`
 * row button, the `role="menuitem"` "Delete", the undo toast's "Undo" button, and the
 * `aside[aria-label="Sidebar"]` `data-collapsed` toggle. Centralised so Gate R can absorb any
 * post-integration drift in one place instead of across six spec files.
 */

/** Where auth.setup.ts writes the authenticated storage state; read by playwright.config.ts. */
export const STORAGE_STATE = 'e2e/.auth/user.json'

export const SEL = {
  /** Quick Add dialog accessible name (DialogTitle sr-only "Quick add task"). */
  quickAddDialog: 'Quick add task',
  /** The rich-textarea (aria-label "Quick add task"). */
  quickAddInput: 'Quick add task',
  /** Priority checkbox custom widget (task-checkbox.tsx). */
  checkbox: 'Complete task',
  /** Row hover action that opens the "more" row popover (task-row.tsx). */
  moreActions: 'More actions',
  /** Undo toast action (undo-toast.tsx). */
  undo: 'Undo',
  /** Collapsible sidebar shell (app/sidebar.tsx). */
  sidebar: 'aside[aria-label="Sidebar"]',
  /** Any task row. */
  taskRow: '[id^="task-"]',
  /** The focused task row — `data-focused` is present only while focused. */
  focusedRow: '[id^="task-"][data-focused]',
  /** A Quick Add highlight token of a given kind. */
  token: (kind: string): string => `[data-kind="${kind}"]`,
} as const

/** Open the Quick Add dialog via the global `q` shortcut and wait for it to mount. */
export async function openQuickAdd(page: Page): Promise<void> {
  await page.keyboard.press('q')
  await expect(page.getByRole('dialog', { name: SEL.quickAddDialog })).toBeVisible()
}

/**
 * Add one task through the real Quick Add UI, then close the dialog deterministically with
 * Cmd/Ctrl+Enter (save + close). Used to seed state; the dedicated quick-add spec exercises
 * the Enter-keeps-open / Escape-closes nuances separately.
 */
export async function quickAdd(page: Page, text: string): Promise<void> {
  await openQuickAdd(page)
  const input = page.getByRole('textbox', { name: SEL.quickAddInput })
  await input.fill(text)
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByRole('dialog', { name: SEL.quickAddDialog })).toBeHidden()
}

/** Seed several tasks in order. */
export async function seedTasks(page: Page, texts: readonly string[]): Promise<void> {
  for (const text of texts) {
    await quickAdd(page, text)
  }
}
