"use client"

import { useState, useCallback, isValidElement, cloneElement, type ReactNode, type ReactElement } from "react"
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

/**
 * Configuration for a git branch dialog that selects a source and target branch.
 */
export interface GitBranchDialogConfig {
  /** Dialog title */
  title: string
  /** Icon component for the dialog header */
  icon: ReactNode
  /** Label for the source branch field (e.g., "From chat", "Rebase") */
  sourceLabel: string
  /** Label for the target branch field (e.g., "Into chat", "Onto branch") */
  targetLabel: string
  /** Label for the action button */
  actionLabel: string
  /** The action to perform when the user confirms */
  onAction: () => Promise<void>
  /** Optional additional content to render before the footer */
  additionalContent?: ReactNode
}

interface GitBranchDialogProps extends GitDialogProps {
  config: GitBranchDialogConfig
}

/**
 * A reusable dialog component for git operations that involve selecting
 * a source and target branch (merge, rebase, etc.).
 *
 * This reduces duplication between MergeDialog and RebaseDialog.
 */
export function GitBranchDialog({
  open,
  onClose,
  gitDialogs,
  chat,
  isMobile = false,
  config,
}: GitBranchDialogProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const agentRunning = chat?.status === "running"

  const handleActionAndClose = useCallback(async () => {
    await config.onAction()
    onClose()
  }, [config, onClose])

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title={config.title}
      icon={
        isValidElement(config.icon)
          ? cloneElement(config.icon as ReactElement<{ className?: string }>, {
              className: cn(dialogIconClass(isMobile), (config.icon.props as { className?: string }).className),
            })
          : config.icon
      }
      isMobile={isMobile}
      allowOverflow={dropdownOpen}
    >
      <div className="space-y-5">
        <div>
          <DialogLabel isMobile={isMobile}>{config.sourceLabel}</DialogLabel>
          <DialogReadonlyField isMobile={isMobile}>
            {gitDialogs.branchName ? gitDialogs.branchLabel(gitDialogs.branchName) : "No chat"}
          </DialogReadonlyField>
        </div>

        <div>
          <DialogLabel isMobile={isMobile}>{config.targetLabel}</DialogLabel>
          <BranchSelector
            autoFocus
            value={gitDialogs.selectedBranch}
            onChange={gitDialogs.setSelectedBranch}
            branches={gitDialogs.remoteBranches}
            loading={gitDialogs.branchesLoading}
            isMobile={isMobile}
            getLabel={gitDialogs.branchLabel}
            onOpenChange={setDropdownOpen}
            onSubmit={handleActionAndClose}
            defaultValue={gitDialogs.baseBranch}
          />
        </div>

        {config.additionalContent}

        <DialogFooter
          onCancel={onClose}
          onAction={handleActionAndClose}
          actionLabel={config.actionLabel}
          disabled={agentRunning || !gitDialogs.selectedBranch}
          loading={gitDialogs.actionLoading}
          isMobile={isMobile}
        />
      </div>
    </BaseDialog>
  )
}
