"use client"

import { useState, useCallback } from "react"
import { GitMerge } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
import {
  DialogLabel,
  DialogReadonlyField,
  DialogFooter,
  dialogIconClass,
} from "@/components/ui/dialog-parts"
import { BranchSelector } from "@/components/ui/BranchSelector"
import { cn } from "@/lib/utils"
import type { GitDialogProps } from "./types"

export function MergeDialog({ open, onClose, gitDialogs, chat, isMobile = false }: GitDialogProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const agentRunning = chat?.status === "running"

  const handleMergeAndClose = useCallback(async () => {
    await gitDialogs.handleMerge()
    onClose()
  }, [gitDialogs, onClose])

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Merge Branch"
      icon={<GitMerge className={dialogIconClass(isMobile)} />}
      isMobile={isMobile}
      allowOverflow={dropdownOpen}
    >
      <div className="space-y-5">
        <div>
          <DialogLabel isMobile={isMobile}>From chat</DialogLabel>
          <DialogReadonlyField isMobile={isMobile}>
            {gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : "No chat"}
          </DialogReadonlyField>
        </div>

        <div>
          <DialogLabel isMobile={isMobile}>Into chat</DialogLabel>
          <BranchSelector
            autoFocus
            value={gitDialogs.selectedBranch}
            onChange={gitDialogs.setSelectedBranch}
            branches={gitDialogs.remoteBranches}
            loading={gitDialogs.branchesLoading}
            isMobile={isMobile}
            getLabel={gitDialogs.branchLabel}
            onOpenChange={setDropdownOpen}
            onSubmit={handleMergeAndClose}
            defaultValue={gitDialogs.baseBranch}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={gitDialogs.squashMerge}
            onChange={(e) => gitDialogs.setSquashMerge(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className={cn(
            "text-muted-foreground",
            isMobile ? "text-base" : "text-sm"
          )}>Squash commits</span>
        </label>

        <DialogFooter
          onCancel={onClose}
          onAction={handleMergeAndClose}
          actionLabel="Merge"
          disabled={agentRunning || !gitDialogs.selectedBranch}
          loading={gitDialogs.actionLoading}
          isMobile={isMobile}
        />
      </div>
    </BaseDialog>
  )
}
