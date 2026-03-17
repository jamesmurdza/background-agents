"use client"

import type { Branch } from "@/lib/types"
import { Loader2, Copy, Check, ArrowRightLeft } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DiffModal } from "@/components/diff-modal"
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
      {/* Branch picker modal */}
      <Dialog open={!!gitActions.branchPickerModal} onOpenChange={(open) => !open && gitActions.setBranchPickerModal(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {gitActions.branchPickerModal?.action === "merge" && (
                gitActions.mergeDirection === "from-current"
                  ? `Merge ${branch.name} into...`
                  : `Merge ... into ${branch.name}`
              )}
              {gitActions.branchPickerModal?.action === "rebase" && `Rebase ${branch.name} onto...`}
            </DialogTitle>
          </DialogHeader>
          {gitActions.branchesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : gitActions.remoteBranches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No other branches found.</p>
          ) : (
            <div className="space-y-3">
              <Select value={gitActions.selectedBranch} onValueChange={gitActions.setSelectedBranch}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {gitActions.remoteBranches.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Merge direction indicator with swap button */}
              {gitActions.branchPickerModal?.action === "merge" && gitActions.selectedBranch && (
                <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                    <span className="truncate font-medium text-foreground">
                      {gitActions.mergeDirection === "from-current" ? branch.name : gitActions.selectedBranch}
                    </span>
                    <span>→</span>
                    <span className="truncate font-medium text-foreground">
                      {gitActions.mergeDirection === "from-current" ? gitActions.selectedBranch : branch.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={gitActions.toggleMergeDirection}
                    className="cursor-pointer flex-shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    title="Swap merge direction"
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <button
              onClick={() => gitActions.setBranchPickerModal(null)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (gitActions.branchPickerModal?.action === "merge") gitActions.handleMerge()
                if (gitActions.branchPickerModal?.action === "rebase") gitActions.handleRebase()
              }}
              disabled={!gitActions.selectedBranch || gitActions.actionLoading !== null}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {gitActions.actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              {gitActions.branchPickerModal?.action === "merge" ? "Merge" : "Rebase"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag dialog */}
      <Dialog open={gitActions.tagPopoverOpen} onOpenChange={(open) => { gitActions.setTagPopoverOpen(open); if (!open) gitActions.setTagNameInput("") }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Create Tag</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="v1.0.0"
            value={gitActions.tagNameInput}
            onChange={(e) => gitActions.setTagNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") gitActions.handleTag() }}
            className="h-8 text-xs font-mono"
            autoFocus
          />
          <DialogFooter>
            <button
              onClick={() => { gitActions.setTagPopoverOpen(false); gitActions.setTagNameInput("") }}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={gitActions.handleTag}
              disabled={!gitActions.tagNameInput.trim()}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Create
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rsync command modal */}
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
