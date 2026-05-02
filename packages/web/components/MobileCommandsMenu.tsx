"use client"

import { GitMerge, GitBranch, GitPullRequest, GitCommitVertical, GitBranchPlus, XCircle } from "lucide-react"
import { MobileBottomSheet } from "./ui/MobileBottomSheet"
import { cn } from "@/lib/utils"
import { SLASH_COMMANDS, ABORT_COMMAND, type SlashCommand } from "@upstream/common"
import type { SlashCommandType } from "./SlashCommandMenu"

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  GitMerge,
  GitBranch,
  GitPullRequest,
  GitCommitVertical,
  GitBranchPlus,
  XCircle,
}

interface CommandItem {
  id: SlashCommandType
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
  /** Whether the chat has a linked repo (git commands only show when true) */
  hasLinkedRepo?: boolean
  /** Whether we're in a merge/rebase conflict */
  inConflict?: boolean
}

export function MobileCommandsMenu({
  open,
  onClose,
  onSlashCommand,
  hasLinkedRepo = false,
  inConflict = false,
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

  const handleSelect = (id: CommandItem["id"]) => {
    onClose()
    onSlashCommand(id)
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
            {commands.map((command) => (
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

          </>
        ) : (
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Actions
          </div>
        )}
      </div>
    </MobileBottomSheet>
  )
}
