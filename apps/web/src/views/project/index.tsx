/**
 * Project view: inline-editable name + color dot with Add-section / more-menu actions, then
 * the no-section (root) task list followed by each section by `section_order`. Tasks come from
 * the single `useActiveTasks()` cache, sliced client-side; drag-and-drop reorders within a
 * container and moves across sections (see `use-project-dnd`).
 */
import { viewKey } from '@opendoist/core'
import { useParams } from '@tanstack/react-router'
import { Archive, Ellipsis, Hash, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useProjectMutations, useProjects } from '@/api/hooks/projects'
import { useSections } from '@/api/hooks/sections'
import { useActiveTasks } from '@/api/hooks/tasks'
import type { Task } from '@/api/schemas'
import { EmptyState, ODErrorBoundary } from '@/components/feedback'
import { TaskList } from '@/components/task/task-list'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useDialogStore } from '@/features/dialogs/store'
import { CompletedSection } from '@/features/display/CompletedSection'
import DisplayMenu, { GroupedTaskList, useFilterContext } from '@/features/display/DisplayMenu'
import { pipelineDeviates, pipelineGroups } from '@/features/display/pipeline'
import { useViewPrefs } from '@/features/display/useViewPrefs'
import { activeTasks, subtreeOf, tasksInProject } from '@/lib/derive'
import { closestCenter, DndContext, useDroppable } from '@/lib/dnd'
import { cn } from '@/lib/utils'
import { AddSection } from './add-section'
import { AddTaskRow, EditableText, SectionBlock } from './section-block'
import { ROOT_DROP_ID, useProjectDnd, useProjectViewStore } from './use-project-dnd'

const CONTENT = 'mx-auto max-w-[var(--content-max)] px-6 pb-24'

/** Normalize a server palette id (`berry_red`) to its CSS var (`--od-palette-berry-red`). */
function paletteVar(color: string): string {
  return `var(--od-palette-${color.replace(/_/g, '-')}, var(--od-palette-charcoal))`
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-full"
      style={{ backgroundColor: paletteVar(color) }}
    />
  )
}

function DroppableRegion({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id })
  return <div ref={setNodeRef}>{children}</div>
}

/** Tasks matching `rootFilter` plus every descendant, so a `tree` TaskList nests them fully. */
function containerTasks(active: Task[], rootFilter: (t: Task) => boolean): Task[] {
  const roots = active.filter(rootFilter)
  const out: Task[] = [...roots]
  for (const root of roots) out.push(...subtreeOf(active, root.id))
  return out
}

function ProjectShell({ children }: { children: ReactNode }) {
  return (
    <div className={CONTENT}>
      <p className="pt-16 text-center text-copy text-text-tertiary italic">{children}</p>
    </div>
  )
}

function ProjectLoading() {
  return (
    <div className={CONTENT} aria-busy="true">
      <div className="flex items-center gap-2 pt-8 pb-4">
        <Skeleton className="size-3 rounded-full" />
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-[42px] w-full" />
        <Skeleton className="h-[42px] w-full" />
        <Skeleton className="h-[42px] w-full" />
      </div>
    </div>
  )
}

export function ProjectView() {
  return (
    <ODErrorBoundary label="Project">
      <ProjectViewInner />
    </ODErrorBoundary>
  )
}

function ProjectViewInner() {
  const { projectId } = useParams({ strict: false })
  const projectsQ = useProjects()
  const sectionsQ = useSections()
  const tasksQ = useActiveTasks()
  const { update: updateProject } = useProjectMutations()
  const openDialog = useDialogStore((s) => s.openDialog)
  const startAddSection = useProjectViewStore((s) => s.startAddSection)
  const [titleEditing, setTitleEditing] = useState(false)
  const dnd = useProjectDnd(projectId ?? '')
  // Display prefs are keyed by project id; hooks must run before the early returns below.
  const displayKey = viewKey('project', projectId ?? '')
  const { prefs } = useViewPrefs(displayKey)
  const filterCtx = useFilterContext()

  if (projectId === undefined) return <ProjectShell>Project not found</ProjectShell>
  const allProjects = projectsQ.data
  const allSections = sectionsQ.data
  const allTasks = tasksQ.data
  if (allProjects === undefined || allSections === undefined || allTasks === undefined) {
    return <ProjectLoading />
  }
  const project = allProjects.find((p) => p.id === projectId)
  if (project === undefined) return <ProjectShell>Project not found</ProjectShell>

  const sections = allSections
    .filter((s) => s.project_id === projectId)
    .sort((a, b) => a.section_order - b.section_order || a.id.localeCompare(b.id))
  const active = activeTasks(tasksInProject(allTasks, projectId))
  const rootTasks = containerTasks(active, (t) => t.parent_id === null && t.section_id === null)

  return (
    <div className={CONTENT}>
      <header className="flex items-start justify-between gap-4 pt-8 pb-4">
        <div className="flex min-w-0 items-center gap-2">
          <ColorDot color={project.color} />
          {/* Accessible page heading: the visible title is a click-to-edit button, so a
              visually-hidden h1 carries the project name for heading navigation and axe. */}
          <h1 className="sr-only">{project.name}</h1>
          <EditableText
            value={project.name}
            editing={titleEditing}
            onEditingChange={setTitleEditing}
            onSave={(name) => updateProject.mutate({ id: projectId, patch: { name } })}
            ariaLabel="Project name"
            className="font-strong text-header text-text-primary"
            inputClassName="h-9 font-strong text-header"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DisplayMenu viewKey={displayKey} />
          <button
            type="button"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            onClick={() => startAddSection('__end__')}
          >
            <Plus size={16} aria-hidden /> Add section
          </button>
          {/* Task X gate wiring: edit/archive/delete route through the Task F dialogs
              (ProjectDialog + ProjectConfirms) so confirms + undo toasts apply. The Inbox
              allows nothing but view prefs (plan Task F), so it gets no actions menu. */}
          {!project.is_inbox && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
                aria-label="Project actions"
              >
                <Ellipsis size={20} strokeWidth={1.75} aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTitleEditing(true)}>
                  <Pencil size={16} aria-hidden /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => openDialog({ kind: 'project', mode: 'edit', projectId })}
                >
                  <Settings2 size={16} aria-hidden /> Edit project
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => openDialog({ kind: 'project-archive', projectId })}
                >
                  <Archive size={16} aria-hidden /> Archive project
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => openDialog({ kind: 'project-delete', projectId })}
                >
                  <Trash2 size={16} aria-hidden /> Delete project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {pipelineDeviates(prefs) ? (
        // Group/sort/filter replace the section + subtree + dnd rendering (sorting disables
        // manual ordering, matching Todoist); the flat pipeline runs over ALL active project
        // tasks. The bottom quick-add stays; sections/undo-drag return when prefs reset.
        <>
          <GroupedTaskList
            groups={pipelineGroups(active, prefs, filterCtx, filterCtx.projects)}
            emptyText="No tasks"
          />
          <AddTaskRow context={{ projectId }} />
        </>
      ) : (
        <DndContext
          sensors={dnd.sensors}
          collisionDetection={closestCenter}
          onDragEnd={dnd.onDragEnd}
        >
          <DroppableRegion id={ROOT_DROP_ID}>
            {rootTasks.length > 0 && (
              <TaskList tasks={rootTasks} groupId={ROOT_DROP_ID} tree sortable />
            )}
            {active.length === 0 && sections.length === 0 && (
              <EmptyState
                icon={Hash}
                title={`No tasks in ${project.name}`}
                description="Add one with A, or press Q from anywhere."
              />
            )}
            <AddTaskRow context={{ projectId }} />
          </DroppableRegion>

          {sections.map((section, i) => {
            const prev = i > 0 ? sections[i - 1] : undefined
            const anchor = prev === undefined ? '__first__' : `after:${prev.id}`
            return (
              <div key={section.id}>
                <AddSection projectId={projectId} sections={sections} anchor={anchor} />
                <SectionBlock
                  projectId={projectId}
                  section={section}
                  tasks={containerTasks(
                    active,
                    (t) => t.parent_id === null && t.section_id === section.id,
                  )}
                />
              </div>
            )
          })}

          <AddSection projectId={projectId} sections={sections} anchor="__end__" />
        </DndContext>
      )}
      {prefs.showCompleted && <CompletedSection projectId={projectId} />}
    </div>
  )
}
