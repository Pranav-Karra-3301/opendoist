/**
 * Offline banner (phase 10, Task C). A thin bar pinned to the top of the viewport while the
 * browser reports no connection, explaining that the SW is serving cached data and that
 * mutations need to reconnect. `role="status"` so it is announced politely on appearance.
 */
import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const goOnline = (): void => setOnline(true)
    const goOffline = (): void => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    // Re-sync in case connectivity changed between the initial render and effect.
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])
  return online
}

export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[var(--z-toast)] flex items-center justify-center gap-2 bg-surface-overlay px-4 py-1.5 text-caption text-white"
    >
      <WifiOff size={14} aria-hidden="true" className="shrink-0" />
      <span>You're offline — showing cached data. Changes need a connection.</span>
    </div>
  )
}
