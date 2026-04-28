"use client"

import { GitMerge, GitBranch, GitPullRequest, GitCommitVertical, GitBranchPlus, Settings, HelpCircle, Github } from "lucide-react"
import { MobileBottomSheet } from "./ui/MobileBottomSheet"
import { cn } from "@/lib/utils"
import type { SlashCommandType } from "./SlashCommandMenu"

interface CommandItem {
  id: SlashCommandType | "settings" | "help" | "github"
  label: string
  description: string
  icon: React.ReactNode
  variant?: "default" | "destructive"
}

interface MobileCommandsMenuProps {
  open: boolean
  onClose: () => void
  onSlashCommand: (command: SlashCommandType) => void
  onOpenSettings?: () => void
  onOpenHelp?: () => void
  onOpenGitHub?: () => void
  /** Whether the chat has a linked repo (git commands only show when true) */
  hasLinkedRepo?: boolean
  /** Whether we're in a merge/rebase conflict */
  inConflict?: boolean
  /** Whether the GitHub link is available */
  hasGitHubLink?: boolean
}

export function MobileCommandsMenu({
  open,
  onClose,
  onSlashCommand,
  onOpenSettings,
  onOpenHelp,
  onOpenGitHub,
  hasLinkedRepo = false,
  inConflict = false,
  hasGitHubLink = false,
}: MobileCommandsMenuProps) {
  // Build commands list based on context
  const commands: CommandItem[] = []

  // Git commands - only show when repo is linked
  if (hasLinkedRepo) {
    if (inConflict) {
      // During conflict, only show abort
      commands.push({
        id: "abort",
        label: "Abort",
        description: "Abort the current merge or rebase",
        icon: <GitMerge className="h-5 w-5" />,
        variant: "destructive",
      })
    } else {
      // Normal git operations
      commands.push({
        id: "merge",
        label: "Merge",
        description: "Merge another branch into this one",
        icon: <GitMerge className="h-5 w-5" />,
      })
      commands.push({
        id: "rebase",
        label: "Rebase",
        description: "Rebase this branch onto another",
        icon: <GitBranch className="h-5 w-5" />,
      })
      commands.push({
        id: "pr",
        label: "Pull Request",
        description: "Create a pull request",
        icon: <GitPullRequest className="h-5 w-5" />,
      })
      commands.push({
        id: "squash",
        label: "Squash",
        description: "Squash commits into one",
        icon: <GitCommitVertical className="h-5 w-5" />,
      })
      commands.push({
        id: "branch",
        label: "Branch",
        description: "Create a new branch from here",
        icon: <GitBranchPlus className="h-5 w-5" />,
      })
    }
  }

  // Always-available commands
  if (hasGitHubLink && onOpenGitHub) {
    commands.push({
      id: "github",
      label: "Open in GitHub",
      description: "View this branch on GitHub",
      icon: <Github className="h-5 w-5" />,
    })
  }

  const handleSelect = (id: CommandItem["id"]) => {
    onClose()

    if (id === "settings") {
      onOpenSettings?.()
    } else if (id === "help") {
      onOpenHelp?.()
    } else if (id === "github") {
      onOpenGitHub?.()
    } else {
      onSlashCommand(id as SlashCommandType)
    }
  }

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="Commands"
      height="auto"
    >
      <div className="py-2">
        {commands.length > 0 ? (
          <>
            {/* Git Commands Section */}
            {hasLinkedRepo && (
              <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Git Commands
              </div>
            )}
            {commands.filter(cmd => !["settings", "help", "github"].includes(cmd.id)).map((command) => (
              <button
                key={command.id}
                onClick={() => handleSelect(command.id)}
                className={cn(
                  "flex items-center gap-3 w-full px-4 py-4 text-left transition-colors touch-target",
                  "hover:bg-accent active:bg-accent",
                  command.variant === "destructive" && "text-destructive"
                )}
              >
                <span className={cn(
                  "shrink-0",
                  command.variant === "destructive" ? "text-destructive" : "text-muted-foreground"
                )}>
                  {command.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-medium">{command.label}</div>
                  <div className={cn(
                    "text-sm",
                    command.variant === "destructive" ? "text-destructive/70" : "text-muted-foreground"
                  )}>
                    {command.description}
                  </div>
                </div>
              </button>
            ))}

            {/* Other Actions Section */}
            {(hasGitHubLink || onOpenSettings || onOpenHelp) && (
              <>
                <div className="my-2 border-t border-border" />
                <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  More
                </div>
              </>
            )}
          </>
        ) : (
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Actions
          </div>
        )}

        {/* GitHub link */}
        {hasGitHubLink && onOpenGitHub && (
          <button
            onClick={() => handleSelect("github")}
            className="flex items-center gap-3 w-full px-4 py-4 text-left transition-colors touch-target hover:bg-accent active:bg-accent"
          >
            <span className="shrink-0 text-muted-foreground">
              <Github className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium">Open in GitHub</div>
              <div className="text-sm text-muted-foreground">View this branch on GitHub</div>
            </div>
          </button>
        )}

        {/* Settings */}
        {onOpenSettings && (
          <button
            onClick={() => handleSelect("settings")}
            className="flex items-center gap-3 w-full px-4 py-4 text-left transition-colors touch-target hover:bg-accent active:bg-accent"
          >
            <span className="shrink-0 text-muted-foreground">
              <Settings className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium">Settings</div>
              <div className="text-sm text-muted-foreground">Configure API keys and preferences</div>
            </div>
          </button>
        )}

        {/* Help */}
        {onOpenHelp && (
          <button
            onClick={() => handleSelect("help")}
            className="flex items-center gap-3 w-full px-4 py-4 text-left transition-colors touch-target hover:bg-accent active:bg-accent"
          >
            <span className="shrink-0 text-muted-foreground">
              <HelpCircle className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium">Help</div>
              <div className="text-sm text-muted-foreground">Keyboard shortcuts and tips</div>
            </div>
          </button>
        )}
      </div>
    </MobileBottomSheet>
  )
}
