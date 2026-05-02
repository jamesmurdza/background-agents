"use client"

import { GitMerge, GitBranch, GitPullRequest, GitCommitVertical, GitBranchPlus, XCircle, HelpCircle, Github } from "lucide-react"
import { MobileBottomSheet } from "./ui/MobileBottomSheet"
import { cn } from "@/lib/utils"
import { SLASH_COMMANDS, ABORT_COMMAND, type SlashCommand } from "@upstream/common"
import type { SlashCommandType } from "./SlashCommandMenu"

/** Custom italic x icon for variables */
function VariableIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center justify-center italic font-serif", className)}>
      𝑥
    </span>
  )
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  GitMerge,
  GitBranch,
  GitPullRequest,
  GitCommitVertical,
  GitBranchPlus,
  XCircle,
}

interface CommandItem {
  id: SlashCommandType | "help" | "github" | "env"
  label: string
  description: string
  icon: React.ReactNode
  variant?: "default" | "destructive"
}

function slashCommandToItem(cmd: SlashCommand, variant?: "default" | "destructive"): CommandItem {
  const Icon = ICON_MAP[cmd.icon]
  return {
    id: cmd.name as SlashCommandType,
    label: cmd.label,
    description: cmd.description,
    icon: Icon ? <Icon className="h-5 w-5" /> : null,
    variant,
  }
}

interface MobileCommandsMenuProps {
  open: boolean
  onClose: () => void
  onSlashCommand: (command: SlashCommandType) => void
  onOpenHelp?: () => void
  onOpenGitHub?: () => void
  onOpenEnvVars?: () => void
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
  onOpenHelp,
  onOpenGitHub,
  onOpenEnvVars,
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
      commands.push(slashCommandToItem(ABORT_COMMAND, "destructive"))
    } else {
      // Normal git operations
      SLASH_COMMANDS.forEach(cmd => {
        commands.push(slashCommandToItem(cmd))
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

    if (id === "help") {
      onOpenHelp?.()
    } else if (id === "github") {
      onOpenGitHub?.()
    } else if (id === "env") {
      onOpenEnvVars?.()
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
            {commands.filter(cmd => !["help", "github"].includes(cmd.id)).map((command) => (
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
            {(hasGitHubLink || onOpenHelp || onOpenEnvVars) && (
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

        {/* Environment variables */}
        {onOpenEnvVars && (
          <button
            onClick={() => handleSelect("env")}
            className="flex items-center gap-3 w-full px-4 py-4 text-left transition-colors touch-target hover:bg-accent active:bg-accent"
          >
            <span className="shrink-0 text-muted-foreground">
              <VariableIcon className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium">Environment variables</div>
              <div className="text-sm text-muted-foreground">Set environment variables</div>
            </div>
          </button>
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
