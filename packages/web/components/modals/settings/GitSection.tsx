"use client"

import { GitBranch } from "lucide-react"
import { SettingsRow, ToggleSwitch, MobileSectionHeader } from "./shared"

interface GitSectionProps {
  isMobile: boolean
  enablePrepushHooks: boolean
  setEnablePrepushHooks: (next: boolean) => void
}

/** Git settings: a single toggle for the pre-push hook. */
export function GitSection({
  isMobile,
  enablePrepushHooks,
  setEnablePrepushHooks,
}: GitSectionProps) {
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={GitBranch} label="Git" />}
      <SettingsRow
        label="Enable pre-push hooks"
        description="Run pre-push hooks during autopush. When disabled, autopush uses --no-verify."
      >
        <ToggleSwitch checked={enablePrepushHooks} onChange={setEnablePrepushHooks} />
      </SettingsRow>
    </div>
  )
}
