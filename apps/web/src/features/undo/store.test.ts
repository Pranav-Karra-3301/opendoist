import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUndoStore } from './store'

/**
 * Store semantics (plan Task W): single-slot replace-on-push, dismiss clears without running,
 * runUndo clears-then-runs. UndoHost's UI (auto-dismiss timer, mod+z, error toast) is not
 * unit-testable in the `node` test env and is covered by e2e/phase5/undo.spec.ts.
 */
describe('useUndoStore', () => {
  beforeEach(() => {
    useUndoStore.setState({ current: null })
  })

  it('push sets the current action and assigns an id', () => {
    useUndoStore.getState().push({ message: 'Task deleted', undo: async () => {} })
    const c = useUndoStore.getState().current
    expect(c?.message).toBe('Task deleted')
    expect(typeof c?.id).toBe('number')
  })

  it('a new push replaces the current toast (single-slot) with a fresh id', () => {
    useUndoStore.getState().push({ message: 'A', undo: async () => {} })
    const first = useUndoStore.getState().current
    useUndoStore.getState().push({ message: 'B', undo: async () => {} })
    const second = useUndoStore.getState().current
    expect(second?.message).toBe('B')
    expect(second?.id).not.toBe(first?.id)
  })

  it('runUndo clears current and invokes the undo callback exactly once', async () => {
    const undo = vi.fn(async () => {})
    useUndoStore.getState().push({ message: 'X', undo })
    await useUndoStore.getState().runUndo()
    expect(undo).toHaveBeenCalledOnce()
    expect(useUndoStore.getState().current).toBeNull()
  })

  it('runUndo clears current BEFORE awaiting undo (the toast hides immediately)', async () => {
    let currentDuringUndo: unknown = 'unset'
    useUndoStore.getState().push({
      message: 'Y',
      undo: async () => {
        currentDuringUndo = useUndoStore.getState().current
      },
    })
    await useUndoStore.getState().runUndo()
    expect(currentDuringUndo).toBeNull()
  })

  it('runUndo with no current is a no-op that resolves', async () => {
    await expect(useUndoStore.getState().runUndo()).resolves.toBeUndefined()
  })

  it('runUndo propagates a rejecting undo so the host can surface an error toast', async () => {
    useUndoStore.getState().push({
      message: 'Z',
      undo: async () => {
        throw new Error('restore failed')
      },
    })
    await expect(useUndoStore.getState().runUndo()).rejects.toThrow('restore failed')
    // current is still cleared even when undo throws (cleared before the await).
    expect(useUndoStore.getState().current).toBeNull()
  })

  it('dismiss clears current without running the undo callback', () => {
    const undo = vi.fn(async () => {})
    useUndoStore.getState().push({ message: 'D', undo })
    useUndoStore.getState().dismiss()
    expect(useUndoStore.getState().current).toBeNull()
    expect(undo).not.toHaveBeenCalled()
  })
})
