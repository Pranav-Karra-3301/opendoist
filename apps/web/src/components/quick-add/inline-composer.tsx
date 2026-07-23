/**
 * InlineComposer — the list-anchored Quick Add composer (Task H).
 *
 * Task H's rule: list-anchored triggers (an in-list "+ Add task" row, or `a`/`Shift+A` in a list
 * view) swap in THIS inline composer; global triggers (`q`, Space from the body, the sidebar Add
 * button, the palette command) open the centered {@link QuickAddDialog}. The composer is only the
 * expanded card — the "+ Add task" row and the row↔composer swap are owned by the CALLER (the view);
 * `onClose` means "restore that row".
 *
 * It reuses `QuickAddInput` + `ChipRow` (the SAME caret-anchored autocomplete and chip pickers as
 * the dialog), and TYPED text stays the single source of truth for everything the user wrote. The
 * anchoring `context` (Today/Upcoming date, project/section) is a Todoist-style PRESET: it never
 * appears in the input, the chips display it (via {@link applyComposerContext}), an explicit token
 * overrides it, and the date chip's "No date" clears it. On save the quick path submits the typed
 * line plus the non-overridden context re-expressed as tokens ({@link composerSubmitText}), so the
 * server's `/tasks/quick` re-parse — reminders included — still sees one plain line; save-and-new
 * keeps the composer open with the preset re-applied. A detokenized draft can't ride the
 * re-parsing endpoint, so — exactly like the dialog — it falls back to the structured `/tasks`
 * create built from the context-merged parse. Esc, the Cancel button, or a blur with no task name
 * typed calls `onClose`.
 */
import { useMemo, useRef, useState } from 'react'
import { useProjectMutations } from '@/api/hooks/projects'
import { useTaskMutations } from '@/api/hooks/tasks'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'
import { useAutocompleteResources } from './autocomplete'
import { ChipRow } from './chip-row'
import { QuickAddInput, type QuickAddInputHandle } from './quick-add-input'
import {
  applyComposerContext,
  type ComposerContextNames,
  composerSubmitText,
  EMPTY_QUICK_ADD_STATE,
  needsStructuredSubmit,
  parseState,
  pruneIgnored,
  type QuickAddState,
  toCreatePayload,
} from './quick-add-model'

export interface InlineComposerContext {
  projectId?: string
  sectionId?: string
  dueDate?: string
}

export function InlineComposer({
  context,
  onClose,
}: {
  context: InlineComposerContext
  onClose: () => void
}) {
  const ctx = useParseCtx()
  const resources = useAutocompleteResources()
  const taskMut = useTaskMutations()
  const projectMut = useProjectMutations()
  const inputRef = useRef<QuickAddInputHandle>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const projectName = context.projectId
    ? resources.projects.find((p) => p.id === context.projectId)?.name
    : undefined
  const sectionName = context.sectionId
    ? resources.sections.find((s) => s.id === context.sectionId)?.name
    : undefined
  const names: ComposerContextNames = useMemo(
    () => ({ projectName, sectionName, dueDate: context.dueDate }),
    [projectName, sectionName, context.dueDate],
  )

  const [state, setState] = useState<QuickAddState>(EMPTY_QUICK_ADD_STATE)
  // The date preset survives typing but not an explicit chip "No date" (Todoist parity).
  const [contextDueCleared, setContextDueCleared] = useState(false)
  const { parsed, activeTokens } = useMemo(() => parseState(state, ctx), [state, ctx])
  /** What the chips show and the structured path saves: typed values + non-overridden context. */
  const merged = useMemo(
    () => applyComposerContext(parsed, names, { due: contextDueCleared }),
    [parsed, names, contextDueCleared],
  )

  const setText = (text: string): void =>
    setState((s) => pruneIgnored({ text, ignored: s.ignored }, ctx))

  /** Save-and-new: back to an empty input with the context preset re-applied. */
  const resetComposer = (): void => {
    setState(EMPTY_QUICK_ADD_STATE)
    setContextDueCleared(false)
    inputRef.current?.setValueWithCaret('', 0)
  }

  const canSubmit = parsed.title.trim() !== ''

  const submit = async (keepOpen: boolean): Promise<void> => {
    if (!canSubmit) return
    try {
      if (needsStructuredSubmit(state)) {
        const { payload, missing } = toCreatePayload(merged, {
          projects: resources.projects,
          sections: resources.sections,
          labels: resources.labels,
        })
        for (const name of missing.projects) {
          const created = await projectMut.create.mutateAsync({ name })
          if (merged.project && merged.project.toLowerCase() === name.toLowerCase()) {
            payload.project_id = created.id
          }
        }
        await taskMut.create.mutateAsync(payload)
      } else {
        await taskMut.quickAdd.mutateAsync({
          text: composerSubmitText(state, parsed, activeTokens, names, {
            due: contextDueCleared,
          }),
        })
      }
    } catch {
      // The mutation surfaces the failure via toast; keep the draft so the user can retry.
      return
    }
    if (keepOpen) resetComposer()
    else onClose()
  }

  /** Blur that lands outside the composer (and its portaled autocomplete/chip popovers) closes an
   *  untouched composer — a draft with a real task name is kept so an accidental click never loses
   *  it. `relatedTarget` is null across some portals, so re-check the settled focus on the next frame. */
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    const stillInside = (node: Element | null): boolean =>
      node !== null &&
      (cardRef.current?.contains(node) === true ||
        node.closest('[data-quickadd-popover]') !== null ||
        node.closest('[data-slot="popover-content"]') !== null)
    if (event.relatedTarget instanceof Element && stillInside(event.relatedTarget)) return
    requestAnimationFrame(() => {
      if (stillInside(document.activeElement)) return
      if (parsed.title.trim() === '') onClose()
    })
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: onBlur here is focus-management (auto-dismiss an untouched composer when focus leaves the card), not a pointer interaction, so no widget role applies
    <div
      ref={cardRef}
      data-slot="inline-composer"
      onBlur={handleBlur}
      className="rounded-sm border border-border bg-surface-raised p-2 [box-shadow:var(--shadow-menu)]"
    >
      <div className="px-[3px]">
        <QuickAddInput
          handleRef={inputRef}
          value={state.text}
          onChange={setText}
          activeTokens={activeTokens}
          projectContext={merged.project}
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
          onEscape={onClose}
          autoFocus
        />
        {parsed.description !== null && (
          <p className="mt-1 truncate text-copy text-text-secondary">{parsed.description}</p>
        )}
      </div>
      <div className="mt-3 px-[3px]">
        <ChipRow
          text={state.text}
          parsed={merged}
          activeTokens={activeTokens}
          ctx={ctx}
          onEdit={(text, caret) => inputRef.current?.setValueWithCaret(text, caret)}
          onClearContext={(kind) => {
            if (kind === 'due') setContextDueCleared(true)
          }}
        />
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-sm px-3 text-copy text-text-secondary hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-focus-ring)]"
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
