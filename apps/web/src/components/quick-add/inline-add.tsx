/**
 * Inline "+ Add task" affordance views render at the bottom (or top) of a list. Collapsed it is a
 * single accent row; expanded it reuses the Quick Add input + chip row inside a card. Enter saves
 * and keeps the composer open (Todoist behaviour); Cmd/Ctrl+Enter saves and collapses; Escape
 * collapses. `defaults` (project/section/due for e.g. an Upcoming day) apply AFTER the parse, so
 * explicit tokens the user types always win.
 */
import { Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useProjectMutations } from '@/api/hooks/projects'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { TaskCreate } from '@/api/schemas'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'
import { useAutocompleteResources } from './autocomplete'
import { ChipRow } from './chip-row'
import { QuickAddInput, type QuickAddInputHandle } from './quick-add-input'
import {
  EMPTY_QUICK_ADD_STATE,
  parseState,
  pruneIgnored,
  type QuickAddState,
  toCreatePayload,
} from './quick-add-model'

/** FROZEN props (Task A). */
export interface InlineAddProps {
  defaults: Partial<TaskCreate>
  placement: 'top' | 'bottom'
  onDone?: () => void
}

export function InlineAdd({ defaults, placement, onDone }: InlineAddProps) {
  const [expanded, setExpanded] = useState(false)
  const [state, setState] = useState<QuickAddState>(EMPTY_QUICK_ADD_STATE)
  const ctx = useParseCtx()
  const resources = useAutocompleteResources()
  const taskMut = useTaskMutations()
  const projectMut = useProjectMutations()
  const inputRef = useRef<QuickAddInputHandle>(null)

  const { parsed, activeTokens } = useMemo(() => parseState(state, ctx), [state, ctx])

  const setText = (text: string): void =>
    setState((s) => pruneIgnored({ text, ignored: s.ignored }, ctx))

  const collapse = (): void => {
    setState(EMPTY_QUICK_ADD_STATE)
    setExpanded(false)
    onDone?.()
  }

  const submit = async (keepOpen: boolean): Promise<void> => {
    if (parsed.title.trim() === '') return
    const { payload, missing } = toCreatePayload(parsed, {
      projects: resources.projects,
      sections: resources.sections,
      labels: resources.labels,
    })
    const merged: TaskCreate = { ...defaults, ...payload }
    try {
      for (const name of missing.projects) {
        const created = await projectMut.create.mutateAsync({ name })
        if (parsed.project && parsed.project.toLowerCase() === name.toLowerCase()) {
          merged.project_id = created.id
        }
      }
      await taskMut.create.mutateAsync(merged)
    } catch {
      // create.onError (Task B) surfaces the problem; keep the draft for retry.
      return
    }
    setState(EMPTY_QUICK_ADD_STATE)
    if (keepOpen) inputRef.current?.focus()
    else collapse()
  }

  if (!expanded) {
    return (
      <button
        type="button"
        data-placement={placement}
        onClick={() => setExpanded(true)}
        className="group flex h-9 w-full items-center gap-2 rounded-sm px-[5px] text-left text-body text-text-secondary transition-colors duration-150 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
      >
        <Plus size={18} className="text-accent" aria-hidden />
        Add task
      </button>
    )
  }

  const canSubmit = parsed.title.trim() !== ''

  return (
    <div
      data-placement={placement}
      className="rounded-lg border border-border bg-surface-raised p-3 [box-shadow:var(--shadow-menu)]"
    >
      <QuickAddInput
        handleRef={inputRef}
        value={state.text}
        onChange={setText}
        activeTokens={activeTokens}
        projectContext={parsed.project}
        resources={resources}
        onIgnoreToken={(token) =>
          setState((s) => ({
            text: s.text,
            ignored: s.ignored.some((i) => i.start === token.start && i.text === token.text)
              ? s.ignored
              : [...s.ignored, { start: token.start, end: token.end, text: token.text }],
          }))
        }
        onEnter={() => void submit(true)}
        onCmdEnter={() => void submit(false)}
        onEscape={collapse}
        autoFocus
      />
      {parsed.description !== null && (
        <p className="mt-1 truncate text-copy text-text-secondary">{parsed.description}</p>
      )}
      <div className="mt-3">
        <ChipRow
          text={state.text}
          parsed={parsed}
          activeTokens={activeTokens}
          ctx={ctx}
          onEdit={(text, caret) => inputRef.current?.setValueWithCaret(text, caret)}
        />
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={collapse}
          className="h-8 rounded-sm px-3 text-copy text-text-secondary hover:bg-hover hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit(true)}
          className={cn(
            'h-8 rounded-sm bg-accent px-3 font-medium text-copy text-on-accent transition-colors duration-300 ease-standard hover:bg-accent-hover',
            'disabled:cursor-not-allowed disabled:bg-accent-disabled',
          )}
        >
          Add task
        </button>
      </div>
    </div>
  )
}
