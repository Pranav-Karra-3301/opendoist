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
 * the dialog) so text stays the single source of truth — never a parallel state tree. The anchoring
 * `context` is expressed AS TEXT via {@link initialTextFromContext}: `#project` (+ `/section`) for
 * Inbox/Project rows, or the ISO `dueDate` for Today/Upcoming rows. Because the context lives in the
 * text, Enter saves through the same `/tasks/quick` path the dialog uses (the server re-parses the
 * whole line), keeps the composer open, and re-applies the context (Todoist save-and-new). A
 * detokenized draft can't ride the re-parsing endpoint, so — exactly like the dialog — it falls
 * back to the structured `/tasks` create built by `toCreatePayload`. Esc, the Cancel button, or a
 * blur with no task name typed calls `onClose`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProjectMutations } from '@/api/hooks/projects'
import { useTaskMutations } from '@/api/hooks/tasks'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'
import { useAutocompleteResources } from './autocomplete'
import { ChipRow } from './chip-row'
import { QuickAddInput, type QuickAddInputHandle } from './quick-add-input'
import {
  EMPTY_QUICK_ADD_STATE,
  needsStructuredSubmit,
  parseState,
  pruneIgnored,
  type QuickAddState,
  toCreatePayload,
} from './quick-add-model'

/** Resolved context names (IDs mapped to display names) that seed the composer's text. */
export interface ComposerContextNames {
  projectName?: string
  sectionName?: string
  dueDate?: string
}

/** Quote a sigil name that contains whitespace so a multi-word project/section survives the
 *  parser's `#"…"` / `/"…"` grammar; embedded quotes are dropped (they can't round-trip). */
function sigilToken(sigil: '#' | '/', name: string): string {
  const clean = name.replace(/"/g, '')
  return /\s/.test(clean) ? `${sigil}"${clean}"` : `${sigil}${clean}`
}

/**
 * Map a list-row context to the composer's INITIAL TEXT. Text is the single source of truth, so the
 * anchoring context is expressed as tokens the parser re-reads: `#project` (+ `/section`, honoured
 * only beside a project) for Inbox/Project rows, or the ISO `dueDate` for Today/Upcoming rows. A
 * trailing space keeps the caret clear of the tokens so the next keystroke starts the title. Empty
 * context → empty text.
 */
export function initialTextFromContext(ctx: ComposerContextNames): string {
  const parts: string[] = []
  const project = ctx.projectName?.trim()
  const section = ctx.sectionName?.trim()
  const dueDate = ctx.dueDate?.trim()
  if (project) {
    parts.push(sigilToken('#', project))
    if (section) parts.push(sigilToken('/', section))
  }
  if (dueDate) parts.push(dueDate)
  return parts.length === 0 ? '' : `${parts.join(' ')} `
}

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
  const initialText = useMemo(
    () => initialTextFromContext({ projectName, sectionName, dueDate: context.dueDate }),
    [projectName, sectionName, context.dueDate],
  )

  const [state, setState] = useState<QuickAddState>(EMPTY_QUICK_ADD_STATE)
  const { parsed, activeTokens } = useMemo(() => parseState(state, ctx), [state, ctx])

  const setText = (text: string): void =>
    setState((s) => pruneIgnored({ text, ignored: s.ignored }, ctx))

  /** Re-seed the input with the context text, caret parked past the tokens (drives focus too).
   *  The `''` reset first clears any detokenized spans and guarantees the value changes so the
   *  input's caret-restore layout effect fires. */
  const resetToContext = useCallback((): void => {
    setState(EMPTY_QUICK_ADD_STATE)
    inputRef.current?.setValueWithCaret(initialText, initialText.length)
  }, [initialText])

  // Seed the composer once its context text is known (project names may resolve a beat after mount).
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (initialText === '' || seededFor.current === initialText) return
    seededFor.current = initialText
    resetToContext()
  }, [initialText, resetToContext])

  const canSubmit = parsed.title.trim() !== ''

  const submit = async (keepOpen: boolean): Promise<void> => {
    if (!canSubmit) return
    try {
      if (needsStructuredSubmit(state)) {
        const { payload, missing } = toCreatePayload(parsed, {
          projects: resources.projects,
          sections: resources.sections,
          labels: resources.labels,
        })
        for (const name of missing.projects) {
          const created = await projectMut.create.mutateAsync({ name })
          if (parsed.project && parsed.project.toLowerCase() === name.toLowerCase()) {
            payload.project_id = created.id
          }
        }
        await taskMut.create.mutateAsync(payload)
      } else {
        await taskMut.quickAdd.mutateAsync({ text: state.text })
      }
    } catch {
      // The mutation surfaces the failure via toast; keep the draft so the user can retry.
      return
    }
    if (keepOpen) resetToContext()
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
          parsed={parsed}
          activeTokens={activeTokens}
          ctx={ctx}
          onEdit={(text, caret) => inputRef.current?.setValueWithCaret(text, caret)}
        />
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-sm px-3 text-copy text-text-secondary hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
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
