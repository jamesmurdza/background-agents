"use client"

import { MergeDialog, RebaseDialog, TagDialog } from "./dialogs"
import type { UseGitDialogsReturn } from "./hooks/useGitDialogs"

interface GitDialogsProps {
  gitDialogs: UseGitDialogsReturn
}

/**
 * Renders all git dialogs (merge, rebase, tag)
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

      <TagDialog
        open={gitDialogs.tagOpen}
        onOpenChange={(open) => { if (!open) { gitDialogs.setTagOpen(false); gitDialogs.setTagNameInput("") } }}
        tagNameInput={gitDialogs.tagNameInput}
        onTagNameInputChange={gitDialogs.setTagNameInput}
        actionLoading={gitDialogs.actionLoading}
        onTag={gitDialogs.handleTag}
        onCancel={() => { gitDialogs.setTagOpen(false); gitDialogs.setTagNameInput("") }}
      />
    </>
  )
}
