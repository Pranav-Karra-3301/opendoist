/**
 * PWA provider (phase 10, Task C). Wraps the app root (main.tsx) and owns the browser-side
 * PWA lifecycle:
 *
 *   - registers the service worker (workbox-window) and surfaces the update toast,
 *   - keeps `<meta name="theme-color">` in sync with the active theme,
 *   - renders the offline banner, and
 *   - offers an "Install app" affordance (native prompt on Chromium, the Add-to-Home-Screen
 *     guide on iOS).
 *
 * The install button ideally lives in the account/help menu, but that lives in `app/`
 * (owned by another Task-10 surface), so it is rendered here as a dismissible corner card
 * AND exposed via `useInstallAffordance()` for later in-menu placement. Toasts/cards share a
 * single fixed bottom-right stack; the transient toast store keeps its own bottom-left stack.
 */
import { Download, X } from 'lucide-react'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { useInstallPrompt } from './install'
import { IosInstallDialog } from './ios-install-dialog'
import { OfflineBanner } from './offline-banner'
import { registerSW, type SWRegistration } from './register'
import { syncThemeColor } from './theme-color'
import { UpdateToast } from './update-toast'

const INSTALL_DISMISS_KEY = 'od-install-dismissed'
const INSTALL_REDISPLAY_MS = 30 * 24 * 60 * 60 * 1000

function isInstallDismissed(): boolean {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_KEY)
    if (raw === null) return false
    const at = Number(raw)
    return Number.isFinite(at) && Date.now() - at < INSTALL_REDISPLAY_MS
  } catch {
    return false
  }
}

interface InstallAffordance {
  /** A native install prompt is available (Chromium, not yet installed). */
  canInstall: boolean
  /** The app can be installed by some means (native prompt or the iOS Home Screen flow). */
  installable: boolean
  isIos: boolean
  isStandalone: boolean
  /** Trigger the right install path: native dialog on Chromium, the iOS guide on iOS. */
  install: () => void
}

const InstallContext = createContext<InstallAffordance | null>(null)

/** For an in-menu "Install app" item once one can be wired without editing app/ chrome. */
export function useInstallAffordance(): InstallAffordance {
  const ctx = useContext(InstallContext)
  if (ctx === null) throw new Error('useInstallAffordance must be used within <PwaProvider>')
  return ctx
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const { canInstall, promptInstall, isIos, isStandalone } = useInstallPrompt()
  const [needRefresh, setNeedRefresh] = useState(false)
  const [iosOpen, setIosOpen] = useState(false)
  const [dismissed, setDismissed] = useState(isInstallDismissed)
  const registration = useRef<SWRegistration | null>(null)

  useEffect(() => {
    registration.current = registerSW(() => setNeedRefresh(true))
    const disposeThemeColor = syncThemeColor()
    return disposeThemeColor
  }, [])

  const installable = canInstall || (isIos && !isStandalone)

  const install = (): void => {
    if (canInstall) {
      void promptInstall()
    } else if (isIos && !isStandalone) {
      setIosOpen(true)
    }
  }

  const dismissInstall = (): void => {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()))
    } catch {
      // Storage unavailable (private mode) — hide for this session regardless.
    }
    setDismissed(true)
  }

  const showInstallCard = installable && !dismissed

  return (
    <InstallContext.Provider value={{ canInstall, installable, isIos, isStandalone, install }}>
      {children}
      <OfflineBanner />
      <div className="pointer-events-none fixed right-4 bottom-4 z-[var(--z-toast)] flex flex-col items-end gap-2">
        {needRefresh ? (
          <UpdateToast
            onReload={() => registration.current?.update()}
            onDismiss={() => setNeedRefresh(false)}
          />
        ) : null}
        {showInstallCard ? (
          <div className="pointer-events-auto flex w-[300px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 [box-shadow:var(--shadow-toast)]">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Download size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-copy text-text-primary">Install OpenDoist</p>
              <p className="text-caption text-text-secondary">
                Add it to your device for quick access and offline use.
              </p>
              <button
                type="button"
                onClick={install}
                aria-label="Install OpenDoist"
                className="mt-2 inline-flex h-7 cursor-pointer items-center rounded-sm bg-accent px-2.5 font-medium text-caption text-on-accent transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
              >
                Install
              </button>
            </div>
            <button
              type="button"
              aria-label="Dismiss install prompt"
              onClick={dismissInstall}
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
      <IosInstallDialog open={iosOpen} onClose={() => setIosOpen(false)} />
    </InstallContext.Provider>
  )
}
