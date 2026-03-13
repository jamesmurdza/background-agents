"use client"

import { useCallback } from "react"
import { AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import type { Agent } from "@/lib/types"
import { agentLabels } from "@/lib/types"

// =============================================================================
// Types
// =============================================================================

interface SwitchAgentDialogProps {
  /** The new agent to switch to, or null if dialog should be closed */
  newAgent: Agent | null
  /** Current agent name */
  currentAgent: Agent
  /** Callback when dialog is closed (without switching) */
  onClose: () => void
  /** Callback when agent switch is confirmed */
  onConfirm: (newAgent: Agent) => void
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Dialog for confirming agent switch with context loss warning
 *
 * Features:
 * - Warns user about context loss when switching agents mid-conversation
 * - Shows which agent they're switching from and to
 * - Clear explanation of what will happen
 */
export function SwitchAgentDialog({
  newAgent,
  currentAgent,
  onClose,
  onConfirm,
}: SwitchAgentDialogProps) {
  const handleConfirm = useCallback(() => {
    if (!newAgent) return
    onConfirm(newAgent)
    onClose()
  }, [newAgent, onConfirm, onClose])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      onClose()
    }
  }, [onClose])

  return (
    <Dialog open={!!newAgent} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Switch to {newAgent ? agentLabels[newAgent] : ""}?
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Your previous messages will remain visible, but the new agent won't have access to the conversation history.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 cursor-pointer"
          >
            Switch Agent
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
