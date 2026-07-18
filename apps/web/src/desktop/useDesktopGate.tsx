/**
 * Desktop gate (Task B) — wrapped around the app root in `main.tsx`.
 *
 * On the web (`isTauri()` false) `DesktopGate` is a pure pass-through: it renders its
 * children verbatim with no hooks, effects, or extra DOM, so the browser build stays
 * byte-identical to the pre-desktop app. In the Tauri shell it reads the stored pairing
 * once and shows `PairingScreen` until the app is paired, then renders the real app.
 *
 * The `isTauri()` short-circuit lives in the exported `DesktopGate` wrapper (which runs no
 * hooks), and the stateful `useDesktopGate` hook only ever runs on the desktop path — so
 * the conditional never violates the rules of hooks.
 */
import { type ReactNode, useEffect, useState } from 'react'
import { getDesktopSession } from '@/api/desktop-session'
import { isTauri } from '@/api/transport'
import { PairingScreen } from './PairingScreen'

type GateStatus = 'loading' | 'unpaired' | 'paired'

/**
 * Desktop pairing state. Reads the stored session once on mount; `markPaired` flips the
 * gate to the app after `PairingScreen` persists a verified pair (no re-read needed).
 * Desktop-only — call from inside the Tauri branch of `DesktopGate`, never on the web.
 */
export function useDesktopGate(): { status: GateStatus; markPaired: () => void } {
  const [status, setStatus] = useState<GateStatus>('loading')

  useEffect(() => {
    let cancelled = false
    // getDesktopSession never throws; `null` means unpaired.
    void getDesktopSession().then((session) => {
      if (!cancelled) setStatus(session === null ? 'unpaired' : 'paired')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { status, markPaired: () => setStatus('paired') }
}

/** App-root gate. Web: renders `children` unchanged. Desktop: pairing screen until paired. */
export function DesktopGate({ children }: { children: ReactNode }) {
  if (!isTauri()) return children
  return <DesktopGateInner>{children}</DesktopGateInner>
}

function DesktopGateInner({ children }: { children: ReactNode }) {
  const { status, markPaired } = useDesktopGate()
  if (status === 'loading') return <GateSplash />
  if (status === 'unpaired') return <PairingScreen onPaired={markPaired} />
  return children
}

/** Neutral app-background backdrop for the brief store read, so the desktop window never
 *  flashes white before the pairing screen or the app appears. */
function GateSplash() {
  return <div className="min-h-screen w-full bg-bg" aria-hidden="true" />
}
