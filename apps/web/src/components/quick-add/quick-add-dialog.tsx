/**
 * The `Q` Quick Add dialog: top-anchored, live-highlighted input + chip row + a footer project
 * selector. Enter saves and keeps the dialog open (input clears, brief "Added ✓" flash); Cmd/Ctrl
 * +Enter saves and closes; Escape closes the autocomplete first, then asks to discard a non-empty
 * draft. Detokenized drafts (and non-Inbox targets typed without a `#project`) submit structurally;
 * everything else rides `/tasks/quick`, which re-parses the raw text server-side.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useProjectMutations } from '@/api/hooks/projects'
import { useTaskMutations } from '@/api/hooks/tasks'
import type { Project } from '@/api/schemas'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useParseCtx } from '@/lib/parse-context'
import { cn } from '@/lib/utils'
import { maybeShowReminderPermissionPrompt } from '@/push'
import { useUiStore } from '@/stores/ui'
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

function paletteVar(color: string): string {
  return `var(--od-palette-${color.replaceAll('_', '-')})`
}

export function QuickAddDialog() {
  const open = useUiStore((s) => s.quickAddOpen)
  const setOpen = useUiStore((s) => s.setQuickAddOpen)
  const ctx = useParseCtx()
  const resources = useAutocompleteResources()
  const taskMut = useTaskMutations()
  const projectMut = useProjectMutations()

  const inbox = resources.projects.find((p) => p.is_inbox)
  const [state, setState] = useState<QuickAddState>(EMPTY_QUICK_ADD_STATE)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [flash, setFlash] = useState(false)
  const [defaultProjectId, setDefaultProjectId] = useState<string | undefined>(undefined)
  const inputRef = useRef<QuickAddInputHandle>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { parsed, activeTokens } = useMemo(() => parseState(state, ctx), [state, ctx])

  // Fresh draft each time the dialog opens; default target = Inbox.
  useEffect(() => {
    if (open) {
      setState(EMPTY_QUICK_ADD_STATE)
      setConfirmDiscard(false)
      setFlash(false)
      setDefaultProjectId(inbox?.id)
    }
  }, [open, inbox?.id])

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    },
    [],
  )

  const setText = (text: string): void => {
    setState((s) => pruneIgnored({ text, ignored: s.ignored }, ctx))
    if (confirmDiscard) setConfirmDiscard(false)
  }

  const doClose = (): void => {
    setState(EMPTY_QUICK_ADD_STATE)
    setConfirmDiscard(false)
    setOpen(false)
  }

  const requestClose = (): void => {
    if (state.text.trim() !== '' && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    doClose()
  }

  const flashAdded = (): void => {
    setFlash(true)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(false), 1200)
  }

  const targetProject: Project | undefined = parsed.project
    ? resources.projects.find((p) => p.name.toLowerCase() === parsed.project?.toLowerCase())
    : resources.projects.find((p) => p.id === defaultProjectId)

  const canSubmit = parsed.title.trim() !== ''

  const submit = async (keepOpen: boolean): Promise<void> => {
    if (!canSubmit) return
    const useStructured =
      needsStructuredSubmit(state) ||
      (parsed.project === null && defaultProjectId !== undefined && defaultProjectId !== inbox?.id)
    try {
      if (useStructured) {
        const { payload, missing } = toCreatePayload(parsed, {
          projects: resources.projects,
          sections: resources.sections,
          labels: resources.labels,
        })
        if (payload.project_id === undefined && parsed.project === null) {
          payload.project_id = defaultProjectId
        }
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
      // Task B's mutations surface the problem via toast.error; keep the draft for retry.
      return
    }
    // First-reminder moment (spec §2.5): if the task carried a reminder token, nudge the
    // user toward push notifications (no-ops unless it can actually help).
    if (parsed.reminders.length > 0) {
      maybeShowReminderPermissionPrompt()
    }
    if (keepOpen) {
      setState(EMPTY_QUICK_ADD_STATE)
      setConfirmDiscard(false)
      flashAdded()
      inputRef.current?.focus()
    } else {
      doClose()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (next) {
          setOpen(true)
          return
        }
        // Escape is owned by the input (menu-first, then discard-confirm); focus-out never closes.
        if (details.reason === 'escape-key' || details.reason === 'focus-out') return
        requestClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-24 max-w-[560px] translate-y-0 gap-0 p-0"
      >
        <DialogTitle className="sr-only">Quick add task</DialogTitle>
        <DialogDescription className="sr-only">
          Type a task with natural-language dates, #projects, @labels and p1–p4 priorities.
        </DialogDescription>

        <div className="px-4 pt-4">
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
            onEscape={requestClose}
            autoFocus
            placeholder={flash ? 'Added ✓' : 'Task name'}
          />
          {parsed.description !== null && (
            <p className="mt-1 truncate text-copy text-text-secondary">{parsed.description}</p>
          )}
        </div>

        <div className="px-4 pt-3 pb-3">
          <ChipRow
            text={state.text}
            parsed={parsed}
            activeTokens={activeTokens}
            ctx={ctx}
            onEdit={(text, caret) => inputRef.current?.setValueWithCaret(text, caret)}
          />
        </div>

        {confirmDiscard ? (
          <div className="flex items-center justify-between gap-3 border-border border-t px-4 py-3">
            <span className="text-copy text-text-secondary">Discard this task?</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmDiscard(false)
                  inputRef.current?.focus()
                }}
                className="h-8 rounded-sm px-3 text-copy text-text-secondary hover:bg-hover hover:text-text-primary"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={doClose}
                className="h-8 rounded-sm bg-danger px-3 font-medium text-copy text-on-accent hover:bg-danger-hover"
              >
                Discard
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 border-border border-t px-4 py-3">
            <Popover>
              <PopoverTrigger className="inline-flex h-8 items-center gap-2 rounded-sm px-2 text-copy text-text-secondary hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: paletteVar(targetProject?.color ?? 'grey') }}
                />
                {targetProject?.name ?? 'Inbox'}
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-64 w-56 overflow-y-auto p-1">
                {resources.projects
                  .filter((p) => !p.is_archived)
                  .map((p) => (
                    <PopoverClose
                      key={p.id}
                      onClick={() => setDefaultProjectId(p.id)}
                      className={cn(
                        'flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-copy hover:bg-hover',
                        p.id === targetProject?.id ? 'text-text-primary' : 'text-text-secondary',
                      )}
                    >
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: paletteVar(p.color) }}
                      />
                      {p.name}
                    </PopoverClose>
                  ))}
              </PopoverContent>
            </Popover>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                className="h-8 rounded-sm px-3 text-copy text-text-secondary hover:bg-hover hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submit(false)}
                className="h-8 rounded-sm bg-accent px-3 font-medium text-copy text-on-accent transition-colors duration-300 ease-standard hover:bg-accent-hover disabled:bg-accent-disabled disabled:cursor-not-allowed"
              >
                Add task
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
