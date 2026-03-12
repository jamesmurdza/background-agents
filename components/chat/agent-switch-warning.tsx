"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { type ProviderName, AGENT_CONFIGS } from "@/lib/types"

interface AgentSwitchWarningProps {
  open: boolean
  currentAgent: ProviderName
  newAgent: ProviderName
  onConfirm: () => void
  onCancel: () => void
}

export function AgentSwitchWarning({
  open,
  currentAgent,
  newAgent,
  onConfirm,
  onCancel,
}: AgentSwitchWarningProps) {
  const currentConfig = AGENT_CONFIGS[currentAgent]
  const newConfig = AGENT_CONFIGS[newAgent]

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch Agent?</AlertDialogTitle>
          <AlertDialogDescription>
            Switching from <strong>{currentConfig.label}</strong> to <strong>{newConfig.label}</strong> will
            start a new session. The current session history will not be available to the new agent.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Switch Agent</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
