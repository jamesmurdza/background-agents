"use client"

import { useState, useCallback } from "react"
import { GitBranch } from "lucide-react"
import type { Chat } from "@/lib/types"
import {
  BaseDialog,
  BranchSelector,
  DialogLabel,
  DialogReadonlyField,
  DialogFooter,
  dialogIconClass,
  type UseGitDialogsResult,
} from "./shared"

interface RebaseDialogProps {
  open: boolean
  onClose: () => void
  gitDialogs: UseGitDialogsResult
  chat: Chat | null
  isMobile?: boolean
}

export function RebaseDialog({ open, onClose, gitDialogs, chat, isMobile = false }: RebaseDialogProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const agentRunning = chat?.status === "running"

  const handleRebaseAndClose = useCallback(async () => {
    await gitDialogs.handleRebase()
    onClose()
  }, [gitDialogs, onClose])

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Rebase Branch"
      icon={<GitBranch className={dialogIconClass(isMobile)} />}
      isMobile={isMobile}
      allowOverflow={dropdownOpen}
    >
      <div className="space-y-5">
        <div>
          <DialogLabel isMobile={isMobile}>Rebase</DialogLabel>
          <DialogReadonlyField isMobile={isMobile}>
            {gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : "No chat"}
          </DialogReadonlyField>
        </div>

        <div>
          <DialogLabel isMobile={isMobile}>Onto branch</DialogLabel>
          <BranchSelector
            autoFocus
            value={gitDialogs.selectedBranch}
            onChange={gitDialogs.setSelectedBranch}
            branches={gitDialogs.remoteBranches}
            loading={gitDialogs.branchesLoading}
            isMobile={isMobile}
            getLabel={gitDialogs.branchLabel}
            onOpenChange={setDropdownOpen}
            onSubmit={handleRebaseAndClose}
            defaultValue={gitDialogs.baseBranch}
          />
        </div>

        <DialogFooter
          onCancel={onClose}
          onAction={handleRebaseAndClose}
          actionLabel="Rebase"
          disabled={agentRunning || !gitDialogs.selectedBranch}
          loading={gitDialogs.actionLoading}
          isMobile={isMobile}
        />
      </div>
    </BaseDialog>
  )
}
