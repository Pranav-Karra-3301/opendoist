import { Check, Paintbrush } from 'lucide-react'
import { useState } from 'react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { applyTheme, getTheme, THEME_CHOICES, type ThemeChoice } from '@/lib/theme'
import { cn } from '@/lib/utils'

const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  kale: 'Kale',
  todoist: 'Todoist',
  dark: 'Dark',
  moonstone: 'Moonstone',
  tangerine: 'Tangerine',
  blueberry: 'Blueberry',
  lavender: 'Lavender',
  raspberry: 'Raspberry',
}

/**
 * "Theme ▸" submenu for the user menu — the 9 choices from `lib/theme`, a check on
 * the active one, applying + persisting on select. (The command palette also applies
 * themes; the check reflects this menu's own last selection, refreshed from storage
 * on mount.)
 */
export function ThemeMenu() {
  const [theme, setTheme] = useState<ThemeChoice>(() => getTheme())
  const select = (choice: ThemeChoice) => {
    applyTheme(choice)
    setTheme(choice)
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Paintbrush size={16} className="text-text-secondary" aria-hidden="true" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[160px]">
        {THEME_CHOICES.map((choice) => (
          <DropdownMenuItem key={choice} onClick={() => select(choice)}>
            <Check
              size={16}
              aria-hidden="true"
              className={cn(theme === choice ? 'opacity-100' : 'opacity-0')}
            />
            {THEME_LABELS[choice]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
