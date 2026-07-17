/**
 * ⌘K command palette. Open state is store-driven (the keyboard map binds the keys; the topbar
 * search button toggles it too). Groups: Recents (empty query), Views, Go to (feature pages),
 * Projects, Labels, Commands, Settings (one entry per settings page), Theme, and Tasks.
 *
 * Task search (phase 5 Task I) hits the server FTS endpoint through `useServerSearch` — debounced
 * 200 ms, ≥2 chars — and renders each hit with its `<b>…</b>` FTS snippet split into safe React
 * text (never dangerouslySetInnerHTML), a checkbox-style icon (completed hits struck through), the
 * project name joined from the projects cache, and a comment glyph for comment matches. A
 * client-side substring fallback over the active-tasks cache covers a failed search request.
 *
 * Static groups are filtered here (`shouldFilter={false}`) so group visibility matches the spec.
 * Selecting always closes the palette and records a recent for view/project/label targets.
 */
import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  CalendarCheck,
  CalendarDays,
  Check,
  Circle,
  CircleCheck,
  Filter,
  Inbox,
  Keyboard,
  LogOut,
  MessageSquare,
  Palette,
  PanelLeft,
  Plus,
  Settings,
  Tag,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLabels } from '@/api/hooks/labels'
import { useProjects } from '@/api/hooks/projects'
import { useActiveTasks } from '@/api/hooks/tasks'
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
import { parseSnippet, useServerSearch } from '@/features/search/useServerSearch'
import { SETTINGS_PAGES } from '@/features/settings/registry'
import { useUserSettings } from '@/features/settings/useSettings'
import {
  settingsPatchForChoice,
  THEME_CHOICES,
  type ThemeChoice,
  themeChoiceFromSettings,
} from '@/lib/theme'
import { cn } from '@/lib/utils'
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

/** Render an FTS snippet with its `<b>…</b>` matches emphasised; falls back to the raw content. */
function SnippetText({ snippet, content }: { snippet: string; content: string }) {
  const segments = parseSnippet(snippet)
  if (segments.length === 0) return <>{content}</>
  // Key on the running character offset (never the array index) — offsets are strictly
  // increasing because parseSnippet never emits an empty segment, so keys stay unique.
  let cursor = 0
  return (
    <>
      {segments.map((seg) => {
        const key = `${cursor}:${seg.match ? 'm' : 't'}`
        cursor += seg.text.length
        return seg.match ? (
          <strong key={key} className="font-semibold">
            {seg.text}
          </strong>
        ) : (
          <span key={key}>{seg.text}</span>
        )
      })}
    </>
  )
}

interface PaletteCommand {
  id: string
  label: string
  keywords: string
  icon: typeof Plus
  hint?: string
  run: () => void
}

/** A search hit flattened for rendering — from the server FTS response or the offline fallback. */
interface TaskHit {
  id: string
  content: string
  projectId: string
  completed: boolean
  matchedIn: 'task' | 'comment'
  snippet: string
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
  // Theme commands write through the account settings (single source of truth; the
  // AppLayout-mounted useThemeSync repaints + mirrors to localStorage optimistically).
  const { settings, update: updateSettings } = useUserSettings()

  // Server FTS search — debounced/gated inside the hook; disabled while the palette is closed.
  const { term, query: search } = useServerSearch(open ? query : '')

  const trimmed = query.trim()
  const q = trimmed.toLowerCase()
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

  const taskHits = useMemo<TaskHit[]>(() => {
    if (term.length < 2) return []
    if (search.isError) {
      // Search endpoint failed — degrade to a substring scan of the active-tasks cache.
      const lower = term.toLowerCase()
      return (activeTasks.data ?? [])
        .filter(
          (t) =>
            t.content.toLowerCase().includes(lower) || t.description.toLowerCase().includes(lower),
        )
        .slice(0, MAX_TASK_RESULTS)
        .map((t) => ({
          id: t.id,
          content: t.content,
          projectId: t.project_id,
          completed: t.completed_at !== null,
          matchedIn: 'task' as const,
          snippet: '',
        }))
    }
    return (search.data?.results ?? []).slice(0, MAX_TASK_RESULTS).map((r) => ({
      id: r.task.id,
      content: r.task.content,
      projectId: r.task.project_id,
      completed: r.task.completed_at !== null,
      matchedIn: r.matched_in,
      snippet: r.snippet,
    }))
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
    // Recents store names; resolve the id-keyed label route via the labels cache.
    const label = labelList.find((l) => l.name === name)
    if (label) void navigate({ to: '/label/$labelId', params: { labelId: label.id } })
  }
  function openTask(id: string, content: string) {
    pushRecent({ type: 'task', id, title: content })
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
    if (recent.type === 'task') return openTask(recent.id, recent.title)
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

  const navCommands: PaletteCommand[] = [
    {
      id: 'go-filters-labels',
      label: 'Go to Filters & Labels',
      keywords: 'filters labels saved searches tags view',
      icon: Filter,
      hint: 'G V',
      run: () => {
        void navigate({ to: '/filters-labels' })
      },
    },
    {
      id: 'go-reporting',
      label: 'Go to Reporting',
      keywords: 'reporting activity completed productivity log history',
      icon: Activity,
      hint: 'G A',
      run: () => {
        void navigate({ to: '/reporting' })
      },
    },
  ]

  const settingsCommands: PaletteCommand[] = [
    {
      id: 'settings',
      label: 'Settings',
      keywords: 'settings preferences options configuration',
      icon: Settings,
      hint: 'O S',
      run: () => {
        void navigate({ to: '/settings/$page', params: { page: 'account' } })
      },
    },
    ...SETTINGS_PAGES.map(
      (page): PaletteCommand => ({
        id: `settings-${page.key}`,
        label: `Settings > ${page.title}`,
        keywords: `settings ${page.title} ${page.keywords.join(' ')}`,
        icon: Settings,
        hint: page.key === 'theme' ? 'O T' : undefined,
        run: () => {
          void navigate({ to: '/settings/$page', params: { page: page.key } })
        },
      }),
    ),
  ]

  const recents = hasQuery ? [] : getRecents()
  const viewItems = hasQuery ? VIEWS.filter((v) => matchText(v.title)) : VIEWS
  const projectItems = hasQuery ? visibleProjects.filter((p) => matchText(p.name)) : []
  const labelItems = hasQuery ? labelList.filter((l) => matchText(l.name)) : []
  const filterCommands = (list: PaletteCommand[]) =>
    hasQuery ? list.filter((c) => matchText(`${c.label} ${c.keywords}`)) : list
  // Bounded, fixed lists (Views, Go to, Commands, Settings, Theme) stay visible in the empty
  // state; unbounded user data (Projects, Labels, Tasks) surfaces on query.
  const commandItems = filterCommands(commands)
  const navItems = filterCommands(navCommands)
  const settingsItems = filterCommands(settingsCommands)
  const themeItems = hasQuery
    ? THEME_CHOICES.filter((c) => matchText(`theme ${THEME_LABELS[c]}`))
    : THEME_CHOICES
  const activeTheme = themeChoiceFromSettings(settings)

  // The Tasks group is shown whenever ≥2 chars are typed; it renders a skeleton while the
  // (debounced) request settles, results when they arrive, or a no-results line otherwise.
  const searchActive = trimmed.length >= 2
  const pendingSearch = search.isFetching || term !== trimmed

  const anyStatic =
    recents.length > 0 ||
    viewItems.length > 0 ||
    navItems.length > 0 ||
    projectItems.length > 0 ||
    labelItems.length > 0 ||
    commandItems.length > 0 ||
    settingsItems.length > 0 ||
    themeItems.length > 0
  const showGlobalEmpty = !anyStatic && !searchActive

  // Total matches currently rendered — announced via a polite live region so screen-reader
  // users hear how many results a query produced (the visual list conveys this to sighted users).
  const resultCount =
    recents.length +
    viewItems.length +
    navItems.length +
    projectItems.length +
    labelItems.length +
    commandItems.length +
    settingsItems.length +
    themeItems.length +
    (searchActive ? taskHits.length : 0)

  const renderCommandGroup = (heading: string, items: PaletteCommand[]) =>
    items.length > 0 ? (
      <CommandGroup heading={heading}>
        {items.map((cmd) => {
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
              <span className="truncate">{cmd.label}</span>
              {cmd.hint && <CommandShortcut>{cmd.hint}</CommandShortcut>}
            </CommandItem>
          )
        })}
      </CommandGroup>
    ) : null

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <Command shouldFilter={false}>
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          aria-label="Search or jump to"
          placeholder="Search or jump to…"
        />
        <CommandList>
          {showGlobalEmpty && (
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
                  ) : r.type === 'task' ? (
                    <Circle size={16} className="text-text-tertiary" aria-hidden="true" />
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

          {renderCommandGroup('Go to', navItems)}

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

          {renderCommandGroup('Commands', commandItems)}

          {renderCommandGroup('Settings', settingsItems)}

          {themeItems.length > 0 && (
            <CommandGroup heading="Theme">
              {themeItems.map((choice) => (
                <CommandItem
                  key={choice}
                  value={`theme-${choice}`}
                  onSelect={() => {
                    updateSettings(settingsPatchForChoice(choice))
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

          {searchActive && (
            <CommandGroup heading="Tasks">
              {taskHits.length > 0 ? (
                taskHits.map((h) => {
                  const projectName = projectById.get(h.projectId)?.name
                  return (
                    <CommandItem
                      key={`task-${h.id}`}
                      value={`task-${h.id}`}
                      onSelect={() => openTask(h.id, h.content)}
                    >
                      {h.completed ? (
                        <CircleCheck
                          size={16}
                          className="shrink-0 text-text-tertiary"
                          aria-hidden="true"
                        />
                      ) : (
                        <Circle
                          size={16}
                          className="shrink-0 text-text-tertiary"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={cn(
                          'min-w-0 truncate',
                          h.completed && 'text-text-tertiary line-through',
                        )}
                      >
                        <SnippetText snippet={h.snippet} content={h.content} />
                      </span>
                      {h.matchedIn === 'comment' && (
                        <MessageSquare
                          size={14}
                          className="shrink-0 text-text-tertiary"
                          aria-label="Matched in a comment"
                        />
                      )}
                      {projectName && (
                        <span className="ml-auto shrink-0 truncate text-caption text-text-tertiary">
                          {projectName}
                        </span>
                      )}
                    </CommandItem>
                  )
                })
              ) : pendingSearch ? (
                <div
                  className="flex items-center gap-2 px-2 py-2 text-copy text-text-tertiary"
                  aria-live="polite"
                >
                  <span
                    className="size-4 shrink-0 animate-pulse rounded-full bg-hover"
                    aria-hidden="true"
                  />
                  <span>Searching…</span>
                </div>
              ) : (
                <div className="px-2 py-2 text-copy text-text-tertiary">
                  No results for “{term || trimmed}”
                </div>
              )}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
      {/* Result-count live region — OUTSIDE <Command> so it isn't an unallowed child of cmdk's
          role="listbox" (axe aria-required-children); still inside the dialog, so it's announced. */}
      <div role="status" aria-live="polite" className="sr-only">
        {hasQuery || searchActive
          ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`
          : ''}
      </div>
    </CommandDialog>
  )
}
