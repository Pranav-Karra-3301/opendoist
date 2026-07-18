/**
 * Desktop-only settings affordances (plan Task D Step 2):
 *  - `AutostartToggle` — launch-at-login, backed by `@tauri-apps/plugin-autostart`.
 *  - `NotificationsSetting` — native-notification permission status + a request button.
 *  - `DesktopSettings` — a turnkey settings section wrapping both; render it from any
 *    settings page with `{isTauri() && <DesktopSettings />}` (one import, one line).
 *
 * Every Tauri plugin is pulled in through a dynamic `import()` (mirrors
 * `../api/transport.ts` / `./session-store.ts`) so the web bundle never statically links any
 * Tauri code, and each component is inert on the web (`DesktopSettings` renders `null` there).
 *
 * Coordination note: the plan also asks to request notification permission "at pairing
 * completion". That lives in Task B's `PairingScreen.tsx`, which Task D does not own; the
 * request button here is the same call from the settings surface Task D does own, so a user
 * can always (re-)grant permission from Settings.
 */
import { useEffect, useState } from 'react'
import { isTauri } from '@/api/transport'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingRow, SettingsSection } from '@/features/settings/ui'

type ToggleState = 'loading' | 'on' | 'off'

/** Launch-at-login switch. Reads the OS truth on mount and re-reads it after each change
 *  rather than trusting the optimistic value, so a failed enable/disable can't desync. */
export function AutostartToggle() {
  const [state, setState] = useState<ToggleState>('loading')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { isEnabled } = await import('@tauri-apps/plugin-autostart')
        const on = await isEnabled()
        if (!cancelled) setState(on ? 'on' : 'off')
      } catch {
        if (!cancelled) {
          setState('off')
          setError("Couldn't read this setting.")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleChange(next: boolean) {
    setPending(true)
    setError(null)
    try {
      const autostart = await import('@tauri-apps/plugin-autostart')
      if (next) await autostart.enable()
      else await autostart.disable()
      setState((await autostart.isEnabled()) ? 'on' : 'off')
    } catch {
      setError("Couldn't change this setting.")
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingRow
      label="Launch at login"
      description="Start OpenDoist automatically when you sign in to your Mac."
      control={
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={state === 'on'}
            onCheckedChange={handleChange}
            disabled={state === 'loading' || pending}
            aria-label="Launch OpenDoist at login"
          />
          {error !== null && (
            <span className="max-w-[15rem] text-right text-caption text-danger">{error}</span>
          )}
        </div>
      }
    />
  )
}

/** Native-notification permission: shows "Enabled" once granted, otherwise a button that
 *  asks macOS for permission (the reminders watcher's notifications need it granted). */
export function NotificationsSetting() {
  const [granted, setGranted] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { isPermissionGranted } = await import('@tauri-apps/plugin-notification')
        const ok = await isPermissionGranted()
        if (!cancelled) setGranted(ok)
      } catch {
        if (!cancelled) setGranted(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleEnable() {
    setPending(true)
    setError(null)
    try {
      const { requestPermission } = await import('@tauri-apps/plugin-notification')
      const result = await requestPermission()
      setGranted(result === 'granted')
      if (result !== 'granted') setError('Blocked — enable in System Settings.')
    } catch {
      setError("Couldn't request permission.")
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingRow
      label="Reminder notifications"
      description="Show a native macOS notification when a reminder is due."
      control={
        <div className="flex flex-col items-end gap-1">
          {granted === true ? (
            <span className="text-caption text-text-tertiary">Enabled</span>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={granted === null || pending}
              onClick={handleEnable}
            >
              {pending ? 'Enabling…' : 'Enable'}
            </Button>
          )}
          {error !== null && (
            <span className="max-w-[15rem] text-right text-caption text-danger">{error}</span>
          )}
        </div>
      }
    />
  )
}

/** Turnkey desktop settings section. Renders nothing in the browser, so a shared settings
 *  page can mount it unconditionally; the `isTauri()` guard keeps the web build inert. */
export function DesktopSettings() {
  if (!isTauri()) return null
  return (
    <SettingsSection
      title="Desktop app"
      description="Options for the OpenDoist macOS app. They have no effect in the browser."
    >
      <AutostartToggle />
      <NotificationsSetting />
    </SettingsSection>
  )
}
