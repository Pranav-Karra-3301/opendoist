import { describe, expect, test, vi } from 'vitest'

const play = vi.fn()
const setEnabled = vi.fn()
vi.mock('cuelume', () => ({ play, setEnabled }))
// The node test env has no `window`; playCue treats that as "no audio" — stub it so the
// enabled-path test exercises the real flow.
vi.stubGlobal('window', globalThis)

import { playCue, setCuesEnabled } from './sound'

describe('sound cues', () => {
  test('playCue is inert while disabled and never throws', async () => {
    setCuesEnabled(false)
    playCue('success')
    await vi.waitFor(() => expect(play).not.toHaveBeenCalled())
  })

  test('playCue plays when enabled, and the setting reaches the library', async () => {
    setCuesEnabled(true)
    playCue('success')
    await vi.waitFor(() => expect(play).toHaveBeenCalledWith('success'))
    // The lazily-loaded module received the enabled state too.
    expect(setEnabled).toHaveBeenCalledWith(true)
    setCuesEnabled(false)
    await vi.waitFor(() => expect(setEnabled).toHaveBeenCalledWith(false))
  })
})
