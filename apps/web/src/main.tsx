import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { queryClient, router } from './router'
import { UpdateBanner } from './update/UpdateBanner'
import './styles/tokens.css'

const container = document.getElementById('root')
if (!container) throw new Error('missing #root element')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* phase 9 (Task O): slim update-available banner; renders nothing unless an update exists */}
      <UpdateBanner />
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
