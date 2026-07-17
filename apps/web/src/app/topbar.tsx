import { CircleHelp, PanelLeft, Search } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ProductivityPopover } from '@/productivity/ProductivityPopover'
import { useUiStore } from '@/stores/ui'
import { UserMenu } from './user-menu'

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)

/** Top bar: sidebar toggle, spacer, palette search, keyboard help, account menu. */
export function Topbar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen)
  const setShortcutOverlayOpen = useUiStore((s) => s.setShortcutOverlayOpen)

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-border border-b bg-bg px-3">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
          >
            <PanelLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Toggle sidebar · M</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 items-center gap-2 rounded-sm px-2 text-copy text-text-secondary outline-none transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2"
        >
          <Search size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ml-1 rounded-xs border border-border px-1 font-sans text-caption text-text-tertiary">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>

        <ProductivityPopover />

        <Tooltip>
          <TooltipTrigger
            onClick={() => setShortcutOverlayOpen(true)}
            aria-label="Keyboard shortcuts"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
          >
            <CircleHelp size={20} strokeWidth={1.75} aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Keyboard shortcuts · ?</TooltipContent>
        </Tooltip>

        <UserMenu />
      </TooltipProvider>
    </header>
  )
}
