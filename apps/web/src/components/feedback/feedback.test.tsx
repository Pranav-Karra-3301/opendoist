/**
 * apps/web runs Vitest in the `node` environment with no jsdom / testing-library rig
 * (AS-BUILT: `test.environment` is `'node'`, jsdom/happy-dom/@testing-library are not
 * installed, and Task H may not add dependencies). So these tests render with
 * `react-dom/server` and inspect the element tree / class contract directly — no DOM —
 * which is enough to cover the frozen behaviour of the feedback primitives.
 */
import { Inbox } from 'lucide-react'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from './empty-state'
import { ODErrorBoundary } from './error-boundary'
import { Skeleton, TaskListSkeleton } from './skeleton'

/** Walk a React element tree (no DOM) to the first node wired with an onClick handler. */
function findClickable(node: ReactNode): ReactElement<{ onClick?: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findClickable(child)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  const el = node as ReactElement<{ onClick?: () => void; children?: ReactNode }>
  if (typeof el.props.onClick === 'function') return el
  return findClickable(el.props.children)
}

describe('EmptyState', () => {
  it('renders the icon, title, description and an optional action button', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        icon={Inbox}
        title="Your Inbox is clear"
        description="Capture anything with Q — sort it later."
        action={{ label: 'Add task', onClick: () => {} }}
      />,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('Your Inbox is clear')
    expect(html).toContain('Capture anything with Q — sort it later.')
    expect(html).toContain('Add task')
    expect(html).toContain('<svg') // lucide icon
    expect(html).toContain('<button')
  })

  it('omits the button when no action is given', () => {
    const html = renderToStaticMarkup(<EmptyState icon={Inbox} title="No tasks today" />)
    expect(html).toContain('No tasks today')
    expect(html).not.toContain('<button')
  })

  it('fires the action onClick when the button is activated', () => {
    const onClick = vi.fn()
    const element = EmptyState({ icon: Inbox, title: 'Empty', action: { label: 'Go', onClick } })
    const button = findClickable(element)
    expect(button).not.toBeNull()
    button?.props.onClick?.()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Skeleton', () => {
  it('is hidden from assistive tech and carries the shimmer + custom classes', () => {
    const html = renderToStaticMarkup(<Skeleton className="h-4 w-10" />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('od-skeleton')
    expect(html).toContain('h-4')
  })
})

describe('TaskListSkeleton', () => {
  it('renders N task-shaped rows inside an aria-hidden wrapper', () => {
    const html = renderToStaticMarkup(<TaskListSkeleton rows={5} />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('data-rows="5"')
    expect(html.match(/h-\[42px\]/g) ?? []).toHaveLength(5)
  })

  it('defaults to 8 rows', () => {
    const html = renderToStaticMarkup(<TaskListSkeleton />)
    expect(html).toContain('data-rows="8"')
    expect(html.match(/h-\[42px\]/g) ?? []).toHaveLength(8)
  })
})

describe('ODErrorBoundary', () => {
  it('renders its children when there is no error', () => {
    const html = renderToStaticMarkup(
      <ODErrorBoundary label="Today">
        <p>healthy content</p>
      </ODErrorBoundary>,
    )
    expect(html).toContain('healthy content')
    expect(html).not.toContain('role="alert"')
  })

  it('derives error state from a thrown error', () => {
    expect(ODErrorBoundary.getDerivedStateFromError(new Error('boom'))).toEqual({
      error: new Error('boom'),
    })
  })

  it('renders the fallback card with the label and the error message', () => {
    const boundary = new ODErrorBoundary({ label: 'Today', children: null })
    boundary.state = ODErrorBoundary.getDerivedStateFromError(new Error('kaboom'))
    const html = renderToStaticMarkup(boundary.render() as ReactElement)
    expect(html).toContain('role="alert"')
    // renderToStaticMarkup HTML-encodes the apostrophe in "couldn't".
    expect(html).toMatch(/Today couldn(?:&#x27;|&#39;|')t load/)
    expect(html).toContain('kaboom')
    expect(html).toContain('Try again')
  })

  it('reset() clears the error so children re-render, and Retry is wired to it', () => {
    const boundary = new ODErrorBoundary({ label: 'Today', children: null })
    const setState = vi.fn()
    boundary.setState = setState
    boundary.reset()
    expect(setState).toHaveBeenCalledWith({ error: null })

    boundary.state = { error: new Error('x') }
    const retry = findClickable(boundary.render())
    expect(retry?.props.onClick).toBe(boundary.reset)
  })
})
