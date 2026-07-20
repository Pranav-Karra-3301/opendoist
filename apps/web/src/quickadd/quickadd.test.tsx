/**
 * Quick Add popover tests (desktop Task C). apps/web runs Vitest in the `node` environment
 * with no jsdom / testing-library (see components/feedback/feedback.test.tsx), so these render
 * with `react-dom/server` and inspect the markup. `rich-textarea` is mocked to a DOM-free
 * stand-in that still invokes the live-highlight overlay render-prop, which lets the parsed
 * `@opendoist/core` token spans surface in the static markup.
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

interface RichTextareaMockProps {
  value: string
  children?: (v: string) => ReactNode
  placeholder?: string
  className?: string
  'aria-label'?: string
}

// Stand-in for the real editor: a plain wrapper whose aria-hidden overlay renders the token
// highlight nodes (via the children render-prop) alongside the labelled textarea. No refs,
// selection, or layout — enough to render statically and assert the token contract.
vi.mock('rich-textarea', async () => {
  const { createElement } = await import('react')
  return {
    RichTextarea: (props: RichTextareaMockProps) =>
      createElement(
        'div',
        { 'data-mock-rich-textarea': 'true' },
        createElement(
          'div',
          { 'aria-hidden': 'true' },
          typeof props.children === 'function' ? props.children(props.value) : null,
        ),
        createElement('textarea', {
          readOnly: true,
          value: props.value,
          placeholder: props.placeholder,
          className: props.className,
          'aria-label': props['aria-label'],
        }),
      ),
  }
})

// Spy on the transport choke point while keeping `endpoints` / `ApiError` real.
const apiMock = vi.fn().mockResolvedValue({})
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, api: apiMock }
})

// Loaded via top-level await AFTER the mock declarations above: a static import would hoist
// past them (the '@/api/client' factory closes over `apiMock` — TDZ), while a dynamic import
// inside a test window flakes under the full parallel suite, where the shared vite
// transform/eval queue can exceed any per-test budget. Here the cost lands in the unbounded
// import phase, like every statically-imported graph.
const { desktopParseContext } = await import('./logic')

describe('desktopParseContext', () => {
  it('builds a ParseContext from Intl + core defaults', () => {
    const ctx = desktopParseContext(new Date('2026-07-15T21:00:00Z'))
    expect(ctx.now).toBe('2026-07-15T21:00:00.000Z')
    expect(ctx.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(ctx.weekStart).toBe(1)
    expect(ctx.smartDate).toBe(true)
  })
})

// The App import legitimately pays the whole component-graph transform on a cold CI runner;
// budget for it instead of flaking at the 5s default (a real hang still fails at 20s).
describe('App rendering', { timeout: 20_000 }, () => {
  it('renders the capture card with the labelled input and key hints', async () => {
    const { App } = await import('./App')
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('aria-label="Quick add task"')
    expect(html).toContain('Quick Add')
    expect(html).toContain('Add a task')
    expect(html).toContain('Cancel')
    expect(html).toContain('esc')
  })

  it('live-highlights a sample string via @opendoist/core', async () => {
    const { App } = await import('./App')
    const html = renderToStaticMarkup(<App initialText="pay rent tomorrow p1 #Home" />)
    expect(html).toContain('data-kind="due"')
    expect(html).toContain('data-kind="priority"')
    expect(html).toContain('data-kind="project"')
  })
})

describe('submitQuickAdd', () => {
  it('POSTs the raw text to /tasks/quick through the api client', async () => {
    apiMock.mockClear()
    const { submitQuickAdd } = await import('./App')
    const { endpoints } = await import('@/api/client')
    await submitQuickAdd('pay rent tomorrow p1 #Home')
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith(
      endpoints.quick,
      expect.objectContaining({ method: 'POST', body: { text: 'pay rent tomorrow p1 #Home' } }),
    )
  })
})
