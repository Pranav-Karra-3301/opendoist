/**
 * The desktop Quick Add popover (Task C). A lean, single-purpose capture surface for the
 * frameless, transparent Tauri popover window (summoned by the tray icon or Cmd+Shift+Space):
 * it reuses the web app's live-highlighting Quick Add input + the `@opentask/core` parser,
 * and submits the raw text to `/api/v1/tasks/quick` through the desktop `ApiSession` (the
 * `api` client already routes desktop requests over the tauri-plugin-http transport with the
 * paired bearer token — see api/client.ts + api/desktop-session.ts).
 *
 * Deliberately minimal: no router, no view tree, no react-query — the sigil autocomplete is
 * fed by three direct list fetches, and the token overlay never re-derives on the server. The
 * `/tasks/quick` endpoint re-parses the raw text server-side (auto-creating unknown
 * #projects/@labels), so the popover submits exactly what the user typed and never runs the
 * structured-submit path.
 */
import {
  DEFAULT_PARSE_CONTEXT_SETTINGS,
  DEFAULT_USER_SETTINGS,
  type ParseContext,
  parseQuickAdd,
  UserSettingsSchema,
} from '@opentask/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { ApiError, api, apiAllPages, endpoints } from '@/api/client'
import { getDesktopSession } from '@/api/desktop-session'
import {
  type Label,
  LabelSchema,
  type Project,
  ProjectSchema,
  type Section,
  SectionSchema,
} from '@/api/schemas'
import { isTauri } from '@/api/transport'
import type { AutocompleteResources } from '@/components/quick-add/autocomplete'
import { ChipRowBase } from '@/components/quick-add/chip-row'
import { QuickAddInput, type QuickAddInputHandle } from '@/components/quick-add/quick-add-input'
import './quickadd.css'

/** How long the "Added ✓" confirmation lingers before the popover hides itself (ms). */
const CONFIRM_MS = 650

/**
 * Build a `ParseContext` from the local environment: `Intl` supplies the timezone and the
 * clock supplies `now`; everything else uses core's defaults. The popover has no access to
 * the user's server-side week/smart-date settings (that would mean loading the whole SPA), so
 * these fallbacks drive highlighting — the authoritative re-parse happens server-side.
 */
import { desktopParseContext, submitQuickAdd } from './logic'

export { desktopParseContext, submitQuickAdd } from './logic'

/** Hide the popover window. No-op off-desktop (e.g. the node test env). */
async function hidePopover(): Promise<void> {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().hide()
}

/** Reveal + focus the main SPA window, then hide the popover (blur would hide it anyway, but
 *  do it explicitly so the transition is immediate). Used by the unpaired call-to-action. */
async function openMainWindow(): Promise<void> {
  if (!isTauri()) return
  const { Window, getCurrentWindow } = await import('@tauri-apps/api/window')
  const main = await Window.getByLabel('main')
  await main?.show()
  await main?.setFocus()
  await getCurrentWindow().hide()
}

export function App({ initialText = '' }: { initialText?: string } = {}) {
  const [value, setValue] = useState(initialText)
  const [ctx, setCtx] = useState<ParseContext>(desktopParseContext)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)
  const [busy, setBusy] = useState(false)
  // `null` while the pairing state is still unknown — render the capture UI optimistically and
  // only swap to the call-to-action once we KNOW the instance is unpaired (avoids a splash).
  const [unpaired, setUnpaired] = useState<boolean | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [quickAddPrefs, setQuickAddPrefs] = useState(DEFAULT_USER_SETTINGS.quickAdd)

  const inputRef = useRef<QuickAddInputHandle>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const parsed = useMemo(() => parseQuickAdd(value, ctx), [value, ctx])

  const resources = useMemo<AutocompleteResources>(
    () => ({
      projects,
      sections,
      labels,
      // Selecting a "Create '…'" row creates the entity up front (matches the web app); the
      // server would also auto-create it on submit, but eager creation keeps the local match
      // list correct and mirrors the main Quick Add.
      createProject: async (name) => {
        const p = await api(endpoints.projects, {
          method: 'POST',
          body: { name },
          schema: ProjectSchema,
        })
        setProjects((cur) => [...cur, p])
        return p
      },
      createLabel: async (name) => {
        const l = await api(endpoints.labels, {
          method: 'POST',
          body: { name },
          schema: LabelSchema,
        })
        setLabels((cur) => [...cur, l])
        return l
      },
      createSection: async (name, projectId) => {
        const s = await api(endpoints.sections, {
          method: 'POST',
          body: { project_id: projectId, name },
          schema: SectionSchema,
        })
        setSections((cur) => [...cur, s])
        return s
      },
    }),
    [projects, sections, labels],
  )

  const loadResources = useCallback(async (): Promise<void> => {
    try {
      const [p, s, l] = await Promise.all([
        apiAllPages(endpoints.projects, ProjectSchema),
        apiAllPages(endpoints.sections, SectionSchema),
        apiAllPages(endpoints.labels, LabelSchema),
      ])
      setProjects(p)
      setSections(s)
      setLabels(l)
    } catch {
      // Offline or transient failure: leave the lists empty. Highlighting + raw submit still
      // work; the sigil menu simply has nothing to match until the next successful refresh.
    }
    try {
      // Chip prefs ride the same refresh so the popover's chip row mirrors the user's
      // configured chips; on failure the defaults stay (the row still renders fully).
      const settings = await api(endpoints.userSettings, { schema: UserSettingsSchema })
      setQuickAddPrefs(settings.quickAdd)
    } catch {
      // Defaults remain.
    }
  }, [])

  const refreshPairing = useCallback(async (): Promise<boolean> => {
    const session = await getDesktopSession()
    const paired = session !== null
    setUnpaired(!paired)
    return paired
  }, [])

  // First mount: learn the pairing state and prime the autocomplete lists. Desktop-only —
  // under the node test env (`isTauri()` false) this never runs.
  useEffect(() => {
    if (!isTauri()) return
    void refreshPairing().then((paired) => {
      if (paired) void loadResources()
    })
  }, [refreshPairing, loadResources])

  // Each time the popover is re-summoned it regains focus: refocus the field, refresh the
  // clock-based ParseContext (so "tomorrow" stays correct across days), clear stale status,
  // and re-check pairing (the user may have just paired in the main window).
  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          if (!focused) return
          setCtx(desktopParseContext())
          setError(null)
          setFlash(false)
          inputRef.current?.focus()
          void refreshPairing().then((paired) => {
            if (paired) void loadResources()
          })
        })
        .then((fn) => {
          if (disposed) fn()
          else unlisten = fn
        }),
    )
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [refreshPairing, loadResources])

  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    },
    [],
  )

  const handleSubmit = useCallback(async (): Promise<void> => {
    const text = value.trim()
    if (text === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await submitQuickAdd(text)
    } catch (err) {
      setBusy(false)
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach your instance. Check your connection and try again.',
      )
      return
    }
    // Success: clear the draft, flash a confirmation, then hide after a beat.
    setBusy(false)
    setValue('')
    setFlash(true)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => {
      setFlash(false)
      void hidePopover()
    }, CONFIRM_MS)
  }, [value, busy])

  // Escape is an explicit dismiss: discard the draft and hide. (A blur-driven hide, by
  // contrast, is handled in Rust and leaves the draft intact for the next summon.)
  const handleEscape = useCallback((): void => {
    setValue('')
    setError(null)
    void hidePopover()
  }, [])

  if (unpaired === true) {
    return (
      <div className="qa-frame">
        <div className="qa-card qa-card--message">
          <p className="qa-message-title">Not connected</p>
          <p className="qa-message-body">
            Open OpenTask and pair this app with your instance to capture tasks from here.
          </p>
          <button type="button" className="qa-open-main" onClick={() => void openMainWindow()}>
            Open OpenTask
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="qa-frame">
      <div className="qa-card">
        <div className="qa-input">
          <QuickAddInput
            handleRef={inputRef}
            value={value}
            onChange={(text) => {
              setValue(text)
              if (error !== null) setError(null)
              if (flash) setFlash(false)
            }}
            activeTokens={parsed.tokens}
            projectContext={parsed.project}
            resources={resources}
            // Detokenization is meaningless here — the server re-parses the raw text — so the
            // click-to-remove affordance is intentionally inert.
            onIgnoreToken={() => {}}
            onEnter={() => void handleSubmit()}
            onCmdEnter={() => void handleSubmit()}
            onEscape={handleEscape}
            autoFocus
            placeholder={flash ? 'Added ✓' : 'Add a task…'}
            className="qa-textarea"
          />
          {parsed.description !== null && <p className="qa-description">{parsed.description}</p>}
        </div>
        {/* The main dialog's chip row ("the filters"), settings-free: same chips, same
            pickers, editing the same raw text through the same caret contract. */}
        <ChipRowBase
          text={value}
          parsed={parsed}
          activeTokens={parsed.tokens}
          ctx={ctx}
          chips={quickAddPrefs.chips}
          labeled={quickAddPrefs.labeled}
          onEdit={(text, caret) => inputRef.current?.setValueWithCaret(text, caret)}
        />
        <div className="qa-status" role="status" aria-live="polite">
          {error !== null ? <span className="qa-error">{error}</span> : null}
        </div>
        <div className="qa-footer">
          <span>
            <kbd>↵</kbd> Add
          </span>
          <span>
            <kbd>esc</kbd> Cancel
          </span>
        </div>
      </div>
    </div>
  )
}
