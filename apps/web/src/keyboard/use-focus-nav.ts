/**
 * j/k row focus movement. Drives the selection store's focus cursor and scrolls the newly
 * focused row into view. Rows carry `id={'task-' + task.id}` (Task E frozen contract).
 */
import { useCallback } from 'react'
import { useSelectionStore } from '@/stores/selection'

function scrollFocusedIntoView(): void {
  const { focusedId } = useSelectionStore.getState()
  if (focusedId) {
    document.getElementById(`task-${focusedId}`)?.scrollIntoView({ block: 'nearest' })
  }
}

export interface FocusNav {
  focusDown: () => void
  focusUp: () => void
}

export function useFocusNav(): FocusNav {
  const focusDown = useCallback(() => {
    useSelectionStore.getState().focusNext()
    scrollFocusedIntoView()
  }, [])
  const focusUp = useCallback(() => {
    useSelectionStore.getState().focusPrev()
    scrollFocusedIntoView()
  }, [])
  return { focusDown, focusUp }
}
