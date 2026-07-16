/**
 * Settings shell (Task L). The `/settings/$page` route renders this Todoist-style centered
 * overlay dialog over the current view: a 200px left nav (SettingsSearch — search box + registry
 * list) beside a scrollable pane that lazy-loads the active registry page under `<Suspense>`.
 * Closing (built-in X / Esc / backdrop) navigates back to the user's home view; an unknown
 * `:page` param canonicalises to Account. Below `md` the nav is the first screen and picking a
 * page slides to it with a Back button.
 *
 * The route tree (frozen by Task A) mounts this inside AppLayout's `<Outlet>`; the Base UI Dialog
 * portals to the body, so the overlay covers the whole app while the sidebar/topbar dim behind it.
 */
import { Navigate, useNavigate, useParams } from '@tanstack/react-router'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { Suspense, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { SETTINGS_PAGES } from './registry'
import { SettingsSearch } from './SettingsSearch'
import { useUserSettings } from './useSettings'

function PaneSpinner() {
  return (
    <div className="flex items-center justify-center py-16 text-text-tertiary">
      <Loader2 size={20} className="animate-spin" aria-label="Loading" />
    </div>
  )
}

export default function SettingsLayout() {
  const params = useParams({ strict: false })
  const navigate = useNavigate()
  const { settings } = useUserSettings()
  // Below `md`, false = the nav list is the visible screen, true = the page pane is.
  const [mobilePane, setMobilePane] = useState(false)

  const active = SETTINGS_PAGES.find((page) => page.key === params.page)

  // Unknown / missing `:page` → canonicalise to Account (all hooks already ran above).
  if (!active) {
    return <Navigate to="/settings/$page" params={{ page: 'account' }} replace />
  }

  const goToPage = (key: string) => {
    setMobilePane(true)
    void navigate({ to: '/settings/$page', params: { page: key }, replace: true })
  }

  // Close → navigate back to the underlying view. Phase 4 has no router "background location"
  // pattern (its overlays are `?search`-param based; settings is a real route), so per the plan
  // this falls back to the mapped `settings.homeView` route.
  const closeToHome = () => {
    const home = settings.homeView
    if (home.startsWith('project:')) {
      void navigate({
        to: '/project/$projectId',
        params: { projectId: home.slice('project:'.length) },
      })
    } else if (home.startsWith('label:')) {
      void navigate({ to: '/label/$labelId', params: { labelId: home.slice('label:'.length) } })
    } else if (home.startsWith('filter:')) {
      void navigate({ to: '/filter/$filterId', params: { filterId: home.slice('filter:'.length) } })
    } else if (home === 'inbox') {
      void navigate({ to: '/inbox' })
    } else if (home === 'upcoming') {
      void navigate({ to: '/upcoming' })
    } else if (home === 'filters-labels') {
      void navigate({ to: '/filters-labels' })
    } else {
      void navigate({ to: '/today' })
    }
  }

  const ActivePage = active.Component

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) closeToHome()
      }}
    >
      <DialogContent className="grid h-[min(720px,90vh)] w-[min(960px,94vw)] max-w-[min(960px,94vw)] grid-cols-1 grid-rows-1 gap-0 overflow-hidden p-0 md:grid-cols-[200px_1fr]">
        <DialogTitle className="sr-only">Settings</DialogTitle>

        {/* Left nav — the first screen on mobile; hidden once a page is open there. */}
        <div
          className={cn(
            'flex min-h-0 flex-col bg-surface md:border-border md:border-r',
            mobilePane && 'hidden md:flex',
          )}
        >
          <div className="flex h-[52px] shrink-0 items-center border-border border-b px-4">
            <h2 className="font-medium text-header text-text-primary">Settings</h2>
          </div>
          <SettingsSearch pages={SETTINGS_PAGES} activeKey={active.key} onPick={goToPage} />
        </div>

        {/* Right pane — the active page under Suspense; hidden while the nav is showing on mobile. */}
        <div
          className={cn('flex min-h-0 flex-col bg-surface-raised', !mobilePane && 'hidden md:flex')}
        >
          <header className="flex h-[52px] shrink-0 items-center gap-1 border-border border-b px-4 md:px-6">
            <button
              type="button"
              onClick={() => setMobilePane(false)}
              aria-label="Back to settings menu"
              className="-ml-1 grid size-7 shrink-0 place-items-center rounded-sm text-text-secondary outline-none transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring md:hidden"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <h2 className="min-w-0 truncate font-medium text-header text-text-primary">
              {active.title}
            </h2>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
            <Suspense fallback={<PaneSpinner />}>
              <ActivePage />
            </Suspense>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
