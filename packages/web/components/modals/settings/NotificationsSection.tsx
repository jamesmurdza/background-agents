"use client"

import { Bell } from "lucide-react"
import { SettingsRow, ToggleSwitch, MobileSectionHeader } from "./shared"

interface NotificationsSectionProps {
  isMobile: boolean
  notifyOnAgentFinished: boolean
  setNotifyOnAgentFinished: (next: boolean) => void
  notifyOnAgentCommitted: boolean
  setNotifyOnAgentCommitted: (next: boolean) => void
}

/**
 * Notification preferences. On the desktop app these surface as native OS
 * notifications; in the browser they surface as in-app toasts.
 */
export function NotificationsSection({
  isMobile,
  notifyOnAgentFinished,
  setNotifyOnAgentFinished,
  notifyOnAgentCommitted,
  setNotifyOnAgentCommitted,
}: NotificationsSectionProps) {
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Bell} label="Notifications" />}
      <SettingsRow
        label="Agent finished"
        description="Notify me when an agent finishes a turn."
      >
        <ToggleSwitch checked={notifyOnAgentFinished} onChange={setNotifyOnAgentFinished} />
      </SettingsRow>
      <SettingsRow
        label="Agent committed changes"
        description="Notify me when an agent pushes new commits."
      >
        <ToggleSwitch checked={notifyOnAgentCommitted} onChange={setNotifyOnAgentCommitted} />
      </SettingsRow>
    </div>
  )
}
