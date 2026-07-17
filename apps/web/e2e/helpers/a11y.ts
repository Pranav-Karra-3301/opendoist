import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Shared axe gate: WCAG 2.x A+AA, zero serious/critical violations. */
export async function expectNoAxeViolations(
  page: Page,
  options?: { include?: string; exclude?: string[] },
) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (options?.include) builder = builder.include(options.include)
  for (const sel of options?.exclude ?? []) builder = builder.exclude(sel)
  const results = await builder.analyze()
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([])
}
