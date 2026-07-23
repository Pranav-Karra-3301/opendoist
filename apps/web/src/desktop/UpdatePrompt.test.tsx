import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { DesktopUpdatePrompt } from './UpdatePrompt'

describe('DesktopUpdatePrompt', () => {
  test('renders nothing outside the Tauri shell (web bundles stay inert)', () => {
    // No __TAURI_INTERNALS__ here and no event has fired — the prompt must be invisible
    // and must not have pulled any Tauri module in to decide that.
    expect(renderToStaticMarkup(<DesktopUpdatePrompt />)).toBe('')
  })
})
