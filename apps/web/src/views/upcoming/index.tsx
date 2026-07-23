/**
 * Upcoming: a sticky week strip over an infinite-scrolling list of day sections, plus
 * the overdue block on top. Drag-and-drop is driven by a single DndContext — dropping a
 * task within its own day reorders (`day_order`, silent, no undo); dropping onto another
 * day (a row or the day's empty space) reschedules it to that date (undo wired by the
 * mutation layer). Every day derives its slice client-side from the one `useActiveTasks`
 * cache via `lib/derive`; no view-specific query. The scroll sentinel extends the range.
 */

import { viewKey } from '@opentask/core'
import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTaskMutations } from '@/api/hooks/tasks'
import { ODErrorBoundary, TaskListSkeleton } from '@/components/feedback'
import { TaskRow } from '@/components/task/task-row'
import { BoardView, upcomingBoardColumns } from '@/features/board/BoardView'
import { CompletedSection } from '@/features/display/CompletedSection'
import DisplayMenu, { useFilterContext } from '@/features/display/DisplayMenu'
import { pipelineDeviates, pipelineSortFilter } from '@/features/display/pipeline'
import { useViewPrefs } from '@/features/display/useViewPrefs'
import {
  arrayMove,
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useAppSensors,
} from '@/lib/dnd'
import { playCue } from '@/lib/sound'
import { OverdueBlock } from '@/views/today/overdue-block'
import { DaySection } from './day-section'
import { useUpcomingDays, useUpcomingStore } from './use-upcoming-days'
import { WeekStrip } from './week-strip'

const UPCOMING_KEY = viewKey('upcoming')

export function UpcomingView() {
  const {
    today,
    anchor,
    weekStart,
    days,
    tasksByDay,
    overdueTasks,
    datesWithTasks,
    dated,
    isLoading,
    gotoWeek,
    gotoToday,
    setAnchor,
    extend,
  } = useUpcomingDays()
  const { update } = useTaskMutations()
  const sensors = useAppSensors()
  const { prefs } = useViewPrefs(UPCOMING_KEY)
  const filterCtx = useFilterContext()
  // Days ARE the grouping in Upcoming, so the Display menu applies filter+sort WITHIN each day
  // (dossier §1.8) and disables per-day drag while active; the Overdue block stays untouched.
  const deviates = pipelineDeviates(prefs)

  const [activeId, setActiveId] = useState<string | null>(null)
  const activeTask = activeId === null ? undefined : dated.find((t) => t.id === activeId)

  const stripRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [stripH, setStripH] = useState(0)

  // Measure the sticky strip so day headings can pin just beneath it (--ot-strip-h).
  useEffect(() => {
    const el = stripRef.current
    if (el === null) return
    const measure = () => setStripH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Scroll the target day under the strip on explicit navigation (week cell, pager,
  // Today). Deferred a frame so a just-extended range has rendered the section; today is
  // always mounted, so pressing Today re-centres it even when the anchor is unchanged.
  function scrollToDay(date: string) {
    requestAnimationFrame(() => {
      const el = document.getElementById(`day-${date}`)
      if (el === null) return
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    })
  }
  function selectDay(date: string) {
    setAnchor(date)
    scrollToDay(useUpcomingStore.getState().anchor)
  }
  function pageWeek(dir: 1 | -1) {
    gotoWeek(dir)
    scrollToDay(useUpcomingStore.getState().anchor)
  }
  function jumpToday() {
    gotoToday()
    scrollToDay(today)
  }

  // Infinite scroll: extend the rendered range as the bottom sentinel nears view.
  useEffect(() => {
    const el = sentinelRef.current
    if (el === null) return
    const root = el.closest('main')
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) extend()
      },
      { root, rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [extend])

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }
  function onDragCancel() {
    setActiveId(null)
  }
  function onDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const draggedId = String(event.active.id)
    const overId = event.over === null ? '' : String(event.over.id)
    if (overId === '' || overId === draggedId) return

    const dragged = dated.find((t) => t.id === draggedId)
    if (dragged === undefined || dragged.due === null) return
    const sourceDue = dragged.due

    const overIsDay = overId.startsWith('day-')
    let targetDate: string | null = null
    if (overIsDay) {
      targetDate = overId.slice(4)
    } else {
      const overTask = dated.find((t) => t.id === overId)
      if (overTask !== undefined && overTask.due !== null) targetDate = overTask.due.date
    }
    if (targetDate === null) return

    if (targetDate === sourceDue.date) {
      // Same-day reorder → sequential silent day_order writes for shifted rows.
      const list = tasksByDay.get(targetDate) ?? []
      const oldIndex = list.findIndex((t) => t.id === draggedId)
      const newIndex = overIsDay ? list.length - 1 : list.findIndex((t) => t.id === overId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      playCue('droplet')
      const reordered = arrayMove(list, oldIndex, newIndex)
      reordered.forEach((t, i) => {
        if (t.day_order !== i) update.mutate({ id: t.id, patch: { day_order: i }, silent: true })
      })
    } else {
      // Cross-day → reschedule to the drop date, preserving time/recurrence.
      playCue('droplet')
      update.mutate({
        id: draggedId,
        patch: { due: { ...sourceDue, date: targetDate, string: targetDate } },
      })
    }
  }

  if (prefs.layout === 'board') {
    return (
      <ODErrorBoundary label="Upcoming">
        <div className="flex h-full flex-col px-6">
          <WeekStrip
            today={today}
            anchor={anchor}
            weekStart={weekStart}
            datesWithTasks={datesWithTasks}
            onSelectDay={selectDay}
            onPrevWeek={() => pageWeek(-1)}
            onNextWeek={() => pageWeek(1)}
            onToday={jumpToday}
            actions={<DisplayMenu viewKey={UPCOMING_KEY} />}
          />
          {isLoading ? (
            <div aria-busy="true" className="pt-4">
              <TaskListSkeleton rows={8} />
            </div>
          ) : (
            <BoardView
              columns={upcomingBoardColumns(days, tasksByDay, today)}
              label="Upcoming"
              completed={prefs.showCompleted ? {} : undefined}
            />
          )}
        </div>
      </ODErrorBoundary>
    )
  }

  return (
    <ODErrorBoundary label="Upcoming">
      <div
        className="mx-auto max-w-[var(--content-max)] px-6 pb-24"
        style={{ '--ot-strip-h': `${stripH}px` } as CSSProperties}
      >
        <div ref={stripRef} className="sticky top-0 z-[var(--z-sticky)] bg-bg">
          <WeekStrip
            today={today}
            anchor={anchor}
            weekStart={weekStart}
            datesWithTasks={datesWithTasks}
            onSelectDay={selectDay}
            onPrevWeek={() => pageWeek(-1)}
            onNextWeek={() => pageWeek(1)}
            onToday={jumpToday}
            actions={<DisplayMenu viewKey={UPCOMING_KEY} />}
          />
        </div>

        {isLoading ? (
          <div aria-busy="true" className="pt-4">
            <TaskListSkeleton rows={8} />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <OverdueBlock tasks={overdueTasks} />
            {days.map((date) => {
              const dayTasks = tasksByDay.get(date) ?? []
              const shown = deviates
                ? pipelineSortFilter(dayTasks, prefs, filterCtx, filterCtx.projects)
                : dayTasks
              return (
                <DaySection
                  key={date}
                  date={date}
                  tasks={shown}
                  today={today}
                  sortable={!deviates}
                />
              )
            })}
            <div ref={sentinelRef} aria-hidden className="h-px" />
            <DragOverlay>
              {activeTask ? (
                <div className="rounded-sm bg-bg shadow-drag">
                  <TaskRow task={activeTask} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
        {prefs.showCompleted && <CompletedSection />}
      </div>
    </ODErrorBoundary>
  )
}
