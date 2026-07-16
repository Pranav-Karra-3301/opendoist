/**
 * Shared filter row for both Reporting tabs: event-type multi-select (Activity only),
 * project select, and a date-range preset (with custom since/until inputs). Controlled —
 * the page owns `ReportingFilterState` and derives query params from it.
 */
import { KNOWN_ACTIVITY_TYPES } from '@opendoist/core'
import { useProjects } from '@/api/hooks/projects'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { colorVar } from '@/features/dialogs/ColorPicker'
import { cn } from '@/lib/utils'
import type { RangePreset, ReportingFilterState } from './activity-presentation'
import { typeLabel } from './activity-presentation'

const ALL_PROJECTS = '__all__'

const RANGE_LABELS: Record<RangePreset, string> = {
  all: 'All time',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  custom: 'Custom range',
}
const RANGE_ORDER: RangePreset[] = ['all', '7d', '30d', 'custom']

export function ReportingFilters({
  state,
  onChange,
  showTypes,
}: {
  state: ReportingFilterState
  onChange: (next: ReportingFilterState) => void
  showTypes: boolean
}) {
  const projectsQuery = useProjects()
  const projects = projectsQuery.data ?? []
  const selectedProject = projects.find((p) => p.id === state.projectId)

  const typesLabel =
    state.types.length === 0
      ? 'All events'
      : `${state.types.length} event type${state.types.length > 1 ? 's' : ''}`

  const toggleType = (type: string, checked: boolean): void => {
    const next = checked ? [...state.types, type] : state.types.filter((t) => t !== type)
    onChange({ ...state, types: next })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      {showTypes && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Filter by event type"
            className={cn(buttonVariants({ variant: 'outline' }), 'min-w-[130px] justify-between')}
          >
            {typesLabel}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[320px]">
            {state.types.length > 0 && (
              <>
                <DropdownMenuItem onClick={() => onChange({ ...state, types: [] })}>
                  Clear selection
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {KNOWN_ACTIVITY_TYPES.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={state.types.includes(type)}
                onCheckedChange={(checked) => toggleType(type, checked)}
              >
                {typeLabel(type)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Select
        value={state.projectId === '' ? ALL_PROJECTS : state.projectId}
        onValueChange={(value: string | null) =>
          onChange({ ...state, projectId: value === null || value === ALL_PROJECTS ? '' : value })
        }
      >
        <SelectTrigger aria-label="Filter by project" className="min-w-[160px]">
          <span className="flex items-center gap-2 truncate">
            {selectedProject && (
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorVar(selectedProject.color) }}
              />
            )}
            <span className="truncate">{selectedProject?.name ?? 'All projects'}</span>
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.range}
        onValueChange={(value: string | null) =>
          onChange({ ...state, range: (value ?? 'all') as RangePreset })
        }
      >
        <SelectTrigger aria-label="Filter by date" className="min-w-[130px]">
          <span className="truncate">{RANGE_LABELS[state.range]}</span>
        </SelectTrigger>
        <SelectContent>
          {RANGE_ORDER.map((range) => (
            <SelectItem key={range} value={range}>
              {RANGE_LABELS[range]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {state.range === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            value={state.since}
            max={state.until === '' ? undefined : state.until}
            onChange={(e) => onChange({ ...state, since: e.target.value })}
            className="w-[150px]"
          />
          <span className="text-caption text-text-tertiary">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={state.until}
            min={state.since === '' ? undefined : state.since}
            onChange={(e) => onChange({ ...state, until: e.target.value })}
            className="w-[150px]"
          />
        </div>
      )}
    </div>
  )
}
