/**
 * Seamless macOS window chrome for the Tauri shell (overlay title bar).
 *
 * The desktop main window ships `titleBarStyle: "Overlay"` + `hiddenTitle`, so the web
 * content extends to the very top of the window and the traffic lights float over it.
 * This module supplies the three web-side halves of that deal:
 *
 *  1. `initDesktopChrome()` — stamps `data-desktop-chrome="mac"` on <html> BEFORE first
 *     paint, which flips the `--ot-desktop-drag` token from 0 to the strip height; the
 *     sidebar and content columns pad themselves down by it so nothing interactive sits
 *     under the traffic lights / drag strip.
 *  2. `<DesktopDragStrip />` — an invisible fixed strip across the top that carries
 *     `data-tauri-drag-region`, restoring window dragging (and the native double-click
 *     zoom) that the hidden title bar gave up. Mounted at the app root so it also works
 *     on the pairing screen.
 *  3. `syncWindowBackground()` — mirrors the resolved `--ot-bg` token onto the native
 *     NSWindow background so relaunch/overscroll never flash the wrong color in dark mode.
 *
 * Everything no-ops outside the macOS Tauri shell (web/PWA bundles keep a 0px token and
 * never load any Tauri code — the import below is dynamic, mirroring `api/transport.ts`).
 */
import { isTauri } from '@/api/transport'

export function hasDesktopChrome(): boolean {
  return (
    isTauri() &&
    typeof navigator !== 'undefined' &&
    navigator.platform.toUpperCase().includes('MAC')
  )
}

/** Stamp the html attribute pre-paint + push the initial theme color to the native window. */
export function initDesktopChrome(): void {
  if (!hasDesktopChrome()) return
  document.documentElement.setAttribute('data-desktop-chrome', 'mac')
  syncWindowBackground()
}

/**
 * Mirror the CURRENT computed `--ot-bg` onto the native window background. Fire-and-forget:
 * failures (missing permission, non-Tauri test env) must never break theming itself.
 */
export function syncWindowBackground(): void {
  if (!hasDesktopChrome()) return
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--ot-bg').trim()
  if (bg === '') return
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setBackgroundColor(bg))
    .catch(() => {})
}

/** The invisible, always-on-top drag strip under the traffic lights. Renders nothing on web. */
export function DesktopDragStrip() {
  if (!hasDesktopChrome()) return null
  return (
    <div
      aria-hidden="true"
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-[var(--z-toast)] h-[var(--ot-desktop-drag)]"
    />
  )
}
