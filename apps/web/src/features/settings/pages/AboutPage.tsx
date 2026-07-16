/**
 * About — the one REAL settings page Task A ships (plan Step 5): app name + version
 * from GET /api/v1/info (the `['info']` query). NOT replaced by any phase-5 task;
 * phase 9 Task N owns it from here (update status, View-changelog button).
 */
import { useInfo } from '@/api/hooks/info'
import { SettingRow, SettingsSection } from '../ui'

export default function AboutPage() {
  const { data: info } = useInfo()
  return (
    <SettingsSection title="About" description="OpenDoist — self-hosted tasks, done properly.">
      <SettingRow
        label="Version"
        control={
          <span className="font-mono text-copy text-text-secondary">
            {info ? `v${info.version}` : '…'}
          </span>
        }
      />
      <SettingRow
        label="What's New"
        description="Changelog and update status arrive with the productivity release."
        control={null}
      />
    </SettingsSection>
  )
}
