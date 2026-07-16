/**
 * ⌘K command palette. Open state is store-driven (Task N binds the keys; the topbar search
 * button toggles it too). Groups: Recents (empty query), Views, Projects, Labels, Commands,
 * Theme, and Tasks. Task search hits the server FTS endpoint (`GET /api/v1/search`, verified
 * as-built to return `{ results: [{ task, matched_in }], next_cursor }`) debounced 200 ms,
 * ≥2 chars, with a client-side substring fallback over the active-tasks cache if search errors.
 * Static groups are filtered here (`shouldFilter={false}`) so group visibility matches the spec.
 * Selecting always closes the palette and records a recent for view/project/label targets.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  CalendarCheck,
  CalendarDays,
  Check,
  Circle,
  Inbox,
  Keyboard,
  LogOut,
  Palette,
  PanelLeft,
  Plus,
  Tag,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { api, endpoints } from '@/api/client'
import { useLabels } from '@/api/hooks/labels'
import { useProjects } from '@/api/hooks/projects'
import { useActiveTasks } from '@/api/hooks/tasks'
import { type Task, TaskSchema } from '@/api/schemas'
import { authClient } from '@/auth/client'
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { applyTheme, getTheme, THEME_CHOICES, type ThemeChoice } from '@/lib/theme'
import { useUiStore } from '@/stores/ui'
import { getRecents, pushRecent, type Recent, useTrackRecents } from './recents'

const MAX_TASK_RESULTS = 8

const VIEWS = [
  { id: 'inbox', title: 'Inbox', to: '/inbox', icon: Inbox, hint: 'G I' },
  { id: 'today', title: 'Today', to: '/today', icon: CalendarCheck, hint: 'G T' },
  { id: 'upcoming', title: 'Upcoming', to: '/upcoming', icon: CalendarDays, hint: 'G U' },
] as const

const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  kale: 'Kale',
  todoist: 'Todoist',
  dark: 'Dark',
  moonstone: 'Moonstone',
  tangerine: 'Tangerine',
  blueberry: 'Blueberry',
  lavender: 'Lavender',
  raspberry: 'Raspberry',
}

/** Server FTS response; `task` mirrors the frozen TaskSchema so the active-tasks cache and
 *  the task-detail dialog can consume search hits identically. */
const SearchResponseSchema = z.object({
  results: z.array(z.object({ task: TaskSchema, matched_in: z.enum(['task', 'comment']) })),
  next_cursor: z.string().nullable(),
})

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debouncedValue
}

function useTaskSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['search', query] as const,
    queryFn: () => api(endpoints.search(query), { schema: SearchResponseSchema }),
    enabled,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  })
}

async function handleLogout(): Promise<void> {
  try {
    await authClient.signOut()
  } finally {
    // Hard navigate: drops all in-memory query caches and re-runs the session guard.
    window.location.href = '/login'
  }
}

/** kebab-cased CSS custom property for a snake_cased server color name. */
function colorVar(color: string): string {
  return `var(--od-palette-${color.replace(/_/g, '-')})`
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-full"
      style={{ backgroundColor: colorVar(color) }}
    />
  )
}

function ViewIcon({ id }: { id: string }) {
  const Icon = id === 'inbox' ? Inbox : id === 'upcoming' ? CalendarDays : CalendarCheck
  return <Icon size={16} className="text-text-secondary" aria-hidden="true" />
}

interface PaletteCommand {
  id: string
  label: string
  keywords: string
  icon: typeof Plus
  hint?: string
  run: () => void
}

export function CommandPalette() {
  useTrackRecents()

  const open = useUiStore((s) => s.paletteOpen)
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen)
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const setShortcutOverlayOpen = useUiStore((s) => s.setShortcutOverlayOpen)

  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const { data: projects } = useProjects()
  const { data: labels } = useLabels()
  const activeTasks = useActiveTasks()

  const debounced = useDebouncedValue(query, 200)
  const term = debounced.trim()
  const search = useTaskSearch(term, open && term.length >= 2)

  const q = query.trim().toLowerCase()
  const hasQuery = q.length > 0
  const matchText = (text: string) => text.toLowerCase().includes(q)

  function close() {
    setPaletteOpen(false)
    setQuery('')
  }

  function handleOpenChange(next: boolean) {
    setPaletteOpen(next)
    if (!next) setQuery('')
  }

  const allProjects = useMemo(() => projects ?? [], [projects])
  const projectById = useMemo(() => new Map(allProjects.map((p) => [p.id, p])), [allProjects])
  const visibleProjects = useMemo(
    () => allProjects.filter((p) => !p.is_archived && !p.is_inbox),
    [allProjects],
  )
  const labelList = labels ?? []

  const taskResults = useMemo<Task[]>(() => {
    if (term.length < 2) return []
    if (search.isError) {
      const lower = term.toLowerCase()
      return (activeTasks.data ?? [])
        .filter(
          (t) =>
            t.content.toLowerCase().includes(lower) || t.description.toLowerCase().includes(lower),
        )
        .slice(0, MAX_TASK_RESULTS)
    }
    return (search.data?.results ?? []).map((r) => r.task).slice(0, MAX_TASK_RESULTS)
  }, [term, search.isError, search.data, activeTasks.data])

  function goView(view: (typeof VIEWS)[number]) {
    pushRecent({ type: 'view', id: view.id, title: view.title })
    close()
    void navigate({ to: view.to })
  }
  function goProject(id: string, name: string) {
    pushRecent({ type: 'project', id, title: name })
    close()
    void navigate({ to: '/project/$projectId', params: { projectId: id } })
  }
  function goLabel(name: string) {
    pushRecent({ type: 'label', id: name, title: name })
    close()
    void navigate({ to: '/label/$labelName', params: { labelName: name } })
  }
  function openTask(id: string) {
    close()
    void navigate({ to: '.', search: (prev) => ({ ...prev, task: id }) })
  }
  function goRecent(recent: Recent) {
    if (recent.type === 'view') {
      const view = VIEWS.find((v) => v.id === recent.id)
      if (view) return goView(view)
      pushRecent(recent)
      close()
      return
    }
    if (recent.type === 'project') return goProject(recent.id, recent.title)
    return goLabel(recent.id)
  }

  const commands: PaletteCommand[] = [
    {
      id: 'add-task',
      label: 'Add task',
      keywords: 'new create quick',
      icon: Plus,
      hint: 'Q',
      run: () => setQuickAddOpen(true),
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle sidebar',
      keywords: 'hide show panel',
      icon: PanelLeft,
      hint: 'M',
      run: () => toggleSidebar(),
    },
    {
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      keywords: 'help keys hotkeys',
      icon: Keyboard,
      hint: '?',
      run: () => setShortcutOverlayOpen(true),
    },
    {
      id: 'design-tokens',
      label: 'Design tokens',
      keywords: 'dev colors showcase',
      icon: Palette,
      run: () => {
        void navigate({ to: '/dev/tokens' })
      },
    },
    {
      id: 'logout',
      label: 'Log out',
      keywords: 'sign out exit',
      icon: LogOut,
      run: () => {
        void handleLogout()
      },
    },
  ]

  const recents = hasQuery ? [] : getRecents()
  const viewItems = hasQuery ? VIEWS.filter((v) => matchText(v.title)) : VIEWS
  const projectItems = hasQuery ? visibleProjects.filter((p) => matchText(p.name)) : []
  const labelItems = hasQuery ? labelList.filter((l) => matchText(l.name)) : []
  const commandItems = hasQuery
    ? commands.filter((c) => matchText(`${c.label} ${c.keywords}`))
    : commands
  // Bounded, fixed lists (Views, Commands, Theme) stay visible in the empty state; unbounded
  // user data (Projects, Labels, Tasks) surfaces on query, with Recents covering recent hits.
  const themeItems = hasQuery
    ? THEME_CHOICES.filter((c) => matchText(`theme ${THEME_LABELS[c]}`))
    : THEME_CHOICES
  const showTasks = term.length >= 2 && taskResults.length > 0
  const activeTheme = getTheme()

  const anyResults =
    recents.length > 0 ||
    viewItems.length > 0 ||
    projectItems.length > 0 ||
    labelItems.length > 0 ||
    commandItems.length > 0 ||
    themeItems.length > 0 ||
    showTasks

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <Command shouldFilter={false}>
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search or jump to…"
        />
        <CommandList>
          {!anyResults && (
            <div className="py-6 text-center text-copy text-text-tertiary">No results found.</div>
          )}

          {recents.length > 0 && (
            <CommandGroup heading="Recent">
              {recents.map((r) => (
                <CommandItem
                  key={`recent-${r.type}-${r.id}`}
                  value={`recent-${r.type}-${r.id}`}
                  onSelect={() => goRecent(r)}
                >
                  {r.type === 'project' ? (
                    <ColorDot color={projectById.get(r.id)?.color ?? 'charcoal'} />
                  ) : r.type === 'label' ? (
                    <Tag size={16} className="text-text-secondary" aria-hidden="true" />
                  ) : (
                    <ViewIcon id={r.id} />
                  )}
                  <span className="truncate">{r.type === 'label' ? `@${r.title}` : r.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {viewItems.length > 0 && (
            <CommandGroup heading="Views">
              {viewItems.map((v) => {
                const Icon = v.icon
                return (
                  <CommandItem key={v.id} value={`view-${v.id}`} onSelect={() => goView(v)}>
                    <Icon size={16} className="text-text-secondary" aria-hidden="true" />
                    <span>{v.title}</span>
                    <CommandShortcut>{v.hint}</CommandShortcut>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {projectItems.length > 0 && (
            <CommandGroup heading="Projects">
              {projectItems.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`project-${p.id}`}
                  onSelect={() => goProject(p.id, p.name)}
                >
                  <ColorDot color={p.color} />
                  <span className="truncate">{p.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {labelItems.length > 0 && (
            <CommandGroup heading="Labels">
              {labelItems.map((l) => (
                <CommandItem key={l.id} value={`label-${l.id}`} onSelect={() => goLabel(l.name)}>
                  <Tag size={16} aria-hidden="true" style={{ color: colorVar(l.color) }} />
                  <span className="truncate">{l.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {commandItems.length > 0 && (
            <CommandGroup heading="Commands">
              {commandItems.map((cmd) => {
                const Icon = cmd.icon
                return (
                  <CommandItem
                    key={cmd.id}
                    value={`cmd-${cmd.id}`}
                    onSelect={() => {
                      close()
                      cmd.run()
                    }}
                  >
                    <Icon size={16} className="text-text-secondary" aria-hidden="true" />
                    <span>{cmd.label}</span>
                    {cmd.hint && <CommandShortcut>{cmd.hint}</CommandShortcut>}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {themeItems.length > 0 && (
            <CommandGroup heading="Theme">
              {themeItems.map((choice) => (
                <CommandItem
                  key={choice}
                  value={`theme-${choice}`}
                  onSelect={() => {
                    applyTheme(choice)
                    close()
                  }}
                >
                  <Palette size={16} className="text-text-secondary" aria-hidden="true" />
                  <span>{THEME_LABELS[choice]}</span>
                  {activeTheme === choice && (
                    <Check size={16} className="ml-auto text-accent" aria-hidden="true" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {showTasks && (
            <CommandGroup heading="Tasks">
              {taskResults.map((t) => (
                <CommandItem key={t.id} value={`task-${t.id}`} onSelect={() => openTask(t.id)}>
                  <Circle size={16} className="shrink-0 text-text-tertiary" aria-hidden="true" />
                  <span className="truncate">{t.content}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
