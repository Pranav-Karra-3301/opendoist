/**
 * Voice & AI integrations (plan Task L) — two provider cards mounted inside Settings →
 * Integrations: "Speech-to-text" (STT slot) and "Task extraction (LLM)" (LLM slot). Each card
 * lets the user override the instance-wide env defaults for their own account, test the
 * connection before saving, and store an API key that is AES-GCM-encrypted server-side and never
 * returned to the browser (the view only reports `hasApiKey`).
 *
 * Wire model (frozen `@/api/rambles`, camelCase): a slot's effective config comes from
 * `source: 'user' | 'env' | 'none'`. The form only ever represents the USER override —
 * "Instance default" clears the slot (`provider: null`, reverts to env), a real provider id
 * configures it, and the LLM-only "None (single task)" opts out of extraction. Saving PUTs just
 * the dirty slot; the mutation invalidates the query, so a fresh view re-seeds the form and
 * clears the dirty state.
 *
 * File placement note (AS-BUILT): the plan named `apps/web/src/settings/`, but the real settings
 * feature lives under `apps/web/src/features/settings/` — this sits beside `CalendarFeedCard.tsx`
 * and is mounted by `pages/IntegrationsPage.tsx`, matching the phase-5/6 pattern.
 */
import { Check, CircleAlert, Loader2, Zap } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  type IntegrationSlot,
  type IntegrationSlotPatch,
  testIntegration,
  useIntegrations,
  useSaveIntegrations,
} from '@/api/rambles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { SettingsSection } from './ui'

type Kind = 'stt' | 'llm'

/** Sentinel select value for "use the instance (env) default" — maps to `provider: null`. */
const INSTANCE_DEFAULT = 'default'
/** LLM-only opt-out select value — maps to `provider: 'none'` (transcript → single task). */
const LLM_NONE = 'none'

interface ProviderOption {
  value: string
  label: string
}

const STT_OPTIONS: readonly ProviderOption[] = [
  { value: INSTANCE_DEFAULT, label: 'Instance default' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
]
const LLM_OPTIONS: readonly ProviderOption[] = [
  { value: INSTANCE_DEFAULT, label: 'Instance default' },
  { value: LLM_NONE, label: 'None (single task)' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
]

/** Model input placeholder keyed by `${kind}:${provider}`. */
const MODEL_PLACEHOLDER: Record<string, string> = {
  'stt:openai-compatible': 'gpt-4o-mini-transcribe',
  'stt:deepgram': 'nova-3',
  'stt:elevenlabs': 'scribe_v1',
  'llm:openai-compatible': 'gpt-4o-mini',
}
const KEY_PLACEHOLDER: Record<string, string> = {
  'openai-compatible': 'sk-…',
  deepgram: 'Deepgram API key',
  elevenlabs: 'ElevenLabs API key',
}
/** Providers that show the Base URL field up front; the rest hide it behind "Advanced". */
const BASE_URL_UP_FRONT = new Set(['openai-compatible'])

interface SlotForm {
  /** provider id, or the INSTANCE_DEFAULT / LLM_NONE sentinels */
  choice: string
  baseUrl: string
  model: string
  /** a freshly typed key ('' = untouched) */
  apiKey: string
  /** user asked to remove the stored key */
  clearKey: boolean
  advancedOpen: boolean
}

/** Seed a form from the server view. Only a `source === 'user'` slot carries an override. */
function deriveForm(kind: Kind, slot: IntegrationSlot): SlotForm {
  const isUser = slot.source === 'user'
  let choice = INSTANCE_DEFAULT
  if (isUser) {
    if (kind === 'llm' && slot.provider === null) choice = LLM_NONE
    else if (slot.provider !== null) choice = slot.provider
  }
  return {
    choice,
    baseUrl: isUser ? (slot.baseUrl ?? '') : '',
    model: isUser ? (slot.model ?? '') : '',
    apiKey: '',
    clearKey: false,
    advancedOpen: false,
  }
}

/** Stable string identity of the server slot, so we only re-seed when its values change. */
function slotSignature(slot: IntegrationSlot): string {
  return JSON.stringify([slot.provider, slot.baseUrl, slot.model, slot.hasApiKey, slot.source])
}

function isRealProvider(choice: string): boolean {
  return choice !== INSTANCE_DEFAULT && choice !== LLM_NONE
}

/** Translate the local form into the PUT patch for this slot. */
function toPatch(kind: Kind, form: SlotForm): IntegrationSlotPatch {
  if (form.choice === INSTANCE_DEFAULT) {
    // provider:null clears every column of the slot server-side (reverts to env default).
    return { provider: null, baseUrl: null, model: null }
  }
  if (kind === 'llm' && form.choice === LLM_NONE) {
    // Explicit opt-out override. The server (Task H/I) treats an llm value of 'none' as passthrough
    // and reports it back as `{ provider: null, source: 'user' }`, which deriveForm restores to
    // LLM_NONE — distinct from Instance default (`provider: null`, source 'env'/'none').
    return { provider: LLM_NONE, baseUrl: null, model: null }
  }
  const patch: IntegrationSlotPatch = {
    provider: form.choice,
    baseUrl: form.baseUrl.trim() === '' ? null : form.baseUrl.trim(),
    model: form.model.trim() === '' ? null : form.model.trim(),
  }
  // apiKey: null = clear, a string = set, absent = keep the stored key.
  if (form.clearKey) patch.apiKey = null
  else if (form.apiKey !== '') patch.apiKey = form.apiKey
  return patch
}

function instanceDefaultHelp(kind: Kind, slot: IntegrationSlot): string {
  if (slot.source === 'env' && slot.provider !== null) {
    const model = slot.model !== null && slot.model !== '' ? ` / ${slot.model}` : ''
    return `Using instance default: ${slot.provider}${model}`
  }
  return kind === 'llm'
    ? 'Not configured — each recording becomes a single task.'
    : 'Not configured — set a provider to enable voice capture.'
}

export default function IntegrationsVoiceSettings() {
  const integrations = useIntegrations()

  if (integrations.isLoading || !integrations.data) {
    return (
      <SettingsSection
        title="Voice & AI"
        description="Choose the speech-to-text and task-extraction providers used by Ramble voice capture."
      >
        <div className="px-4 py-6 text-copy text-text-tertiary">
          {integrations.isError
            ? 'Could not load voice & AI settings. Reload the page to try again.'
            : 'Loading voice & AI settings…'}
        </div>
      </SettingsSection>
    )
  }

  const data = integrations.data
  return (
    <>
      <SlotCard
        kind="stt"
        slot={data.stt}
        options={STT_OPTIONS}
        title="Speech-to-text"
        description="Transcribes your voice recordings. Required for the microphone button in Quick Add."
      />
      <SlotCard
        kind="llm"
        slot={data.llm}
        options={LLM_OPTIONS}
        title="Task extraction (LLM)"
        description="Optionally splits a transcript into separate tasks with due dates and priorities. Without it, each recording becomes a single task."
      />
      <p className="mb-8 max-w-prose text-caption text-text-tertiary">
        Keys are stored encrypted on this server and never sent to the browser.{' '}
        <a
          href="/docs/voice-ramble.md"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline-offset-4 hover:underline"
        >
          Self-hosting a local transcriber →
        </a>
      </p>
    </>
  )
}

function SlotCard({
  kind,
  slot,
  options,
  title,
  description,
}: {
  kind: Kind
  slot: IntegrationSlot
  options: readonly ProviderOption[]
  title: string
  description: string
}) {
  const save = useSaveIntegrations()
  const sig = slotSignature(slot)

  const [form, setForm] = useState<SlotForm>(() => deriveForm(kind, slot))
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string | null } | null>(null)
  const [testing, setTesting] = useState(false)

  // Re-seed the form (clearing edits + any typed key + stale test result) whenever the server
  // slot actually changes — e.g. after a successful Save invalidates the query.
  const seededSig = useRef(sig)
  useEffect(() => {
    if (seededSig.current !== sig) {
      seededSig.current = sig
      setForm(deriveForm(kind, slot))
      setTestResult(null)
    }
  }, [sig, kind, slot])

  const patchForm = (partial: Partial<SlotForm>) => {
    setForm((f) => ({ ...f, ...partial }))
    setTestResult(null)
  }

  const base = deriveForm(kind, slot)
  const real = isRealProvider(form.choice)
  const dirty =
    form.choice !== base.choice ||
    (real &&
      (form.baseUrl.trim() !== base.baseUrl.trim() ||
        form.model.trim() !== base.model.trim() ||
        form.apiKey !== '' ||
        form.clearKey))

  const initialHasUserKey = slot.source === 'user' && slot.hasApiKey
  const showSavedKey = initialHasUserKey && form.choice === base.choice && !form.clearKey
  const showBaseUrl = real && (BASE_URL_UP_FRONT.has(form.choice) || form.advancedOpen)

  const onSave = () => {
    const patch = toPatch(kind, form)
    const body = kind === 'stt' ? { stt: patch } : { llm: patch }
    save.mutate(body, {
      onSuccess: () => toast.info(`${title} settings saved.`),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Could not save. Please try again.'),
    })
  }

  const onTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testIntegration(kind, dirty ? toPatch(kind, form) : undefined)
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, detail: err instanceof Error ? err.message : 'Test failed.' })
    } finally {
      setTesting(false)
    }
  }

  const providerId = `${kind}-provider`
  return (
    <SettingsSection title={title} description={description}>
      <div className="grid gap-4 px-4 py-4">
        <Field id={providerId} label="Provider">
          <Select
            value={form.choice}
            onValueChange={(value) => {
              if (value) patchForm({ choice: value })
            }}
            items={options}
          >
            <SelectTrigger id={providerId} className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.choice === INSTANCE_DEFAULT ? (
            <span className="text-caption text-text-tertiary">
              {instanceDefaultHelp(kind, slot)}
            </span>
          ) : null}
          {kind === 'llm' && form.choice === LLM_NONE ? (
            <span className="text-caption text-text-tertiary">
              Extraction is off — the whole transcript becomes one task's description.
            </span>
          ) : null}
        </Field>

        {real ? (
          <div className="grid gap-4">
            {showBaseUrl ? (
              <Field id={`${kind}-base-url`} label="Base URL">
                <Input
                  id={`${kind}-base-url`}
                  value={form.baseUrl}
                  onChange={(event) => patchForm({ baseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="font-mono text-caption"
                />
              </Field>
            ) : (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto justify-self-start px-0"
                onClick={() => patchForm({ advancedOpen: true })}
              >
                Advanced: set a custom base URL
              </Button>
            )}

            <Field id={`${kind}-model`} label="Model">
              <Input
                id={`${kind}-model`}
                value={form.model}
                onChange={(event) => patchForm({ model: event.target.value })}
                placeholder={MODEL_PLACEHOLDER[`${kind}:${form.choice}`] ?? 'Model name'}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="font-mono text-caption"
              />
            </Field>

            <Field
              id={`${kind}-api-key`}
              label="API key"
              hint={showSavedKey ? 'Leave blank to keep the current key.' : undefined}
            >
              <div className="flex items-center gap-2">
                <Input
                  id={`${kind}-api-key`}
                  type="password"
                  value={form.apiKey}
                  onChange={(event) => patchForm({ apiKey: event.target.value, clearKey: false })}
                  placeholder={
                    showSavedKey ? '••••••••  (saved)' : (KEY_PLACEHOLDER[form.choice] ?? 'API key')
                  }
                  autoComplete="off"
                  className="font-mono text-caption"
                />
                {showSavedKey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => patchForm({ clearKey: true, apiKey: '' })}
                  >
                    Clear key
                  </Button>
                ) : null}
              </div>
              {form.clearKey ? (
                <span className="text-caption text-text-tertiary">
                  Saved key will be removed on save.{' '}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => patchForm({ clearKey: false })}
                  >
                    Undo
                  </Button>
                </span>
              ) : null}
            </Field>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => void onTest()} disabled={testing}>
            {testing ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Zap size={14} aria-hidden="true" />
            )}
            {testing ? 'Testing…' : 'Test'}
          </Button>
          <Button type="button" onClick={onSave} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {testResult ? (
            <span
              role="status"
              aria-live="polite"
              className={cn(
                'inline-flex min-w-0 items-start gap-1.5 text-caption',
                testResult.ok ? 'text-success' : 'text-danger',
              )}
            >
              {testResult.ok ? (
                <Check size={14} className="mt-px shrink-0" aria-hidden="true" />
              ) : (
                <CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0">
                {testResult.detail ?? (testResult.ok ? 'Connection OK.' : 'Test failed.')}
              </span>
            </span>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  )
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-medium text-caption text-text-secondary">
        {label}
      </label>
      {children}
      {hint ? <span className="text-caption text-text-tertiary">{hint}</span> : null}
    </div>
  )
}
