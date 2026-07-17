import { Link, useMatchRoute } from '@tanstack/react-router'
import { ChevronRight, Filter as FilterIcon, Plus, Tag } from 'lucide-react'
import type { ReactNode } from 'react'
import { type Filter, useFilters } from '@/api/hooks/filters'
import { useLabels } from '@/api/hooks/labels'
import { useProjectMutations, useProjects } from '@/api/hooks/projects'
import type { Label, Project } from '@/api/schemas'
import { useDialogStore } from '@/features/dialogs/store'
import { cn } from '@/lib/utils'

/** `berry_red` → `var(--od-palette-berry-red, …)`; unknown names fall back to tertiary. */
function paletteVar(color: string): string {
  return `var(--od-palette-${color.replace(/_/g, '-')}, var(--od-text-tertiary))`
}

const FAV_LINK_CLASS =
  'flex h-8 items-center gap-2 rounded-sm px-[5px] text-body outline-none transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
const FAV_ACTIVE = { className: 'bg-selected font-medium text-selected-text' }
const FAV_INACTIVE = { className: 'text-text-primary hover:bg-sidebar-hover' }

interface ProjectRow {
  project: Project
  depth: number
  hasChildren: boolean
}

/** DFS by child_order; collapsed nodes emit but skip descendants; orphans become roots. */
function orderedProjects(projects: Project[]): ProjectRow[] {
  const present = new Set(projects.map((p) => p.id))
  const byParent = new Map<string | null, Project[]>()
  for (const project of projects) {
    const key =
      project.parent_id !== null && present.has(project.parent_id) ? project.parent_id : null
    const bucket = byParent.get(key) ?? []
    bucket.push(project)
    byParent.set(key, bucket)
  }
  const sortRows = (rows: Project[]): Project[] =>
    [...rows].sort((a, b) => a.child_order - b.child_order || a.id.localeCompare(b.id))

  const out: ProjectRow[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const project of sortRows(byParent.get(parentId) ?? [])) {
      const hasChildren = (byParent.get(project.id) ?? []).length > 0
      out.push({ project, depth, hasChildren })
      if (hasChildren && !project.is_collapsed) walk(project.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

function SectionHeading({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-[5px] pt-4 pb-1">
      <h2 className="min-w-0 flex-1 truncate font-medium text-caption text-text-tertiary">
        {children}
      </h2>
      {action}
    </div>
  )
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="size-3 shrink-0 rounded-full"
      style={{ backgroundColor: paletteVar(color) }}
      aria-hidden="true"
    />
  )
}

function FavoriteProjectItem({ project }: { project: Project }) {
  return (
    <Link
      to="/project/$projectId"
      params={{ projectId: project.id }}
      className={FAV_LINK_CLASS}
      activeProps={FAV_ACTIVE}
      inactiveProps={FAV_INACTIVE}
    >
      <ColorDot color={project.color} />
      <span className="truncate">{project.name}</span>
    </Link>
  )
}

function FavoriteLabelItem({ label }: { label: Label }) {
  return (
    <Link
      // phase 5 Task A re-keyed the label route by id (was /label/$labelName); Task J
      // owns the full favorites treatment.
      to="/label/$labelId"
      params={{ labelId: label.id }}
      className={FAV_LINK_CLASS}
      activeProps={FAV_ACTIVE}
      inactiveProps={FAV_INACTIVE}
    >
      <Tag
        size={16}
        className="shrink-0"
        style={{ color: paletteVar(label.color) }}
        aria-hidden="true"
      />
      <span className="truncate">{label.name}</span>
    </Link>
  )
}

function FavoriteFilterItem({ filter }: { filter: Filter }) {
  return (
    <Link
      to="/filter/$filterId"
      params={{ filterId: filter.id }}
      className={FAV_LINK_CLASS}
      activeProps={FAV_ACTIVE}
      inactiveProps={FAV_INACTIVE}
    >
      <FilterIcon
        size={16}
        className="shrink-0"
        style={{ color: paletteVar(filter.color) }}
        aria-hidden="true"
      />
      <span className="truncate">{filter.name}</span>
    </Link>
  )
}

function ProjectItem({
  project,
  depth,
  hasChildren,
  active,
  onToggle,
}: ProjectRow & { active: boolean; onToggle: (project: Project) => void }) {
  return (
    <div
      style={{ paddingLeft: `${5 + depth * 16}px` }}
      className={cn(
        'flex h-8 items-center gap-1 rounded-sm pr-[5px] text-body',
        active
          ? 'bg-selected font-medium text-selected-text'
          : 'text-text-primary hover:bg-sidebar-hover',
      )}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={`${project.is_collapsed ? 'Expand' : 'Collapse'} ${project.name}`}
          aria-expanded={!project.is_collapsed}
          onClick={() => onToggle(project)}
          className="grid size-5 shrink-0 place-items-center rounded-sm text-text-tertiary outline-none transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
        >
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={cn(
              'transition-transform duration-150',
              !project.is_collapsed && 'rotate-90',
            )}
          />
        </button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden="true" />
      )}
      <Link
        to="/project/$projectId"
        params={{ projectId: project.id }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
      >
        <ColorDot color={project.color} />
        <span className="truncate">{project.name}</span>
      </Link>
    </div>
  )
}

/** "Favorites" (favorited projects + filters + labels) and "My Projects" (nested tree). */
export function SidebarProjects() {
  const { data: projects = [] } = useProjects()
  const { data: labels = [] } = useLabels()
  const { data: filters = [] } = useFilters()
  const { update } = useProjectMutations()
  const openDialog = useDialogStore((s) => s.openDialog)
  const matchRoute = useMatchRoute()

  const visible = projects.filter((p) => !p.is_archived && !p.is_inbox)
  const favoriteProjects = visible.filter((p) => p.is_favorite)
  const favoriteFilters = filters.filter((f) => f.is_favorite)
  const favoriteLabels = labels.filter((l) => l.is_favorite)
  const rows = orderedProjects(visible)
  const hasFavorites =
    favoriteProjects.length > 0 || favoriteFilters.length > 0 || favoriteLabels.length > 0

  const toggleCollapsed = (project: Project): void => {
    update.mutate({ id: project.id, patch: { is_collapsed: !project.is_collapsed } })
  }

  return (
    <div className="flex flex-col">
      {hasFavorites && (
        <section>
          <SectionHeading>Favorites</SectionHeading>
          {favoriteProjects.map((project) => (
            <FavoriteProjectItem key={project.id} project={project} />
          ))}
          {favoriteFilters.map((filter) => (
            <FavoriteFilterItem key={filter.id} filter={filter} />
          ))}
          {favoriteLabels.map((label) => (
            <FavoriteLabelItem key={label.id} label={label} />
          ))}
        </section>
      )}
      <section>
        <SectionHeading
          action={
            <button
              type="button"
              aria-label="Add project"
              onClick={() => openDialog({ kind: 'project', mode: 'create' })}
              className="grid size-5 shrink-0 place-items-center rounded-sm text-text-tertiary outline-none transition-colors hover:bg-sidebar-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          }
        >
          My Projects
        </SectionHeading>
        {rows.length === 0 ? (
          <p className="px-[5px] py-1 text-caption text-text-tertiary italic">No projects yet</p>
        ) : (
          rows.map((row) => (
            <ProjectItem
              key={row.project.id}
              {...row}
              active={
                matchRoute({ to: '/project/$projectId', params: { projectId: row.project.id } }) !==
                false
              }
              onToggle={toggleCollapsed}
            />
          ))
        )}
      </section>
    </div>
  )
}
