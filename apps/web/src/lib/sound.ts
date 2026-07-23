/**
 * Audio cues — a thin, never-throwing wrapper around `cuelume` (MIT, ~5 KB): tiny
 * interaction sounds synthesized live via the Web Audio API, so nothing external loads
 * and no audio files ship. Curated imperative `play()` calls only — the page-wide
 * declarative `bind()` is deliberately not used.
 *
 * The user setting (`settings.soundCues`, default ON) is the single source of truth:
 * `useSoundCuesSync` mirrors it into the library on every settings change (the desktop
 * Quick Add popover, which has no query client, calls `setCuesEnabled` from its own
 * settings fetch). The library is imported lazily on first use so test environments and
 * SSR paths never touch the Web Audio API.
 */
import { useEffect } from 'react'
import { useUserSettings } from '@/features/settings/useSettings'

export type CueName =
  | 'chime'
  | 'sparkle'
  | 'droplet'
  | 'bloom'
  | 'whisper'
  | 'tick'
  | 'press'
  | 'release'
  | 'toggle'
  | 'success'
  | 'error'

let mod: Promise<typeof import('cuelume')> | null = null
/** Mirrors the last `setCuesEnabled` value so a late-loading module starts correct. */
let enabled = true

function load(): Promise<typeof import('cuelume')> {
  if (mod === null) {
    mod = import('cuelume').then((m) => {
      m.setEnabled(enabled)
      return m
    })
  }
  return mod
}

/** Fire-and-forget cue. Silent when disabled, unsupported, or in a non-DOM test env. */
export function playCue(name: CueName): void {
  if (!enabled || typeof window === 'undefined') return
  void load()
    .then((m) => m.play(name))
    .catch(() => {})
}

/** Push the user's setting into the library (and remember it for a late first load). */
export function setCuesEnabled(next: boolean): void {
  enabled = next
  if (mod !== null) void mod.then((m) => m.setEnabled(next)).catch(() => {})
}

/** Keep the library in sync with `settings.soundCues`. Mounted once in AppLayout. */
export function useSoundCuesSync(): void {
  const { settings } = useUserSettings()
  useEffect(() => {
    setCuesEnabled(settings.soundCues)
  }, [settings.soundCues])
}
