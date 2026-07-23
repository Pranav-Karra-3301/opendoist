import { create } from 'zustand'
import { playCue } from '@/lib/sound'

export interface Toast {
  id: string
  kind: 'info' | 'error'
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (kind: Toast['kind'], message: string) => void
  dismiss: (id: string) => void
}

const AUTO_DISMISS_MS: Record<Toast['kind'], number> = { info: 5_000, error: 8_000 }

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS[kind])
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Imperative helpers usable outside React (mutation callbacks, undo store). */
export const toast = {
  info: (message: string): void => useToastStore.getState().push('info', message),
  error: (message: string): void => {
    playCue('error')
    useToastStore.getState().push('error', message)
  },
}
