import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DesktopGate } from './desktop/useDesktopGate'
import { PwaProvider } from './pwa/pwa-provider'
import { queryClient, router } from './router'
import { UpdateBanner } from './update/UpdateBanner'
import './styles/tokens.css'

const container = document.getElementById('root')
if (!container) throw new Error('missing #root element')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* phase 10 (Task C): service-worker registration, offline banner, theme-color sync,
          update toast, and the install affordance — wraps the app so its context reaches
          any future in-menu "Install app" item. */}
      <PwaProvider>
        {/* phase 9 (Task O): slim update-available banner; renders nothing unless an update exists */}
        <UpdateBanner />
        {/* desktop (Task B): in the Tauri shell, gate the app behind pairing until an
            instance + od_ token are stored. On the web `DesktopGate` is a pass-through,
            so the browser build renders exactly `<RouterProvider>` as before. */}
        <DesktopGate>
          <RouterProvider router={router} />
        </DesktopGate>
      </PwaProvider>
    </QueryClientProvider>
  </StrictMode>,
)
