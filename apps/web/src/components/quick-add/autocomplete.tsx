/**
 * Sigil autocomplete for the Quick Add input: when the caret sits inside a `#project`,
 * `@label` or `/section` run, a menu of matches (plus an inline "Create '…'" row) anchors at
 * the caret. Exposed as a hook so the input owns a single keyboard pipeline — the input calls
 * `handleKeyDown` first and only falls through to submit/dismiss when the menu is closed.
 */
import { FolderPlus, Plus, Slash, Tag } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLabelMutations, useLabels } from '@/api/hooks/labels'
import { useProjectMutations, useProjects } from '@/api/hooks/projects'
import { useSectionMutations, useSections } from '@/api/hooks/sections'
import type { Label, Project, Section } from '@/api/schemas'
import { type AnchorRect, placePopover } from '@/components/ui/anchored'
import { cn } from '@/lib/utils'

type Sigil = '#' | '@' | '/'

export interface AutocompleteResources {
  projects: Project[]
  sections: Section[]
  labels: Label[]
  createProject: (name: string) => Promise<Project>
  createLabel: (name: string) => Promise<Label>
  createSection: (name: string, projectId: string) => Promise<Section>
}

/** Live projects/sections/labels + create helpers, shared by the dialog and inline add. */
export function useAutocompleteResources(): AutocompleteResources {
  const projects = useProjects()
  const sections = useSections()
  const labels = useLabels()
  const projectMut = useProjectMutations()
  const labelMut = useLabelMutations()
  const sectionMut = useSectionMutations()
  return {
    projects: projects.data ?? [],
    sections: sections.data ?? [],
    labels: labels.data ?? [],
    createProject: (name) => projectMut.create.mutateAsync({ name }),
    createLabel: (name) => labelMut.create.mutateAsync({ name }),
    createSection: (name, projectId) =>
      sectionMut.create.mutateAsync({ project_id: projectId, name }),
  }
}

export interface UseAutocompleteArgs {
  text: string
  /** caret offset (selectionStart) when the input is focused with a collapsed selection; else -1 */
  caret: number
  caretCoords: { top: number; left: number; height: number } | null
  /** name of the `#project` currently in the text, used to scope `/section` matches */
  projectContext: string | null
  resources: AutocompleteResources
  /** replace `[start, end)` with `replacement`, then place the caret after it */
  insert: (start: number, end: number, replacement: string) => void
}

export interface AutocompleteController {
  open: boolean
  node: ReactNode
  /** returns true when it consumed the event (arrow / enter / tab / escape while open) */
  handleKeyDown: (event: KeyboardEvent) => boolean
}

interface MenuItem {
  key: string
  icon: ReactNode
  label: ReactNode
  onSelect: () => void
}

interface Trigger {
  sigil: Sigil
  start: number
  query: string
}

const MAX_ITEMS = 8

/**
 * Menu box geometry, fed to `placePopover` so the caret-anchored menu can flip + clamp into the
 * viewport before it paints. Mirrors the Tailwind classes on the menu container: `w-64` (256px),
 * `max-h-64` (256px), each option `h-8` (32px), container `p-1` (4px top + 4px bottom). Options
 * never wrap (`truncate`), so `count * item + padding` is the exact rendered height.
 */
const MENU_WIDTH = 256
const MENU_MAX_HEIGHT = 256
const MENU_ITEM_HEIGHT = 32
const MENU_VERTICAL_PADDING = 8

function paletteVar(color: string): string {
  return `var(--ot-palette-${color.replaceAll('_', '-')})`
}

function quoteIfNeeded(name: string): string {
  return /\s/.test(name) ? `"${name}"` : name
}

/** Scan back from the caret for a boundary-anchored sigil with a whitespace-free run after it. */
function detectTrigger(text: string, caret: number): Trigger | null {
  if (caret < 1) return null
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === undefined || /\s/.test(ch)) return null
    if (ch === '#' || ch === '@' || ch === '/') {
      const boundary = i === 0 || /\s/.test(text[i - 1] ?? '')
      return boundary ? { sigil: ch, start: i, query: text.slice(i + 1, caret) } : null
    }
  }
  return null
}

function matches(name: string, query: string): boolean {
  return query === '' || name.toLowerCase().includes(query.toLowerCase())
}

function hasExact(names: Iterable<string>, query: string): boolean {
  const key = query.toLowerCase()
  for (const name of names) if (name.toLowerCase() === key) return true
  return false
}

export function useAutocomplete(args: UseAutocompleteArgs): AutocompleteController {
  const { text, caret, caretCoords, projectContext, resources, insert } = args
  const [dismissedSig, setDismissedSig] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const trigger = caret >= 0 ? detectTrigger(text, caret) : null
  const sig = trigger ? `${trigger.sigil}:${trigger.start}:${trigger.query}` : null

  const scopedProjectId = useMemo(() => {
    if (projectContext === null) return null
    const key = projectContext.toLowerCase()
    return resources.projects.find((p) => p.name.toLowerCase() === key)?.id ?? null
  }, [projectContext, resources.projects])

  const items = useMemo<MenuItem[]>(() => {
    if (!trigger) return []
    const { sigil, start, query } = trigger
    const end = caret
    const out: MenuItem[] = []

    if (sigil === '#') {
      for (const p of resources.projects) {
        if (p.is_archived || !matches(p.name, query)) continue
        out.push({
          key: `p-${p.id}`,
          icon: (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: paletteVar(p.color) }}
            />
          ),
          label: p.name,
          onSelect: () => insert(start, end, `#${quoteIfNeeded(p.name)} `),
        })
        if (out.length >= MAX_ITEMS) break
      }
      if (
        query.trim() !== '' &&
        !hasExact(
          resources.projects.map((p) => p.name),
          query,
        )
      ) {
        out.push({
          key: 'create-project',
          icon: <FolderPlus size={16} className="shrink-0 text-text-secondary" />,
          label: `Create '${query}'`,
          onSelect: () => {
            void resources
              .createProject(query)
              .then(() => insert(start, end, `#${quoteIfNeeded(query)} `))
          },
        })
      }
    } else if (sigil === '@') {
      for (const l of resources.labels) {
        if (!matches(l.name, query)) continue
        out.push({
          key: `l-${l.id}`,
          icon: <Tag size={16} className="shrink-0" style={{ color: paletteVar(l.color) }} />,
          label: l.name,
          onSelect: () => insert(start, end, `@${quoteIfNeeded(l.name)} `),
        })
        if (out.length >= MAX_ITEMS) break
      }
      if (
        query.trim() !== '' &&
        !hasExact(
          resources.labels.map((l) => l.name),
          query,
        )
      ) {
        out.push({
          key: 'create-label',
          icon: <Plus size={16} className="shrink-0 text-text-secondary" />,
          label: `Create '${query}'`,
          onSelect: () => {
            void resources
              .createLabel(query)
              .then(() => insert(start, end, `@${quoteIfNeeded(query)} `))
          },
        })
      }
    } else {
      const inScope = resources.sections.filter(
        (s) =>
          (scopedProjectId === null || s.project_id === scopedProjectId) && matches(s.name, query),
      )
      for (const s of inScope.slice(0, MAX_ITEMS)) {
        out.push({
          key: `s-${s.id}`,
          icon: <Slash size={16} className="shrink-0 text-text-secondary" />,
          label: s.name,
          onSelect: () => insert(start, end, `/${quoteIfNeeded(s.name)} `),
        })
      }
      if (
        query.trim() !== '' &&
        scopedProjectId !== null &&
        !hasExact(
          inScope.map((s) => s.name),
          query,
        )
      ) {
        const projectId = scopedProjectId
        out.push({
          key: 'create-section',
          icon: <Plus size={16} className="shrink-0 text-text-secondary" />,
          label: `Create '${query}'`,
          onSelect: () => {
            void resources
              .createSection(query, projectId)
              .then(() => insert(start, end, `/${quoteIfNeeded(query)} `))
          },
        })
      }
    }
    return out
  }, [trigger, caret, resources, scopedProjectId, insert])

  useEffect(() => {
    setActiveIndex(0)
  }, [sig])

  const open = trigger !== null && items.length > 0 && dismissedSig !== sig && caretCoords !== null

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    if (!open) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (i + 1) % items.length)
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (i - 1 + items.length) % items.length)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      items[Math.min(activeIndex, items.length - 1)]?.onSelect()
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissedSig(sig)
      return true
    }
    return false
  }

  let node: ReactNode = null
  if (open && caretCoords) {
    // rich-textarea reports the caret in VIEWPORT space (a Range's getBoundingClientRect).
    // Portal the menu to <body> and place it `position: fixed` so it escapes the Quick Add
    // popup's transform: a transformed ancestor becomes the containing block for fixed
    // descendants and reintroduces the "menu in the screen corner" bug this replaces. anchored.ts
    // then flips the menu above near the viewport bottom and clamps it fully on-screen.
    const anchor: AnchorRect = {
      top: caretCoords.top,
      left: caretCoords.left,
      width: 0,
      height: caretCoords.height,
    }
    const height = Math.min(
      items.length * MENU_ITEM_HEIGHT + MENU_VERTICAL_PADDING,
      MENU_MAX_HEIGHT,
    )
    const { top, left } = placePopover(anchor, { width: MENU_WIDTH, height })
    node = createPortal(
      <div
        // Marks this menu as logically part of the dialog: it lives under <body>, so base-ui
        // reports a click on it as an outside press — the dialog's onOpenChange whitelists this
        // attribute so selecting an item never dismisses the dialog.
        data-quickadd-popover=""
        onMouseDown={(e) => e.preventDefault()}
        className="fixed z-[var(--z-popover)] max-h-64 w-64 overflow-y-auto rounded-lg border border-border bg-surface-raised p-1 [box-shadow:var(--shadow-menu)]"
        style={{ top, left }}
        role="listbox"
        aria-label="Autocomplete suggestions"
      >
        {items.map((item, index) => (
          <button
            type="button"
            key={item.key}
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={item.onSelect}
            className={cn(
              'flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-copy text-text-primary',
              index === activeIndex && 'bg-hover',
            )}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>,
      document.body,
    )
  }

  return { open, node, handleKeyDown }
}
