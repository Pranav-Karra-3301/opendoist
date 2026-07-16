/**
 * Divider-style "+ Add section" affordance shown between blocks (and at the end). Clicking
 * opens an inline name input; Enter/​"Add section" creates the section. Positional inserts
 * (`'__first__'` / `'after:<id>'`) create then renumber `section_order` — the create hook only
 * appends, so we reorder afterwards. The `s` shortcut opens the trailing `'__end__'` instance
 * (append, no renumber) via `useProjectViewStore.startAddSection()`.
 */
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useSectionMutations } from '@/api/hooks/sections'
import type { Section } from '@/api/schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProjectViewStore } from './use-project-dnd'

export interface AddSectionProps {
  projectId: string
  /** Current ordered sections of the project (baseline for a positional insert). */
  sections: Section[]
  /** `'__end__'` (append) · `'__first__'` (before first) · `'after:<sectionId>'`. */
  anchor: string
}

function insertIndex(anchor: string, sections: Section[]): number {
  if (anchor === '__first__') return 0
  if (anchor.startsWith('after:')) {
    const idx = sections.findIndex((s) => s.id === anchor.slice('after:'.length))
    return idx === -1 ? sections.length : idx + 1
  }
  return sections.length // '__end__'
}

export function AddSection({ projectId, sections, anchor }: AddSectionProps) {
  const addingSectionAt = useProjectViewStore((s) => s.addingSectionAt)
  const startAddSection = useProjectViewStore((s) => s.startAddSection)
  const stop = useProjectViewStore((s) => s.stop)
  const { create, update } = useSectionMutations()
  const [name, setName] = useState('')
  const active = addingSectionAt === anchor

  const submit = (): void => {
    const trimmed = name.trim()
    setName('')
    stop()
    if (trimmed === '') return
    create.mutate(
      { project_id: projectId, name: trimmed },
      {
        onSuccess: (created) => {
          if (anchor === '__end__') return
          const ids = sections.map((s) => s.id)
          ids.splice(insertIndex(anchor, sections), 0, created.id)
          const currentOrder = new Map(sections.map((s) => [s.id, s.section_order]))
          currentOrder.set(created.id, created.section_order)
          ids.forEach((id, i) => {
            if (currentOrder.get(id) !== i) update.mutate({ id, patch: { section_order: i } })
          })
        },
      },
    )
  }

  const cancel = (): void => {
    setName('')
    stop()
  }

  if (active) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Input
          autoFocus
          aria-label="Section name"
          placeholder="Name this section"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          className="max-w-xs font-medium"
        />
        <Button size="sm" onClick={submit} disabled={name.trim() === ''}>
          Add section
        </Button>
        <Button size="sm" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="group/add flex h-6 w-full items-center gap-2 text-accent"
      onClick={() => startAddSection(anchor)}
      aria-label="Add section"
    >
      <span className="h-px flex-1 bg-border opacity-0 transition-opacity group-hover/add:opacity-100" />
      <span className="flex items-center gap-1 font-medium text-caption opacity-0 transition-opacity group-hover/add:opacity-100">
        <Plus size={16} aria-hidden /> Add section
      </span>
      <span className="h-px flex-1 bg-border opacity-0 transition-opacity group-hover/add:opacity-100" />
    </button>
  )
}
