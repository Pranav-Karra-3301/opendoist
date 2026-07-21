import { expect, type Locator, type Page, test } from '@playwright/test'
import { quickAdd, SEL } from './helpers'

/**
 * Regressions for the visual-law review findings (dossier §2.7/§2.9):
 *
 * 1. `outline-none` + `focus-visible:outline-2` surfaces must actually paint the ring — in
 *    Tailwind v4 `outline-none` sets `--tw-outline-style: none`, which `outline-2` then
 *    references, so without an explicit `focus-visible:outline-solid` the ring is invisible.
 * 2. The ring must be blue *before* focus ever lands (`outline-color` pinned in @layer base):
 *    `transition-colors` includes `outline-color`, so an unpinned ring fades in from
 *    currentColor (grey) instead of appearing instantly as #1f60c2.
 * 3. The keyboard-focused task row uses the dedicated `--od-row-focus-bg` (#fafafa), not the
 *    generic hover token (#f3f3f3), plus the inset `--od-row-focus-ring`.
 * 4. Menu-semantics popovers (more actions) carry the Dropdown/menu chrome (`shadow-menu` +
 *    1px border) while the scheduler keeps the popover shadow.
 * 5. The Button `secondary` variant resolves the §2.9 law colors in both light and dark.
 */

const FOCUS_BLUE = 'rgb(31, 96, 194)' // #1f60c2

/** Computed outline pieces + whether the element currently matches :focus-visible. */
function outlineParts(el: Locator) {
  return el.evaluate((node) => {
    const s = getComputedStyle(node)
    return {
      focusVisible: node.matches(':focus-visible'),
      style: s.outlineStyle,
      width: s.outlineWidth,
      color: s.outlineColor,
    }
  })
}

/** Keyboard-walk Tab until `target` is the active element (real :focus-visible focus). */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((el) => el === document.activeElement)) return
  }
  throw new Error(`Tab never reached ${String(target)}`)
}

test('keyboard focus ring is a solid, instantly-blue 2px outline on outline-none surfaces', async ({
  page,
}) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  // Mechanism guard for the "grey flash": outline-color is pinned blue even while unfocused,
  // so transition-colors has nothing to animate when the ring appears.
  const search = page.locator('header button').filter({ hasText: 'Search' })
  expect((await outlineParts(search)).color).toBe(FOCUS_BLUE)

  // The three surfaces the review measured as broken ('2px none'): sidebar Add task,
  // the sidebar Search button, and a sidebar nav link. Sampled immediately after Tab —
  // width/style don't transition, and color is pre-pinned, so there is no settle window.
  // Order matches the sidebar tab order (Add task → mic → Search → nav) so the forward-only
  // tabTo walk reaches each in turn (Views & Chrome pass relocated Search into the sidebar).
  const sidebar = page.locator(SEL.sidebar)
  const surfaces: Locator[] = [
    sidebar.getByRole('button', { name: 'Add task' }),
    search,
    page.locator('a[href="/inbox"]'),
  ]
  for (const surface of surfaces) {
    await tabTo(page, surface)
    const outline = await outlineParts(surface)
    expect(outline).toEqual({
      focusVisible: true,
      style: 'solid',
      width: '2px',
      color: FOCUS_BLUE,
    })
  }
})

test('focused task row, menu popover chrome, and scheduler popover shadow follow the law', async ({
  page,
}) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await quickAdd(page, 'Visual law probe today')
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  // Row action buttons never flash a grey ring: their outline-color is blue pre-focus.
  const moreButton = page
    .locator(SEL.taskRow)
    .filter({ hasText: 'Visual law probe' })
    .first()
    .getByRole('button', { name: SEL.moreActions })
  expect((await outlineParts(moreButton)).color).toBe(FOCUS_BLUE)

  // `j` focuses the first row: bg #fafafa (row-focus token, not the #f3f3f3 hover token)
  // plus the inset 1px rgba(31,96,194,.4) ring.
  await page.keyboard.press('j')
  const focusedRow = page.locator(SEL.focusedRow)
  await expect(focusedRow).toBeVisible()
  const rowStyle = await focusedRow.evaluate((node) => {
    const s = getComputedStyle(node)
    return { bg: s.backgroundColor, shadow: s.boxShadow }
  })
  expect(rowStyle.bg).toBe('rgb(250, 250, 250)') // #fafafa
  expect(rowStyle.shadow).toContain('rgba(31, 96, 194, 0.4)')
  expect(rowStyle.shadow).toContain('inset')

  // `.` opens the more-actions popover — menu semantics: shadow-menu + 1px border (light).
  await page.keyboard.press('.')
  const popover = page.locator('[data-slot="popover-content"]')
  await expect(popover.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  const menuStyle = await popover.evaluate((node) => {
    const s = getComputedStyle(node)
    return {
      shadow: s.boxShadow,
      borderWidth: s.borderTopWidth,
      borderStyle: s.borderTopStyle,
      borderColor: s.borderTopColor,
    }
  })
  // --shadow-menu; Chromium may serialize an explicit 0px spread.
  expect(menuStyle.shadow).toMatch(/^rgba\(0, 0, 0, 0\.08\) 0px 2px 4px( 0px)?$/)
  expect(menuStyle.borderWidth).toBe('1px')
  expect(menuStyle.borderStyle).toBe('solid')
  // Tailwind's black/10 computes as oklab(0 0 0 / 0.1) in Chromium (== rgba(0,0,0,.1)).
  expect(menuStyle.borderColor).toMatch(/oklab\(0 0 0 \/ 0\.1\)|rgba\(0, 0, 0, 0\.1\)/)
  await page.keyboard.press('Escape')
  // Wait for the fade-out to unmount the popup so the next popover is the only match.
  await expect(popover).toHaveCount(0)

  // `t` opens the scheduler — popover semantics keep --shadow-popover and no light border.
  await page.keyboard.press('t')
  await expect(popover.getByPlaceholder('Type a date…')).toBeVisible()
  const schedulerStyle = await popover.evaluate((node) => {
    const s = getComputedStyle(node)
    return { shadow: s.boxShadow, borderWidth: s.borderTopWidth }
  })
  expect(schedulerStyle.shadow).toMatch(
    /^rgba\(0, 0, 0, 0\.08\) 0px 1px 8px( 0px)?, rgba\(0, 0, 0, 0\.3\) 0px 0px 1px( 0px)?$/,
  )
  expect(schedulerStyle.borderWidth).toBe('0px')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
})

test('button secondary variant resolves the §2.9 law colors in light and dark', async ({
  page,
}) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  // Probe carries the frozen secondary-variant background class (generated from button.tsx).
  const probe = await page.evaluate(() => {
    const btn = document.createElement('button')
    btn.className = 'bg-[var(--od-btn-secondary-bg)]'
    document.body.append(btn)
    const read = () => ({
      idle: getComputedStyle(btn).backgroundColor,
      hover: getComputedStyle(btn).getPropertyValue('--od-btn-secondary-bg-hover').trim(),
    })
    const light = read()
    document.documentElement.dataset.theme = 'dark'
    const dark = read()
    document.documentElement.removeAttribute('data-theme')
    btn.remove()
    return { light, dark }
  })
  expect(probe.light).toEqual({ idle: 'rgb(245, 245, 245)', hover: '#e5e5e5' }) // #f5f5f5 → #e5e5e5
  expect(probe.dark).toEqual({ idle: 'rgb(41, 41, 41)', hover: '#3d3d3d' }) // #292929 → #3d3d3d
})
