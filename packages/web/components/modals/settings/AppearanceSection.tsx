"use client"

import { Sun, Moon, Monitor } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Theme } from "@/lib/types"
import { SettingsRow, MobileSectionHeader } from "./shared"

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Auto", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
]

interface AppearanceSectionProps {
  isMobile: boolean
  selectedTheme: Theme
  onThemeChange: (theme: Theme) => void
}

/** Appearance settings: theme picker (auto/light/dark). */
export function AppearanceSection({
  isMobile,
  selectedTheme,
  onThemeChange,
}: AppearanceSectionProps) {
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Sun} label="Appearance" />}
      <SettingsRow label="Theme">
        <Select value={selectedTheme} onValueChange={(v) => onThemeChange(v as Theme)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Select theme" />
          </SelectTrigger>
          <SelectContent>
            {themeOptions.map((opt) => (
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
