/**
 * Code-based route tree (no codegen file to race on). FROZEN by Task A (phase 5 revision).
 *
 * /login, /register        — auth pages (no guard)
 * (app layout, pathless)   — session guard → /login; search: ?task=<id> opens task detail
 *   /            → redirect /today
 *   /inbox /today /upcoming /project/$projectId
 *   /label/$labelId — ID-keyed (phase 5 Task A REPLACED phase 4's /label/$labelName;
 *                     viewKey('label', id) prefs require the id) → LabelViewPage (Task G)
 *   /filters-labels /filter/$filterId /reporting — phase-5 feature pages (lazy stubs
 *                     until Tasks D/G/K replace them)
 *   /settings → /settings/account; /settings/$page → SettingsLayout (Task L)
 *   /task/$taskId — CANONICAL task deep link (phase 6 notifications + phase 8 CLI build
 *                   `${origin}/task/<id>`) → redirects to /today?task=<id>
 * /dev/tokens              — design-token showcase (kept from phase 1)
 */
import { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { z } from 'zod'
import { api, endpoints } from '@/api/client'
import { getDesktopSession } from '@/api/desktop-session'
import { qk } from '@/api/keys'
import { UserSettingsSchema } from '@/api/schemas'
import { isTauri } from '@/api/transport'
import { AppLayout } from '@/app/layout'
import { authClient } from '@/auth/client'
import { LoginPage } from '@/auth/login-page'
import { RegisterPage } from '@/auth/register-page'
import { requireSessionOrOffline } from '@/auth/session-guard'
import { TaskListSkeleton } from '@/components/feedback'
import { TokenShowcase } from '@/dev/token-showcase'
import { homeViewToTarget } from '@/lib/home-view'
import { InboxView } from '@/views/inbox'
import { ProjectView } from '@/views/project'
import { TodayView } from '@/views/today'
import { UpcomingView } from '@/views/upcoming'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
})

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
})

/** Pathless layout route carrying the session guard and the ?task search param.
 *  The guard is offline-aware (session-guard.ts): a network-failure from the session
 *  probe renders the cached shell instead of the router error screen or /login. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async () => {
    // Desktop (Tauri): the paired instance + ot_ bearer IS the session — the cookie-based
    // better-auth probe would hit the tauri:// origin (no server there), read "no session",
    // and strand the app on /login. Web builds never enter this branch (isTauri() false).
    if (isTauri() && (await getDesktopSession()) !== null) return
    await requireSessionOrOffline(() => authClient.getSession())
  },
  validateSearch: z.object({ task: z.string().optional() }),
  component: AppLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    // Honour the user's Home view (Settings > General). ensureQueryData shares the
    // ['user-settings'] cache with useUserSettings; on failure we fall through to Today.
    let homeView: string | undefined
    try {
      const settings = await context.queryClient.ensureQueryData({
        queryKey: qk.userSettings,
        queryFn: () => api(endpoints.userSettings, { schema: UserSettingsSchema }),
      })
      homeView = settings.homeView
    } catch {
      // settings unavailable — default to Today below
    }
    const target = homeViewToTarget(homeView)
    switch (target.to) {
      case '/project/$projectId':
        throw redirect({ to: target.to, params: target.params })
      case '/label/$labelId':
        throw redirect({ to: target.to, params: target.params })
      case '/filter/$filterId':
        throw redirect({ to: target.to, params: target.params })
      default:
        throw redirect({ to: target.to })
    }
  },
})

const inboxRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/inbox',
  component: InboxView,
})

const todayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/today',
  component: TodayView,
})

const upcomingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/upcoming',
  component: UpcomingView,
})

const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/project/$projectId',
  component: ProjectView,
})

const labelRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/label/$labelId',
  component: lazyRouteComponent(() => import('@/features/filter-view/LabelViewPage')),
})

const filtersLabelsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/filters-labels',
  component: lazyRouteComponent(() => import('@/features/filters-labels/FiltersLabelsPage')),
})

const filterViewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/filter/$filterId',
  component: lazyRouteComponent(() => import('@/features/filter-view/FilterViewPage')),
})

const reportingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reporting',
  // Route-level code split (perf, Task I): Reporting/Productivity is off the hot path; its chunk
  // loads lazily behind a skeleton so the initial bundle stays small.
  component: lazyRouteComponent(() => import('@/features/reporting/ReportingPage')),
  pendingComponent: () => <TaskListSkeleton rows={4} />,
})

const settingsIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  beforeLoad: () => {
    throw redirect({ to: '/settings/$page', params: { page: 'account' } })
  },
})

const settingsPageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/$page',
  // Route-level code split (perf, Task I): the whole Settings surface — including the heavy
  // Todoist importer, which SettingsLayout further React.lazy-loads per page — lives in its own
  // chunk, kept off the initial bundle behind a skeleton fallback.
  component: lazyRouteComponent(() => import('@/features/settings/SettingsLayout')),
  pendingComponent: () => <TaskListSkeleton rows={4} />,
})

/** Canonical deep link: open the app with the task-detail dialog on Today. */
const taskRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/task/$taskId',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/today', search: { task: params.taskId } })
  },
})

const devTokensRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/tokens',
  component: TokenShowcase,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  appRoute.addChildren([
    indexRoute,
    inboxRoute,
    todayRoute,
    upcomingRoute,
    projectRoute,
    labelRoute,
    filtersLabelsRoute,
    filterViewRoute,
    reportingRoute,
    settingsIndexRoute,
    settingsPageRoute,
    taskRoute,
  ]),
  devTokensRoute,
])

export const router = createRouter({
  routeTree,
  context: { queryClient },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
