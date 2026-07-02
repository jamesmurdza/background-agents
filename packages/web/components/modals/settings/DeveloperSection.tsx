"use client"

import { Wrench } from "lucide-react"
import { SettingsRow, ToggleSwitch, MobileSectionHeader } from "./shared"

interface DeveloperSectionProps {
  isMobile: boolean
  elizaEnabled: boolean
  setElizaEnabled: (next: boolean) => void
}

/**
 * Developer-only settings. Currently gates the Eliza test agent — a
 * deterministic, no-API-key agent used for local testing/demos — which is
 * hidden from the agent picker unless enabled here (off by default).
 */
export function DeveloperSection({
  isMobile,
  elizaEnabled,
  setElizaEnabled,
}: DeveloperSectionProps) {
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Wrench} label="Developer" />}
      <SettingsRow
        label="Enable Eliza"
        description="Show the Eliza test agent in the agent picker. Eliza is a deterministic, no-API-key agent for local testing."
      >
        <ToggleSwitch checked={elizaEnabled} onChange={setElizaEnabled} />
      </SettingsRow>
    </div>
  )
}
