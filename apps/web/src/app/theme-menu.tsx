import { Check, Paintbrush } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { useUserSettings } from '@/features/settings/useSettings'
import {
  settingsPatchForChoice,
  THEME_CHOICES,
  type ThemeChoice,
  themeChoiceFromSettings,
} from '@/lib/theme'
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
 * "Theme ▸" submenu for the user menu — the 9 choices from `lib/theme`, a check on the
 * active one. Phase 5 makes the account settings the single source of truth: selecting
 * writes `theme`/`autoDark` through the optimistic settings PATCH and `useThemeSync`
 * (mounted in AppLayout) repaints + mirrors to localStorage for the pre-hydration script.
 */
export function ThemeMenu() {
  const { settings, update } = useUserSettings()
  const active = themeChoiceFromSettings(settings)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Paintbrush size={16} className="text-text-secondary" aria-hidden="true" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[160px]">
        {THEME_CHOICES.map((choice) => (
          <DropdownMenuItem key={choice} onClick={() => update(settingsPatchForChoice(choice))}>
            <Check
              size={16}
              aria-hidden="true"
              className={cn(active === choice ? 'opacity-100' : 'opacity-0')}
            />
            {THEME_LABELS[choice]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
