/**
 * Desktop Quick Add popover entry (second Vite input). Mounts the lean Quick Add app
 * (`src/quickadd/App.tsx`) into the frameless, transparent Tauri popover window. It stays
 * deliberately minimal — the shared design tokens + the Quick Add card only — and never links
 * the router / views / query-client the main SPA needs, so summoning the popover is instant.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './quickadd/App'
import './styles/tokens.css'

/**
 * The popover has no in-window theme switcher, so it simply follows the OS light/dark
 * preference: `.system-dark` on <html> is exactly the hook tokens.css exposes for the web
 * app's 'system' theme. Kept here (not in React) so the correct palette is applied before the
 * first paint.
 */
function followSystemTheme(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const sync = (): void => {
    document.documentElement.classList.toggle('system-dark', mq.matches)
  }
  sync()
  mq.addEventListener('change', sync)
}

followSystemTheme()

const container = document.getElementById('root')
if (!container) throw new Error('missing #root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
