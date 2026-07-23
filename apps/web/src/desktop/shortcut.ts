/**
 * Pure helpers for the Quick Add global-shortcut recorder (desktop settings).
 *
 * Accelerator strings use Tauri's cross-platform syntax (`CmdOrCtrl+Shift+Space`); the
 * Rust side (`set_quickadd_shortcut`) is the validator of record — it parses and
 * OS-registers the combo before it is persisted. These helpers only build a candidate
 * string from a keydown and pretty-print one for display, so they stay conservative:
 * letters, digits, F-keys, Space/Enter and arrows, and a combo must include at least one
 * of ⌘/⌃/⌥ (Shift alone would collide with plain typing).
 */

export const DEFAULT_QUICKADD_SHORTCUT = 'CmdOrCtrl+Shift+Space'

/** Subset of `KeyboardEvent` the builder needs (keeps tests dependency-free). */
export interface ChordKeys {
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  code: string
}

/** `KeyboardEvent.code` → accelerator key token, or null for unsupported/modifier keys. */
function keyToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  const named: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  }
  return named[code] ?? null
}

/**
 * Build an accelerator from a keydown, or null when the press is not a usable chord
 * (a bare/unsupported key, or no non-Shift modifier held).
 */
export function accelFromChord(e: ChordKeys): string | null {
  const key = keyToken(e.code)
  if (key === null) return null
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return null
  const mods: string[] = []
  if (e.metaKey) mods.push('CmdOrCtrl')
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  return [...mods, key].join('+')
}

/** Display form for the recorder button — macOS symbols (this surface is mac-only). */
export function prettyAccel(accel: string): string {
  const symbol: Record<string, string> = {
    CmdOrCtrl: '⌘',
    CommandOrControl: '⌘',
    Cmd: '⌘',
    Super: '⌘',
    Ctrl: '⌃',
    Control: '⌃',
    Alt: '⌥',
    Option: '⌥',
    Shift: '⇧',
  }
  return accel
    .split('+')
    .map((part) => symbol[part] ?? part)
    .join('')
}
