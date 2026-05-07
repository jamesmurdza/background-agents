"use client"

import { useState, useCallback } from "react"
import { GitPullRequest, ChevronDown } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
import {
  DialogLabel,
  DialogReadonlyField,
  DialogFooter,
  DialogCancelButton,
  dialogIconClass,
} from "@/components/ui/dialog-parts"
import { BranchSelector } from "@/components/ui/BranchSelector"
import { cn } from "@/lib/utils"
import type { GitDialogProps, PRDescriptionType } from "./types"

/** PR description format options */
const PR_DESCRIPTION_TYPES = ["short", "long", "commits", "none"] as const

const DESCRIPTION_TYPE_LABELS: Record<PRDescriptionType, { label: string; description: string }> = {
  short: { label: "Short description", description: "AI-generated summary" },
  long: { label: "Long description", description: "AI-generated detailed description" },
  commits: { label: "List of commits", description: "Simple commit list (no AI)" },
  none: { label: "No description", description: "Empty description" },
}

export function PRDialog({ open, onClose, gitDialogs, chat, isMobile = false }: GitDialogProps) {
  const isGitHubRepo = chat?.repo && chat.repo !== "__new__"
  const agentRunning = chat?.status === "running"
  const [descriptionType, setDescriptionType] = useState<PRDescriptionType>("short")
  const [descriptionDropdownOpen, setDescriptionDropdownOpen] = useState(false)
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false)

  const handleCreatePRAndClose = useCallback(async () => {
    await gitDialogs.handleCreatePR(descriptionType)
    onClose()
  }, [gitDialogs, descriptionType, onClose])

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Create Pull Request"
      icon={<GitPullRequest className={dialogIconClass(isMobile)} />}
      isMobile={isMobile}
      allowOverflow={descriptionDropdownOpen || branchDropdownOpen}
    >
      <div className="space-y-5">
        {!isGitHubRepo ? (
          <p className={cn(
            "text-muted-foreground",
            isMobile ? "text-base" : "text-sm"
          )}>
            Pull requests require a GitHub repository. This chat is using a local repository.
          </p>
        ) : (
          <>
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
                onOpenChange={setBranchDropdownOpen}
                onSubmit={handleCreatePRAndClose}
                defaultValue={gitDialogs.baseBranch}
              />
            </div>

            {/* Description type selector */}
            <div>
              <DialogLabel isMobile={isMobile}>Description format</DialogLabel>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDescriptionDropdownOpen(!descriptionDropdownOpen)}
                  className={cn(
                    "w-full flex items-center justify-between bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring",
                    isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
                  )}
                >
                  <span className="text-foreground">
                    {DESCRIPTION_TYPE_LABELS[descriptionType].label}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", descriptionDropdownOpen && "rotate-180")} />
                </button>

                {descriptionDropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {PR_DESCRIPTION_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          setDescriptionType(type)
                          setDescriptionDropdownOpen(false)
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 hover:bg-accent transition-colors",
                          isMobile ? "text-base" : "text-sm",
                          descriptionType === type && "bg-accent"
                        )}
                      >
                        {DESCRIPTION_TYPE_LABELS[type].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className={cn(
                "text-muted-foreground mt-1",
                isMobile ? "text-sm" : "text-xs"
              )}>
                {DESCRIPTION_TYPE_LABELS[descriptionType].description}
              </p>
            </div>
          </>
        )}

        {isGitHubRepo ? (
          <DialogFooter
            onCancel={onClose}
            onAction={handleCreatePRAndClose}
            actionLabel="Create PR"
            disabled={agentRunning || !gitDialogs.selectedBranch}
            loading={gitDialogs.actionLoading}
            isMobile={isMobile}
          />
        ) : (
          <div className="flex justify-end pt-2">
            <DialogCancelButton onClick={onClose} isMobile={isMobile} />
          </div>
        )}
      </div>
    </BaseDialog>
  )
}
