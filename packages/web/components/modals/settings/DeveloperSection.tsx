"use client"

import { Wrench } from "lucide-react"
import { SettingsRow, ToggleSwitch, MobileSectionHeader } from "./shared"

interface DeveloperSectionProps {
  isMobile: boolean
  elizaEnabled: boolean
  setElizaEnabled: (next: boolean) => void
  /** Only admins can see/edit maxAgentRunMinutes — enforced server-side too. */
  isAdmin: boolean
  /** Minutes, or null to use the server default. Admin-only. */
  maxAgentRunMinutes: number | null
  setMaxAgentRunMinutes: (next: number | null) => void
}

/**
 * Developer-only settings. Currently gates the Eliza test agent — a
 * deterministic, no-API-key agent used for local testing/demos — which is
 * hidden from the agent picker unless enabled here (off by default) — and,
 * for admins only, an override of the agent-lifecycle cron's hard timeout for
 * the admin's own runs (see app/api/cron/agent-lifecycle/_lib/constants).
 */
export function DeveloperSection({
  isMobile,
  elizaEnabled,
  setElizaEnabled,
  isAdmin,
  maxAgentRunMinutes,
  setMaxAgentRunMinutes,
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
      {isAdmin && (
        <SettingsRow
          label="Max agent run duration"
          description="Override how long your own agent runs may go before the lifecycle cron force-stops them. Leave blank to use the server default."
        >
          <input
            type="number"
            min={1}
            step="1"
            placeholder="Default"
            value={maxAgentRunMinutes ?? ""}
            onChange={(e) => {
              const raw = e.target.value
              setMaxAgentRunMinutes(raw === "" ? null : Number(raw))
            }}
            className="w-24 rounded-lg border bg-background px-2 py-1.5 text-sm shadow-sm outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </SettingsRow>
      )}
    </div>
  )
}
