import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
        <RouterProvider router={router} />
      </PwaProvider>
    </QueryClientProvider>
  </StrictMode>,
)
