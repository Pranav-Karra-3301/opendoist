import { describe, expect, test } from 'vitest'
import { accelFromChord, prettyAccel } from './shortcut'

const chord = (over: Partial<Parameters<typeof accelFromChord>[0]> & { code: string }) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
})

describe('accelFromChord', () => {
  test('builds Tauri accelerators from real chords', () => {
    expect(accelFromChord(chord({ metaKey: true, shiftKey: true, code: 'Space' }))).toBe(
      'CmdOrCtrl+Shift+Space',
    )
    expect(accelFromChord(chord({ metaKey: true, code: 'KeyK' }))).toBe('CmdOrCtrl+K')
    expect(accelFromChord(chord({ ctrlKey: true, altKey: true, code: 'Digit7' }))).toBe(
      'Ctrl+Alt+7',
    )
    expect(accelFromChord(chord({ altKey: true, code: 'F19' }))).toBe('Alt+F19')
    expect(accelFromChord(chord({ metaKey: true, code: 'ArrowUp' }))).toBe('CmdOrCtrl+Up')
    // Meta wins the ⌘ slot; a simultaneously-held Ctrl is not double-counted as CmdOrCtrl.
    expect(accelFromChord(chord({ metaKey: true, ctrlKey: true, code: 'KeyJ' }))).toBe(
      'CmdOrCtrl+Ctrl+J',
    )
  })

  test('rejects bare keys, Shift-only chords, and unsupported keys', () => {
    expect(accelFromChord(chord({ code: 'KeyA' }))).toBeNull()
    expect(accelFromChord(chord({ shiftKey: true, code: 'KeyA' }))).toBeNull()
    expect(accelFromChord(chord({ metaKey: true, code: 'ShiftLeft' }))).toBeNull()
    expect(accelFromChord(chord({ metaKey: true, code: 'MetaLeft' }))).toBeNull()
    expect(accelFromChord(chord({ metaKey: true, code: 'Comma' }))).toBeNull()
  })
})

describe('prettyAccel', () => {
  test('renders macOS symbols on mac', () => {
    expect(prettyAccel('CmdOrCtrl+Shift+Space', true)).toBe('⌘⇧Space')
    expect(prettyAccel('Ctrl+Alt+7', true)).toBe('⌃⌥7')
    expect(prettyAccel('Alt+F19', true)).toBe('⌥F19')
  })

  test('spells out modifiers on Windows/Linux, resolving CmdOrCtrl to Ctrl', () => {
    expect(prettyAccel('CmdOrCtrl+Shift+Space', false)).toBe('Ctrl+Shift+Space')
    expect(prettyAccel('Ctrl+Alt+7', false)).toBe('Ctrl+Alt+7')
    expect(prettyAccel('Alt+F19', false)).toBe('Alt+F19')
  })
})
