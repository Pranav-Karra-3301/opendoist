import { useNavigate } from '@tanstack/react-router'
import { LogOut, SwatchBook } from 'lucide-react'
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
import { ThemeMenu } from './theme-menu'

function accountInitial(user: User | undefined): string {
  const source = (user?.name ?? user?.email ?? '').trim()
  return source.length > 0 ? source.charAt(0).toUpperCase() : '?'
}

/**
 * Topbar account menu: avatar initial → name/email header, theme submenu, design
 * tokens, log out, and the instance version footer.
 */
export function UserMenu() {
  const { data: user } = useUser()
  const { data: info } = useInfo()
  const navigate = useNavigate()

  const logOut = async () => {
    await authClient.signOut()
    // Hard navigate so the router guard re-runs against a cleared session.
    window.location.href = '/login'
  }

  return (
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
            <p className="px-2 py-1 text-caption text-text-tertiary">v{info.version}</p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
