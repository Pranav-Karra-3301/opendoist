/**
 * Code-based route tree (no codegen file to race on). FROZEN by Task A.
 *
 * /login, /register        — auth pages (no guard)
 * (app layout, pathless)   — session guard → /login; search: ?task=<id> opens task detail
 *   /            → redirect /today
 *   /inbox /today /upcoming /project/$projectId /label/$labelName
 *   /task/$taskId — CANONICAL task deep link (phase 6 notifications + phase 8 CLI build
 *                   `${origin}/task/<id>`) → redirects to /today?task=<id>
 * /dev/tokens              — design-token showcase (kept from phase 1)
 */
import { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { z } from 'zod'
import { AppLayout } from '@/app/layout'
import { authClient } from '@/auth/client'
import { LoginPage } from '@/auth/login-page'
import { RegisterPage } from '@/auth/register-page'
import { TokenShowcase } from '@/dev/token-showcase'
import { InboxView } from '@/views/inbox'
import { LabelView } from '@/views/label'
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

/** Pathless layout route carrying the session guard and the ?task search param. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    if (!data?.session) throw redirect({ to: '/login' })
  },
  validateSearch: z.object({ task: z.string().optional() }),
  component: AppLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/today' })
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
  path: '/label/$labelName',
  component: LabelView,
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
