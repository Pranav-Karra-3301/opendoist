/**
 * Desktop-only pairing / onboarding screen (Task B). Shown by `useDesktopGate` when the
 * app runs in the Tauri shell and no instance is paired yet. It collects the self-hosted
 * instance URL + an `od_` API token, verifies them against the live server over the
 * tauri-plugin-http transport (Rust reqwest — no browser CORS), persists the pair through
 * the frozen `saveDesktopSession` contract, and calls `onPaired` so the gate swaps in the
 * real app.
 *
 * Verification order mirrors the plan:
 *   1. GET  {url}/api/v1/info  — is this a reachable OpenDoist instance?
 *   2. GET  {url}/api/v1/user  with the bearer — is the token valid? (401 → rejected)
 * The token is only ever sent in the `Authorization` header — never logged, echoed, or
 * placed in a URL.
 */
import { type FormEvent, useState } from 'react'
import { endpoints } from '@/api/client'
import { saveDesktopSession } from '@/api/desktop-session'
import { resolveTransport } from '@/api/transport'
import { AuthField, AuthShell } from '@/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeInstanceUrl, normalizeToken } from './session-store'

/** API version prefix (mirrors the private `BASE` in api/client.ts). The instance URL is
 *  the user-supplied origin; the leaf paths come from the frozen `endpoints` map. */
const API_VERSION = '/api/v1'

export interface PairingScreenProps {
  /** Invoked once the pair is verified and persisted, so the gate renders the app. */
  onPaired: () => void
}

/**
 * Ask macOS for native-notification permission at pairing completion (plan Task D Step 2):
 * the reminders watcher needs it granted, and the OS prompt lands best right after this
 * deliberate user action. Fire-and-forget — a denial or failure never blocks pairing, and
 * Settings → General → Desktop app offers a retry.
 */
function requestNotificationPermission(): void {
  void (async () => {
    try {
      const { isPermissionGranted, requestPermission } = await import(
        '@tauri-apps/plugin-notification'
      )
      if (!(await isPermissionGranted())) await requestPermission()
    } catch {
      // Optional nicety only — the settings surface can re-request later.
    }
  })()
}

export function PairingScreen({ onPaired }: PairingScreenProps) {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    // Validate + normalize BEFORE any network call, so bad input gives an immediate,
    // human-readable reason (and the store is never touched).
    let instanceUrl: string
    let apiToken: string
    try {
      instanceUrl = normalizeInstanceUrl(url)
      apiToken = normalizeToken(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please check the URL and token.')
      return
    }

    setPending(true)
    try {
      const transport = await resolveTransport()

      // 1. Reachable OpenDoist instance? A thrown error means we never connected.
      let info: Response
      try {
        info = await transport(`${instanceUrl}${API_VERSION}${endpoints.info}`, { method: 'GET' })
      } catch {
        throw new Error('Could not reach the instance. Check the URL and your network.')
      }
      if (!info.ok) {
        throw new Error(`No OpenDoist instance answered at that URL (HTTP ${info.status}).`)
      }

      // 2. Valid token? 401 is the server's "bad/expired token" signal.
      const user = await transport(`${instanceUrl}${API_VERSION}${endpoints.user}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${apiToken}` },
      })
      if (user.status === 401) {
        throw new Error('That API token was rejected. Check you copied the whole od_ token.')
      }
      if (!user.ok) {
        throw new Error(`Could not verify the token (HTTP ${user.status}).`)
      }

      // 3. Persist the verified pair and hand control back to the gate. Leave `pending`
      //    true — the gate unmounts this screen, so no post-unmount state update runs.
      await saveDesktopSession(instanceUrl, apiToken)
      requestNotificationPermission()
      onPaired()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pairing failed. Please try again.')
      setPending(false)
    }
  }

  const disabled = pending || url.trim() === '' || token.trim() === ''

  return (
    <AuthShell
      title="Connect OpenDoist"
      subtitle="Pair this app with your self-hosted instance to get started."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <AuthField id="pairing-url" label="Instance URL">
          <Input
            id="pairing-url"
            name="instance-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://tasks.example.com"
            required
            autoFocus
            value={url}
            disabled={pending}
            onChange={(event) => setUrl(event.target.value)}
          />
        </AuthField>
        <div className="flex flex-col gap-1.5">
          <AuthField id="pairing-token" label="API token">
            <Input
              id="pairing-token"
              name="api-token"
              type="password"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="od_…"
              required
              value={token}
              disabled={pending}
              onChange={(event) => setToken(event.target.value)}
            />
          </AuthField>
          <p className="text-caption text-text-tertiary">
            Create one in your instance under Settings → Integrations.
          </p>
        </div>
        {error !== null && (
          <p role="alert" className="text-copy text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={disabled} aria-busy={pending}>
          {pending ? 'Connecting…' : 'Connect'}
        </Button>
      </form>
    </AuthShell>
  )
}
