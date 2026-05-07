"use client"

import { useCallback, useRef } from "react"
import { GitCommitVertical, Loader2 } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
import {
  DialogLabel,
  DialogReadonlyField,
  DialogFooter,
  dialogIconClass,
} from "@/components/ui/dialog-parts"
import { cn } from "@/lib/utils"
import type { GitDialogProps } from "./types"

export function SquashDialog({ open, onClose, gitDialogs, chat, isMobile = false }: GitDialogProps) {
  const canSquash = gitDialogs.commitsAhead >= 2 && !gitDialogs.commitsLoading
  const agentRunning = chat?.status === "running"
  const squashButtonRef = useRef<HTMLButtonElement>(null)

  const handleSquashAndClose = useCallback(async () => {
    await gitDialogs.handleSquash()
    onClose()
  }, [gitDialogs, onClose])

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Squash Commits"
      icon={<GitCommitVertical className={dialogIconClass(isMobile)} />}
      isMobile={isMobile}
      initialFocusRef={squashButtonRef}
    >
      <div className="space-y-5">
        <div>
          <DialogLabel isMobile={isMobile}>Current branch</DialogLabel>
          <DialogReadonlyField isMobile={isMobile}>
            {gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : "No chat"}
          </DialogReadonlyField>
        </div>

        <div>
          <DialogLabel isMobile={isMobile}>Base branch</DialogLabel>
          <DialogReadonlyField isMobile={isMobile}>
            {gitDialogs.baseBranch || "main"}
          </DialogReadonlyField>
        </div>

        <div>
          <DialogLabel isMobile={isMobile}>Commits to squash</DialogLabel>
          {gitDialogs.commitsLoading ? (
            <div className={cn(
              "flex items-center gap-2 text-muted-foreground",
              isMobile ? "py-3 text-base" : "py-2 text-sm"
            )}>
              <Loader2 className="h-4 w-4 animate-spin" />
              Counting commits...
            </div>
          ) : (
            <DialogReadonlyField isMobile={isMobile}>
              {gitDialogs.commitsAhead} commit{gitDialogs.commitsAhead !== 1 ? "s" : ""} ahead of {gitDialogs.baseBranch || "main"}
            </DialogReadonlyField>
          )}
        </div>

        {!gitDialogs.commitsLoading && gitDialogs.commitsAhead < 2 && (
          <p className={cn(
            "text-amber-500",
            isMobile ? "text-sm" : "text-xs"
          )}>
            Need at least 2 commits to squash.
          </p>
        )}

        {canSquash && (
          <p className={cn(
            "text-muted-foreground",
            isMobile ? "text-sm" : "text-xs"
          )}>
            This will combine all {gitDialogs.commitsAhead} commits into a single commit.
          </p>
        )}

        <DialogFooter
          onCancel={onClose}
          onAction={handleSquashAndClose}
          actionLabel="Squash"
          disabled={agentRunning || !canSquash}
          loading={gitDialogs.actionLoading}
          isMobile={isMobile}
          actionButtonRef={squashButtonRef}
        />
      </div>
    </BaseDialog>
  )
}
