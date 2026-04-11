"use client"

import { MergeDialog, RebaseDialog, PRDialog } from "./dialogs"
import type { UseGitDialogsReturn } from "./hooks/useGitDialogs"

interface GitDialogsProps {
  gitDialogs: UseGitDialogsReturn
}

/**
 * Renders all git dialogs (merge, rebase, pr)
 * Used by both mobile and desktop interfaces
 */
export function GitDialogs({ gitDialogs }: GitDialogsProps) {
  return (
    <>
      <MergeDialog
        open={gitDialogs.mergeOpen}
        onOpenChange={(open) => !open && gitDialogs.setMergeOpen(false)}
        branchName={gitDialogs.branchName}
        remoteBranches={gitDialogs.remoteBranches}
        selectedBranch={gitDialogs.selectedBranch}
        onSelectedBranchChange={gitDialogs.setSelectedBranch}
        mergeDirection={gitDialogs.mergeDirection}
        onToggleMergeDirection={gitDialogs.toggleMergeDirection}
        branchesLoading={gitDialogs.branchesLoading}
        actionLoading={gitDialogs.actionLoading}
        onMerge={gitDialogs.handleMerge}
        onCancel={() => gitDialogs.setMergeOpen(false)}
        squashMerge={gitDialogs.squashMerge}
        onSquashMergeChange={gitDialogs.setSquashMerge}
      />

      <RebaseDialog
        open={gitDialogs.rebaseOpen}
        onOpenChange={(open) => !open && gitDialogs.setRebaseOpen(false)}
        branchName={gitDialogs.branchName}
        remoteBranches={gitDialogs.remoteBranches}
        selectedBranch={gitDialogs.selectedBranch}
        onSelectedBranchChange={gitDialogs.setSelectedBranch}
        branchesLoading={gitDialogs.branchesLoading}
        actionLoading={gitDialogs.actionLoading}
        onRebase={gitDialogs.handleRebase}
        onCancel={() => gitDialogs.setRebaseOpen(false)}
      />

      <PRDialog
        open={gitDialogs.prOpen}
        onOpenChange={(open) => !open && gitDialogs.setPROpen(false)}
        branchName={gitDialogs.branchName}
        remoteBranches={gitDialogs.remoteBranches}
        selectedBaseBranch={gitDialogs.selectedBranch}
        onSelectedBaseBranchChange={gitDialogs.setSelectedBranch}
        branchesLoading={gitDialogs.branchesLoading}
        actionLoading={gitDialogs.actionLoading}
        onCreatePR={gitDialogs.handleCreatePR}
        onCancel={() => gitDialogs.setPROpen(false)}
      />
    </>
  )
}
