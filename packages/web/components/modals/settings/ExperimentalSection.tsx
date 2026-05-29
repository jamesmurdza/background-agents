"use client"

import { FlaskConical } from "lucide-react"
import { SettingsRow, ToggleSwitch, MobileSectionHeader } from "./shared"

interface ExperimentalSectionProps {
  isMobile: boolean
  rapidFireMode: boolean
  setRapidFireMode: (next: boolean) => void
}

/** Experimental settings: rapid-fire send mode. */
export function ExperimentalSection({
  isMobile,
  rapidFireMode,
  setRapidFireMode,
}: ExperimentalSectionProps) {
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={FlaskConical} label="Experimental" />}
      <SettingsRow
        label="Rapid fire mode"
        description="Send tasks without switching to them. The input clears so you can quickly delegate multiple tasks."
      >
        <ToggleSwitch checked={rapidFireMode} onChange={setRapidFireMode} />
      </SettingsRow>
    </div>
  )
}
