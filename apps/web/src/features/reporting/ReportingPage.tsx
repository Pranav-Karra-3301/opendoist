/**
 * Reporting view (route `/reporting`) — Activity feed + Completed tasks, sharing one
 * filter row (project + date range; event types on the Activity tab only). Filter state
 * lives here and is projected into the per-tab query params.
 */
import { dateInTz } from '@opendoist/core'
import { useMemo, useState } from 'react'
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
import { ReportingFilters } from './ReportingFilters'

type ReportingTab = 'activity' | 'completed'

export default function ReportingPage() {
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
        </TabsList>
        <ReportingFilters state={filters} onChange={setFilters} showTypes={tab === 'activity'} />
        <TabsContent value="activity">
          <ActivityFeed params={activityParams} />
        </TabsContent>
        <TabsContent value="completed">
          <CompletedFeed params={scope} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
