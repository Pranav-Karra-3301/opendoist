/**
 * Theme-color sync (phase 10, Task C).
 *
 * Keeps `<meta name="theme-color">` — the colour the OS paints the PWA title bar / status
 * bar / task switcher — in step with the app surface. index.html ships a static default;
 * this resolves the live `--ot-surface` token (which changes with the light/dark and accent
 * themes) and rewrites the meta whenever the theme could have changed: the theme store
 * toggles `data-mode` / `data-accent` / `class` on `<html>`, and the OS can flip
 * `prefers-color-scheme`.
 *
 * Returns a disconnect callback so the provider can clean up (StrictMode-safe).
 */

function readSurfaceColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ot-surface').trim()
  return value || '#fcfcf8'
}

function ensureMeta(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  return meta
}

export function syncThemeColor(): () => void {
  if (typeof document === 'undefined') return () => {}

  const meta = ensureMeta()
  const apply = (): void => {
    meta.content = readSurfaceColor()
  }
  apply()

  // `data-mode` / `data-accent` / `class` flip when the user changes theme; the computed token
  // updates synchronously, but styles resolve a tick later, so re-read on the next frame too.
  const observer = new MutationObserver(() => {
    apply()
    requestAnimationFrame(apply)
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-mode', 'data-accent', 'class'],
  })

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onMediaChange = (): void => {
    requestAnimationFrame(apply)
  }
  media.addEventListener('change', onMediaChange)

  return () => {
    observer.disconnect()
    media.removeEventListener('change', onMediaChange)
  }
}
