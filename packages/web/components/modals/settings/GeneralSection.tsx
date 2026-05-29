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
}

/** General settings: default agent + default model dropdowns. */
export function GeneralSection({
  isMobile,
  defaultAgent,
  setDefaultAgent,
  defaultModel,
  setDefaultModel,
  liveFlags,
}: GeneralSectionProps) {
  const availableModels = agentModels[defaultAgent] ?? []

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={SettingsIcon} label="General" />}
      <SettingsRow label="Agent">
        <Select value={defaultAgent} onValueChange={(v) => setDefaultAgent(v as Agent)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {ALL_AGENTS.map((agent) => (
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
