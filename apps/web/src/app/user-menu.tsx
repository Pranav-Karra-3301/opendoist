import { useNavigate } from '@tanstack/react-router'
import { LogOut, Settings, SwatchBook } from 'lucide-react'
import { useInfo } from '@/api/hooks/info'
import { useUser } from '@/api/hooks/user'
import type { User } from '@/api/schemas'
import { authClient } from '@/auth/client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWhatsNew, WhatsNewProvider } from '@/whats-new/WhatsNewDialog'
import { ThemeMenu } from './theme-menu'

function accountInitial(user: User | undefined): string {
  const source = (user?.name ?? user?.email ?? '').trim()
  return source.length > 0 ? source.charAt(0).toUpperCase() : '?'
}

/**
 * Account menu (sidebar header): avatar initial → name/email header, a Settings item
 * (opens the /settings/account modal), theme submenu, design tokens, log out, and the
 * instance version footer with a "Changelog" trigger.
 * Also mounts the What's New provider (auto-show-once-per-version dialog).
 *
 * The root menu is deliberately UNCONTROLLED: controlling `open` from component state
 * makes every open/close re-render the whole menu tree, and a re-render racing the
 * popup's exit transition (e.g. the settings refetch right after a theme pick) leaves
 * base-ui's submenu unmounted with hover dead (phase-9 gate finding — theme.spec.ts).
 * The Changelog row is a real menu item, so base-ui closes the menu on click itself.
 */
export function UserMenu() {
  const { data: user } = useUser()
  const { data: info } = useInfo()
  const navigate = useNavigate()
  const showWhatsNew = useWhatsNew((s) => s.show)

  const logOut = async () => {
    await authClient.signOut()
    // Hard navigate so the router guard re-runs against a cleared session.
    window.location.href = '/login'
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account menu"
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-accent font-medium text-caption text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2"
        >
          {accountInitial(user)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <div className="px-2 py-1.5">
            <p className="truncate font-medium text-copy text-text-primary">
              {user?.name ?? 'Account'}
            </p>
            {user?.email !== undefined && (
              <p className="truncate text-caption text-text-tertiary">{user.email}</p>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => void navigate({ to: '/settings/$page', params: { page: 'account' } })}
          >
            <Settings size={16} className="text-text-secondary" aria-hidden="true" />
            Settings
          </DropdownMenuItem>
          <ThemeMenu />
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void navigate({ to: '/dev/tokens' })}>
            <SwatchBook size={16} className="text-text-secondary" aria-hidden="true" />
            Design tokens
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void logOut()}>
            <LogOut size={16} className="text-text-secondary" aria-hidden="true" />
            Log out
          </DropdownMenuItem>
          {info?.version !== undefined && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                aria-label="Changelog"
                onClick={() => showWhatsNew()}
                className="h-7 gap-1 text-caption text-text-tertiary data-highlighted:text-text-secondary"
              >
                <span>v{info.version}</span>
                <span aria-hidden="true">·</span>
                <span className="underline-offset-2 hover:underline">Changelog</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <WhatsNewProvider />
    </>
  )
}
