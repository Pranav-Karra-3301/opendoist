/**
 * Shared chrome for the two unauthenticated screens (login, register): the brand
 * mark, the 32px page heading, the raised card, and a labelled-field helper the
 * forms reuse. Task C — consumes only design tokens (no hex literals).
 */
import type { ReactNode } from 'react'

/**
 * OpenTask brand glyph (Glyphy "List", CC BY 3.0 — see assets/brand/ATTRIBUTION.md),
 * inlined as `currentColor` paths so it needs no served asset and inherits the active
 * theme accent. `apps/web` serves no `/assets` brand file yet, so this embedded mark is
 * the "brand icon present" branch of the Task C spec.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="currentColor"
      role="img"
      aria-label="OpenTask"
      className={className}
    >
      <path d="m18.75 29.688h-9.375c-0.86328 0-1.5625-0.69922-1.5625-1.5625v-14.062c0-3.4492 2.8008-6.25 6.25-6.25s6.25 2.8008 6.25 6.25v14.062c0 0.86328-0.69922 1.5625-1.5625 1.5625z" />
      <path d="m39.062 85.938v-4.6875c0-0.86328 0.69922-1.5625 1.5625-1.5625h50c0.86328 0 1.5625 0.69922 1.5625 1.5625v4.6875c0 3.4531-2.7969 6.25-6.25 6.25h-49.281c1.4922-1.6602 2.4062-3.8477 2.4062-6.25z" />
      <path d="m79.688 7.8125h-58.656c1.4922 1.6602 2.4062 3.8477 2.4062 6.25v71.875c0 3.6562 3.1367 6.5781 6.8633 6.2188 3.25-0.30859 5.6367-3.2266 5.6367-6.4883v-7.543c0-0.86328 0.69922-1.5625 1.5625-1.5625h48.438v-62.5c0-3.4531-2.7969-6.25-6.25-6.25zm-31.652 48.762-5.5234 5.5234c-0.58594 0.58594-1.3828 0.91406-2.2109 0.91406s-1.625-0.32812-2.2109-0.91406l-3.3125-3.3164c-1.2188-1.2188-1.2188-3.1992 0-4.4219 1.2188-1.2188 3.1992-1.2188 4.418 0l1.1055 1.1055 3.3125-3.3125c1.2188-1.2188 3.1992-1.2188 4.418 0s1.2188 3.1992 0 4.4219zm0-15.625-5.5234 5.5234c-0.58594 0.58594-1.3828 0.91406-2.2109 0.91406s-1.625-0.32812-2.2109-0.91406l-3.3125-3.3164c-1.2188-1.2188-1.2188-3.1992 0-4.4219 1.2188-1.2188 3.1992-1.2188 4.418 0l1.1055 1.1055 3.3125-3.3125c1.2188-1.2188 3.1992-1.2188 4.418 0s1.2188 3.1992 0 4.4219zm0-15.625-5.5234 5.5234c-0.58594 0.58594-1.3828 0.91406-2.2109 0.91406s-1.625-0.32812-2.2109-0.91406l-3.3125-3.3164c-1.2188-1.2188-1.2188-3.1992 0-4.4219 1.2188-1.2188 3.1992-1.2188 4.418 0l1.1055 1.1055 3.3125-3.3125c1.2188-1.2188 3.1992-1.2188 4.418 0s1.2188 3.1992 0 4.4219zm25.402 35.613h-17.188c-1.7266 0-3.125-1.3984-3.125-3.125s1.3984-3.125 3.125-3.125h17.188c1.7266 0 3.125 1.3984 3.125 3.125s-1.3984 3.125-3.125 3.125zm0-15.625h-17.188c-1.7266 0-3.125-1.3984-3.125-3.125s1.3984-3.125 3.125-3.125h17.188c1.7266 0 3.125 1.3984 3.125 3.125s-1.3984 3.125-3.125 3.125zm0-15.625h-17.188c-1.7266 0-3.125-1.3984-3.125-3.125s1.3984-3.125 3.125-3.125h17.188c1.7266 0 3.125 1.3984 3.125 3.125s-1.3984 3.125-3.125 3.125z" />
    </svg>
  )
}

export interface AuthShellProps {
  title: string
  subtitle?: string
  children: ReactNode
  /** Rendered below the card (e.g. the login/register switch link). */
  footer?: ReactNode
}

/** Centered, single-column auth card: brand mark + 32px heading + form slot. */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12 font-sans text-text-primary antialiased">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col gap-6 rounded-lg border border-border bg-surface-raised p-8 [box-shadow:var(--shadow-menu)]">
          <div className="flex flex-col items-center gap-4 text-center">
            <BrandMark className="size-11 text-accent" />
            <div className="flex flex-col gap-1.5">
              <h1 className="font-strong text-header-xl text-text-primary">{title}</h1>
              {subtitle !== undefined && (
                <p className="text-copy text-text-secondary">{subtitle}</p>
              )}
            </div>
          </div>
          {children}
        </div>
        {footer !== undefined && (
          <p className="mt-6 text-center text-copy text-text-secondary">{footer}</p>
        )}
      </div>
    </main>
  )
}

export interface AuthFieldProps {
  id: string
  label: string
  children: ReactNode
}

/** Labelled form field: a `<label htmlFor>` bound to the control's `id` for a11y. */
export function AuthField({ id, label, children }: AuthFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-copy text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  )
}
