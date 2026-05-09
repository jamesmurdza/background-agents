"use client"

import { useRef, useCallback } from "react"
import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat } from "@/lib/types"
import {
  BaseDialog,
  DialogLabel,
  DialogReadonlyField,
  DialogFooter,
  dialogIconClass,
  type UseGitDialogsResult,
} from "./shared"

interface ForcePushDialogProps {
  open: boolean
  onClose: () => void
  gitDialogs: UseGitDialogsResult
  chat: Chat | null
  isMobile?: boolean
}

export function ForcePushDialog({ open, onClose, gitDialogs, chat, isMobile = false }: ForcePushDialogProps) {
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
