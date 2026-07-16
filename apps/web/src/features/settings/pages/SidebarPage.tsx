/**
 * Sidebar settings — choose which views appear in the sidebar and whether task counts show.
 * Each switch writes the COMPLETE `sidebar` object through the optimistic `useUserSettings` PATCH
 * (the document merges shallow at the top level, so a partial would drop the untouched toggles).
 * Task J reads these prefs to render the live sidebar. Implements plan Task P.
 */
import { Switch } from '@/components/ui/switch'
import { SettingRow, SettingsSection } from '../ui'
import { useUserSettings } from '../useSettings'
import { SIDEBAR_VIEW_TOGGLES, sidebarPatch } from './sidebar-logic'

export default function SidebarPage() {
  const { settings, update } = useUserSettings()
  const sidebar = settings.sidebar

  return (
    <div className="max-w-2xl">
      <SettingsSection
        title="Show in sidebar"
        description="Hidden views stay reachable from search and keyboard shortcuts."
      >
        {SIDEBAR_VIEW_TOGGLES.map((toggle) => (
          <SettingRow
            key={toggle.key}
            label={toggle.label}
            control={
              <Switch
                checked={sidebar[toggle.key]}
                onCheckedChange={(value) => update(sidebarPatch(sidebar, toggle.key, value))}
                aria-label={toggle.label}
              />
            }
          />
        ))}
      </SettingsSection>

      <SettingsSection title="Options">
        <SettingRow
          label="Show task counts"
          description="Display the number of tasks next to each view."
          control={
            <Switch
              checked={sidebar.showCounts}
              onCheckedChange={(value) => update(sidebarPatch(sidebar, 'showCounts', value))}
              aria-label="Show task counts"
            />
          }
        />
      </SettingsSection>
    </div>
  )
}
