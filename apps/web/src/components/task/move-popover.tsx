/**
 * Move-to picker content (Task F). Bare panel reused by the row popover, the multi-select
 * toolbar, and the task-detail Project field (frozen export — Task H imports it). Lists
 * non-archived projects with their sections indented; reports the target through `onPick`.
 */
import { Check, Hash, Inbox, Search } from 'lucide-react'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import { useProjects } from '@/api/hooks/projects'
import { useSections } from '@/api/hooks/sections'
import type { TaskMove } from '@/api/schemas'

/** Server palette names are snake_case (`berry_red`); the CSS vars are kebab (`--od-palette-berry-red`). */
export function paletteVar(color: string): string {
  return `var(--od-palette-${color.replace(/_/g, '-')}, var(--od-text-tertiary))`
}

export interface MovePanelProps {
  /** Current container, so it can be marked as selected. */
  value?: { projectId?: string | null; sectionId?: string | null }
  /** Chosen destination. Caller performs the move and closes the surface. */
  onPick: (to: TaskMove) => void
}

export function MovePanel({ value, onPick }: MovePanelProps): ReactElement {
  const [query, setQuery] = useState('')
  const { data: projects } = useProjects()
  const { data: sections } = useSections()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (projects ?? [])
      .filter((project) => !project.is_archived)
      .filter((project) => q === '' || project.name.toLowerCase().includes(q))
      .sort((a, b) => a.child_order - b.child_order)
      .map((project) => ({
        project,
        sections: (sections ?? [])
          .filter((section) => section.project_id === project.id && !section.is_archived)
          .sort((a, b) => a.section_order - b.section_order),
      }))
  }, [projects, sections, query])

  /** Moving detaches the task from any parent (it lands at the container's top level). */
  const pick = (projectId: string, sectionId: string | null): void => {
    onPick({ project_id: projectId, section_id: sectionId, parent_id: null })
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-border-subtle border-b px-1 pb-2">
        <Search size={16} className="shrink-0 text-text-tertiary" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Move to…"
          aria-label="Search projects"
          className="h-7 w-full bg-transparent text-copy text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>
      <div className="mt-1 max-h-[280px] overflow-y-auto">
        {rows.length === 0 && (
          <div className="px-2 py-2 text-caption text-text-tertiary italic">No projects</div>
        )}
        {rows.map(({ project, sections }) => {
          const projectCurrent =
            value?.projectId === project.id && (value?.sectionId ?? null) === null
          return (
            <div key={project.id}>
              <button
                type="button"
                onClick={() => pick(project.id, null)}
                className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
              >
                {project.is_inbox ? (
                  <Inbox size={16} className="shrink-0 text-text-secondary" aria-hidden />
                ) : (
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: paletteVar(project.color) }}
                    aria-hidden
                  />
                )}
                <span className="truncate">{project.name}</span>
                {projectCurrent && (
                  <Check size={16} className="ml-auto shrink-0 text-text-secondary" aria-hidden />
                )}
              </button>
              {sections.map((section) => {
                const sectionCurrent =
                  value?.projectId === project.id && value?.sectionId === section.id
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => pick(project.id, section.id)}
                    className="flex h-8 w-full items-center gap-2 rounded-sm py-0 pr-2 pl-8 text-left text-copy text-text-secondary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                  >
                    <Hash size={14} className="shrink-0 text-text-tertiary" aria-hidden />
                    <span className="truncate">{section.name}</span>
                    {sectionCurrent && (
                      <Check
                        size={16}
                        className="ml-auto shrink-0 text-text-secondary"
                        aria-hidden
                      />
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
