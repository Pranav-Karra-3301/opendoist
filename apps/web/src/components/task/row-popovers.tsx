/**
 * Row action popovers (Task F). Mounted once per task row by the task list; only the row
 * whose id matches the ui-store `activeRowPopover` renders an open, anchored popover. The
 * matching panel (schedule / priority / move / labels / more) is wired to the task
 * mutations here so the presentational panels stay reusable by the detail dialog and
 * multi-select toolbar. FROZEN export (Task A): `RowPopovers({ taskId })`.
 */
import { type ReactElement, useEffect, useRef } from 'react'
import { useActiveTasks, useTaskMutations } from '@/api/hooks/tasks'
import { Popover, PopoverContent } from '@/components/ui/popover'
import type { RowPopoverKind } from '@/stores/ui'
import { useUiStore } from '@/stores/ui'
import { LabelPanel } from './label-popover'
import { MoreMenuItems } from './more-menu'
import { MovePanel } from './move-popover'
import { PriorityMenu } from './priority-menu'
import { SchedulerPanel } from './scheduler-popover'

/**
 * Menu-semantics surfaces follow the §2.9 Dropdown/menu law row — `shadow-menu` plus a 1px
 * `rgba(0,0,0,.1)` border (dark: `border`) — overriding PopoverContent's default popover
 * shadow, which §2.7 reserves for the popover/scheduler surface.
 */
const MENU_CHROME = 'border border-black/10 dark:border-border [box-shadow:var(--shadow-menu)]'

/** Width + padding + chrome overrides on the shared PopoverContent, per surface. */
const POPOVER_CLASS: Record<RowPopoverKind, string> = {
  schedule: 'w-[280px] p-2',
  priority: `w-56 p-1 ${MENU_CHROME}`,
  move: `w-72 p-1 ${MENU_CHROME}`,
  labels: `w-64 p-1 ${MENU_CHROME}`,
  more: `w-56 p-1 ${MENU_CHROME}`,
}

/**
 * Accessible name for each popover surface. Base UI's Popover.Popup renders `role="dialog"`
 * and only labels itself from a `Popover.Title`, which these bare panels don't render — so a
 * dialog with no accessible name would fail axe. An explicit `aria-label` names each one.
 */
const POPOVER_LABEL: Record<RowPopoverKind, string> = {
  schedule: 'Schedule task',
  priority: 'Set priority',
  move: 'Move to project',
  labels: 'Edit labels',
  more: 'More actions',
}

function OpenRowPopover({ taskId, kind }: { taskId: string; kind: RowPopoverKind }): ReactElement {
  const closeRowPopover = useUiStore((state) => state.closeRowPopover)
  const { data: tasks } = useActiveTasks()
  const { update, move } = useTaskMutations()
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const task = tasks?.find((candidate) => candidate.id === taskId) ?? null

  // The task disappeared (completed/deleted elsewhere) while its popover was open.
  useEffect(() => {
    if (tasks !== undefined && task === null) closeRowPopover()
  }, [tasks, task, closeRowPopover])

  let content: ReactElement | null = null
  if (task !== null) {
    switch (kind) {
      case 'schedule':
        content = (
          <SchedulerPanel
            // Seeds the calendar highlight AND supplies the wall-clock time a calendar-day
            // pick preserves (plan Task E: "picking a day preserves an existing time from the
            // current due") — without it a day pick silently drops the task's due time.
            current={task.due}
            onPick={(due) => {
              update.mutate({ id: task.id, patch: { due } })
              closeRowPopover()
            }}
          />
        )
        break
      case 'priority':
        content = (
          <PriorityMenu
            value={task.priority}
            onPick={(priority) => {
              update.mutate({ id: task.id, patch: { priority } })
              closeRowPopover()
            }}
          />
        )
        break
      case 'move':
        content = (
          <MovePanel
            value={{ projectId: task.project_id, sectionId: task.section_id }}
            onPick={(to) => {
              move.mutate({ id: task.id, to })
              closeRowPopover()
            }}
          />
        )
        break
      case 'labels':
        content = (
          <LabelPanel
            value={task.labels}
            onChange={(labels) => update.mutate({ id: task.id, patch: { labels } })}
          />
        )
        break
      case 'more':
        content = <MoreMenuItems task={task} onClose={closeRowPopover} />
        break
    }
  }

  return (
    <>
      <span ref={anchorRef} aria-hidden="true" className="pointer-events-none block h-0 w-0" />
      {content !== null && (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) closeRowPopover()
          }}
        >
          <PopoverContent
            anchor={anchorRef}
            side="bottom"
            align="end"
            aria-label={POPOVER_LABEL[kind]}
            className={POPOVER_CLASS[kind]}
          >
            {content}
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}

export function RowPopovers({ taskId }: { taskId: string }): ReactElement | null {
  const active = useUiStore((state) => state.activeRowPopover)
  if (active === null || active.taskId !== taskId) return null
  return <OpenRowPopover taskId={taskId} kind={active.kind} />
}
