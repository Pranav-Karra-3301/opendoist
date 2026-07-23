/**
 * Reporting view (route `/reporting`) — Activity feed + Completed tasks, sharing one
 * filter row (project + date range; event types on the Activity tab only). Filter state
 * lives here and is projected into the per-tab query params.
 */
import { dateInTz } from '@opentask/core'
import { useMemo, useState } from 'react'
import { ODErrorBoundary } from '@/components/feedback'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ViewHeader } from '@/components/view-header'
import { useUserSettings } from '@/features/settings/useSettings'
import { ActivityFeed } from './ActivityFeed'
import {
  buildReportingScope,
  DEFAULT_REPORTING_FILTERS,
  type ReportingFilterState,
} from './activity-presentation'
import { CompletedFeed } from './CompletedFeed'
import { GoalCharts } from './GoalCharts'
import { ReportingFilters } from './ReportingFilters'

type ReportingTab = 'activity' | 'completed' | 'goals'

export default function ReportingPage() {
  return (
    <ODErrorBoundary label="Reporting">
      <ReportingPageInner />
    </ODErrorBoundary>
  )
}

function ReportingPageInner() {
  const { settings } = useUserSettings()
  const [tab, setTab] = useState<ReportingTab>('activity')
  const [filters, setFilters] = useState<ReportingFilterState>(DEFAULT_REPORTING_FILTERS)

  const todayIso = dateInTz(new Date().toISOString(), settings.timezone)
  const scope = useMemo(() => buildReportingScope(filters, todayIso), [filters, todayIso])
  const activityParams = useMemo(
    () => ({ ...scope, types: filters.types.length > 0 ? filters.types.join(',') : undefined }),
    [scope, filters.types],
  )

  return (
    <div className="mx-auto max-w-[var(--content-max)] px-6 pb-24">
      <ViewHeader title="Reporting" />
      <Tabs value={tab} onValueChange={(value: string) => setTab(value as ReportingTab)}>
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
        </TabsList>
        {/* Goals reads its own date window from the productivity API — the project/date filters
            don't apply, so they're hidden there (activity/completed keep the shared row). */}
        {tab !== 'goals' && (
          <ReportingFilters state={filters} onChange={setFilters} showTypes={tab === 'activity'} />
        )}
        <TabsContent value="activity">
          <ActivityFeed params={activityParams} />
        </TabsContent>
        <TabsContent value="completed">
          <CompletedFeed params={scope} />
        </TabsContent>
        <TabsContent value="goals">
          <GoalCharts />
        </TabsContent>
      </Tabs>
    </div>
  )
}
