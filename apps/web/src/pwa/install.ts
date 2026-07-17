/**
 * Install-prompt plumbing (phase 10, Task C).
 *
 * Chromium fires `beforeinstallprompt` once, early, and only if the app is installable — so
 * we capture it at module load (before React mounts), stash the deferred event, and expose it
 * through `useInstallPrompt`. Calling `promptInstall()` replays it as the native install
 * dialog. iOS/iPadOS has no such event (install is a manual Share-sheet flow), so the hook
 * also reports `isIos` / `isStandalone` for the callers that show the iOS guide instead.
 */
import { create } from 'zustand'

/** Not in the DOM lib: the Chromium-only install event. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

interface InstallStore {
  deferred: BeforeInstallPromptEvent | null
  setDeferred: (event: BeforeInstallPromptEvent | null) => void
}

const useInstallStore = create<InstallStore>((set) => ({
  deferred: null,
  setDeferred: (deferred) => set({ deferred }),
}))

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress Chromium's default mini-infobar; the app owns the install affordance.
    event.preventDefault()
    useInstallStore.getState().setDeferred(event as BeforeInstallPromptEvent)
  })
  // Once installed the deferred prompt is spent — drop it so the affordance hides.
  window.addEventListener('appinstalled', () => {
    useInstallStore.getState().setDeferred(null)
  })
}

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports as desktop Safari — fall back to a touch-capable "Mac" check.
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iphone|ipad|ipod/i.test(ua) || iPadOs
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const displayMode = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone =
    'standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true
  return displayMode || iosStandalone
}

export interface InstallPrompt {
  /** A native install prompt is available (Chromium, app not yet installed). */
  canInstall: boolean
  /** Show the native install dialog; resolves once the user accepts or dismisses. */
  promptInstall: () => Promise<void>
  isIos: boolean
  isStandalone: boolean
}

export function useInstallPrompt(): InstallPrompt {
  const deferred = useInstallStore((s) => s.deferred)
  const setDeferred = useInstallStore((s) => s.setDeferred)

  const promptInstall = async (): Promise<void> => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    // The event is single-use; clear it whatever the outcome.
    setDeferred(null)
  }

  return {
    canInstall: deferred !== null,
    promptInstall,
    isIos: detectIos(),
    isStandalone: detectStandalone(),
  }
}
