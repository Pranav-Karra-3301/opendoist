/**
 * Label picker content (Task F). Bare panel reused by the row popover and the task-detail
 * Labels field (frozen export — Task H imports it). Toggling a label reports the next name
 * array through `onChange`; the surface stays open so several labels can be toggled at once.
 */
import { Check, Plus, Tag } from 'lucide-react'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import { useLabelMutations, useLabels } from '@/api/hooks/labels'
import { paletteVar } from './move-popover'

export interface LabelPanelProps {
  /** Label names currently on the task. */
  value: string[]
  /** Next label-name array after a toggle/create. Caller performs the update. */
  onChange: (labels: string[]) => void
}

export function LabelPanel({ value, onChange }: LabelPanelProps): ReactElement {
  const [query, setQuery] = useState('')
  const { data: labels } = useLabels()
  const { create } = useLabelMutations()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const selected = useMemo(() => new Set(value), [value])
  const q = query.trim()
  const qLower = q.toLowerCase()

  const filtered = useMemo(
    () =>
      (labels ?? [])
        .filter((label) => q === '' || label.name.toLowerCase().includes(qLower))
        .sort((a, b) => a.item_order - b.item_order),
    [labels, q, qLower],
  )

  const exists = useMemo(
    () => selected.has(q) || (labels ?? []).some((label) => label.name.toLowerCase() === qLower),
    [labels, selected, q, qLower],
  )
  const canCreate = q !== '' && !exists

  const toggle = (name: string): void => {
    onChange(selected.has(name) ? value.filter((entry) => entry !== name) : [...value, name])
  }

  const createAndAdd = (): void => {
    create.mutate({ name: q })
    if (!selected.has(q)) onChange([...value, q])
    setQuery('')
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-border-subtle border-b px-1 pb-2">
        <Tag size={16} className="shrink-0 text-text-tertiary" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canCreate) {
              event.preventDefault()
              createAndAdd()
            }
          }}
          placeholder="Type a label…"
          aria-label="Search labels"
          className="h-7 w-full bg-transparent text-copy text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>
      <div className="mt-1 max-h-[280px] overflow-y-auto">
        {filtered.map((label) => {
          const checked = selected.has(label.name)
          return (
            <button
              key={label.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={() => toggle(label.name)}
              className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
            >
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: paletteVar(label.color) }}
                aria-hidden
              />
              <span className="truncate">{label.name}</span>
              {checked && (
                <Check size={16} className="ml-auto shrink-0 text-text-secondary" aria-hidden />
              )}
            </button>
          )
        })}
        {canCreate && (
          <button
            type="button"
            onClick={createAndAdd}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-copy text-text-primary transition-colors duration-150 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
          >
            <Plus size={16} className="shrink-0 text-text-secondary" aria-hidden />
            <span className="truncate">
              Create <span className="font-medium">“{q}”</span>
            </span>
          </button>
        )}
        {filtered.length === 0 && !canCreate && (
          <div className="px-2 py-2 text-caption text-text-tertiary italic">No labels</div>
        )}
      </div>
    </div>
  )
}
