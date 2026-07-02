"use client"

import { Settings as SettingsIcon } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ALL_AGENTS,
  agentLabels,
  agentModels,
  hasCredentialsForModel,
  type Agent,
  type CredentialFlags,
  type ModelOption,
} from "@/lib/types"
import { SettingsRow, MobileSectionHeader } from "./shared"

interface GeneralSectionProps {
  isMobile: boolean
  defaultAgent: Agent
  setDefaultAgent: (agent: Agent) => void
  defaultModel: string
  setDefaultModel: (model: string) => void
  /** Credential availability based on the *current form state* (not saved flags). */
  liveFlags: CredentialFlags
  /** Whether the Eliza test agent is enabled (hidden from the list otherwise). */
  elizaEnabled?: boolean
}

/** General settings: default agent + default model dropdowns. */
export function GeneralSection({
  isMobile,
  defaultAgent,
  setDefaultAgent,
  defaultModel,
  setDefaultModel,
  liveFlags,
  elizaEnabled = false,
}: GeneralSectionProps) {
  const availableModels = agentModels[defaultAgent] ?? []
  // Keep the currently-selected agent visible even if it's Eliza (so the value
  // never renders blank), but otherwise hide Eliza unless it's enabled.
  const agentChoices = ALL_AGENTS.filter(
    (a) => a !== "eliza" || elizaEnabled || defaultAgent === "eliza"
  )

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={SettingsIcon} label="General" />}
      <SettingsRow label="Agent">
        <Select value={defaultAgent} onValueChange={(v) => setDefaultAgent(v as Agent)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {agentChoices.map((agent) => (
              <SelectItem key={agent} value={agent}>
                {agentLabels[agent]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="Model">
        <Select value={defaultModel} onValueChange={setDefaultModel}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map((model: ModelOption) => {
              const hasCredentials = hasCredentialsForModel(model, liveFlags, defaultAgent)
              return (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                  {!hasCredentials && model.requiresKey !== "none" ? " (needs API key)" : ""}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  )
}
