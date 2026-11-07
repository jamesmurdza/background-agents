"use client"

import { useMemo } from "react"
import { GitMerge } from "lucide-react"
import { cn } from "@/lib/utils"
import { GitBranchDialog, type GitBranchDialogConfig } from "./GitBranchDialog"
import type { GitDialogProps } from "./types"

export function MergeDialog({ open, onClose, gitDialogs, chat, isMobile = false }: GitDialogProps) {
  const config = useMemo<GitBranchDialogConfig>(() => ({
    title: "Merge Branch",
    icon: <GitMerge />,
    sourceLabel: "From chat",
    targetLabel: "Into chat",
    actionLabel: "Merge",
    onAction: gitDialogs.handleMerge,
    additionalContent: (
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
    ),
  }), [gitDialogs.handleMerge, gitDialogs.squashMerge, gitDialogs.setSquashMerge, isMobile])

  return (
    <GitBranchDialog
      open={open}
      onClose={onClose}
      gitDialogs={gitDialogs}
      chat={chat}
      isMobile={isMobile}
      config={config}
    />
  )
}
