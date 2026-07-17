import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export interface ODErrorBoundaryProps {
  /** surface name shown in the fallback, e.g. 'Today' */
  label: string
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Per-view error boundary: on a render error it shows a fallback card (10px radius,
 * `role="alert"`) with the surface label, the error message, and a "Try again" button
 * that resets the boundary so its children re-render.
 */
export class ODErrorBoundary extends Component<ODErrorBoundaryProps, State> {
  override state: State = { error: null }
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  reset = () => this.setState({ error: null })
  override render() {
    const { error } = this.state
    if (error) {
      return (
        <div
          role="alert"
          className="mx-auto flex max-w-[420px] flex-col items-center gap-1 rounded-lg border border-border bg-surface-raised p-6 text-center"
        >
          <p className="font-medium text-subtitle text-text-primary">
            {this.props.label} couldn't load
          </p>
          <p className="text-copy text-text-secondary">{error.message}</p>
          <Button variant="secondary" className="mt-3" onClick={this.reset}>
            Try again
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
