"use client"

import { GitBranch } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PRDescriptionType } from "@/lib/types"
import { SettingsRow, ToggleSwitch, MobileSectionHeader } from "./shared"

const prDescriptionTypeOptions: { value: PRDescriptionType; label: string }[] = [
  { value: "short", label: "Short description" },
  { value: "long", label: "Long description" },
  { value: "commits", label: "List of commits" },
  { value: "none", label: "No description" },
]

interface GitSectionProps {
  isMobile: boolean
  enablePrepushHooks: boolean
  setEnablePrepushHooks: (next: boolean) => void
  defaultPrDescriptionType: PRDescriptionType
  setDefaultPrDescriptionType: (next: PRDescriptionType) => void
}

/** Git settings: pre-push hook toggle and default PR description mode. */
export function GitSection({
  isMobile,
  enablePrepushHooks,
  setEnablePrepushHooks,
  defaultPrDescriptionType,
  setDefaultPrDescriptionType,
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
      <SettingsRow
        label="Default PR description mode"
        description="The description format pre-selected when opening the Create PR dialog."
      >
        <Select
          value={defaultPrDescriptionType}
          onValueChange={(v) => setDefaultPrDescriptionType(v as PRDescriptionType)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Select mode" />
          </SelectTrigger>
          <SelectContent>
            {prDescriptionTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  )
}
