"use client"

import type { Branch } from "@/lib/shared/types"
import { Copy, Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DiffModal } from "@/components/modals/diff-modal"
import { GitDialogs } from "@/components/git"
import type { UseGitActionsReturn } from "./hooks/useGitActions"

// ============================================================================
// Chat Dialogs Component
// ============================================================================

interface ChatDialogsProps {
  branch: Branch
  repoOwner: string
  repoName: string
  gitActions: UseGitActionsReturn
}

export function ChatDialogs({ branch, repoOwner, repoName, gitActions }: ChatDialogsProps) {
  return (
    <>
      {/* Git dialogs (merge, rebase) - shared between mobile and desktop */}
      <GitDialogs gitDialogs={gitActions.gitDialogs} />

      {/* Rsync command modal (desktop only) */}
      <Dialog open={gitActions.rsyncModalOpen} onOpenChange={(open) => { gitActions.setRsyncModalOpen(open); if (!open) gitActions.setRsyncCopied(false) }}>
        <DialogContent className="sm:max-w-lg overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-sm">Sync to local</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Run this in your terminal to continuously sync the sandbox to a local folder. It respects <code className="rounded bg-muted px-1 py-0.5">.gitignore</code> files and re-syncs every 2 seconds. Press <code className="rounded bg-muted px-1 py-0.5">Ctrl+C</code> to stop.
          </p>
          <div className="relative">
            <pre className="rounded-md bg-muted p-3 pr-9 text-xs font-mono whitespace-pre-wrap break-all">{gitActions.rsyncCommand}</pre>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(gitActions.rsyncCommand)
                gitActions.setRsyncCopied(true)
                setTimeout(() => gitActions.setRsyncCopied(false), 2000)
              }}
              className="absolute top-2 right-2 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {gitActions.rsyncCopied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diff modal — branch comparison */}
      {branch.sandboxId && (
        <DiffModal
          open={gitActions.diffModalOpen}
          onClose={() => gitActions.setDiffModalOpen(false)}
          repoOwner={repoOwner}
          repoName={repoName}
          branchName={branch.name}
          baseBranch={branch.baseBranch}
          startCommit={branch.startCommit}
        />
      )}

      {/* Diff modal — single commit */}
      {branch.sandboxId && (
        <DiffModal
          open={!!gitActions.commitDiffHash}
          onClose={() => { gitActions.setCommitDiffHash(null); gitActions.setCommitDiffMessage(null) }}
          repoOwner={repoOwner}
          repoName={repoName}
          branchName={branch.name}
          baseBranch={branch.baseBranch}
          commitHash={gitActions.commitDiffHash}
          commitMessage={gitActions.commitDiffMessage}
        />
      )}
    </>
  )
}
