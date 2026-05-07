"use client"

import { useCallback, useRef } from "react"
import { AlertTriangle } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
import {
  DialogLabel,
  DialogReadonlyField,
  DialogFooter,
  dialogIconClass,
} from "@/components/ui/dialog-parts"
import { cn } from "@/lib/utils"
import type { GitDialogProps } from "./types"

export function ForcePushDialog({ open, onClose, gitDialogs, chat, isMobile = false }: GitDialogProps) {
  const agentRunning = chat?.status === "running"
  const branchLabel = gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : ""
  const forcePushButtonRef = useRef<HTMLButtonElement>(null)

  const handleForcePush = useCallback(async () => {
    await gitDialogs.handleForcePush()
  }, [gitDialogs])

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Force push"
      icon={<AlertTriangle className={cn(dialogIconClass(isMobile), "text-amber-500")} />}
      isMobile={isMobile}
      initialFocusRef={forcePushButtonRef}
    >
      <div className="space-y-5">
        <div>
          <DialogLabel isMobile={isMobile}>Branch</DialogLabel>
          <DialogReadonlyField isMobile={isMobile}>
            {branchLabel || "No chat"}
          </DialogReadonlyField>
        </div>

        <p className={cn(
          "text-muted-foreground",
          isMobile ? "text-base" : "text-sm"
        )}>
          This will overwrite the remote history of{" "}
          <span className="font-semibold text-foreground">{branchLabel}</span>{" "}
          with your local commits. Anyone with the old history will need to re-sync.
        </p>

        <DialogFooter
          onCancel={onClose}
          onAction={handleForcePush}
          actionLabel="Force push"
          disabled={agentRunning || !gitDialogs.branchName}
          loading={gitDialogs.actionLoading}
          isMobile={isMobile}
          variant="destructive"
          actionButtonRef={forcePushButtonRef}
        />
      </div>
    </BaseDialog>
  )
}
