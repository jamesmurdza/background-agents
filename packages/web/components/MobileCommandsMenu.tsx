"use client"

import { useState } from "react"
import { GitMerge, GitBranch, GitPullRequest, GitCommitVertical, GitBranchPlus, XCircle, Share2, ChevronLeft, Copy, Check, Link2Off, Loader2 } from "lucide-react"
import { MobileBottomSheet } from "./ui/MobileBottomSheet"
import { cn } from "@/lib/utils"
import { SLASH_COMMANDS, ABORT_COMMAND, type SlashCommand } from "@background-agents/common"
import { useShareChat } from "@/lib/hooks/useShareChat"
import type { Chat } from "@/lib/types"
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
  /** Current chat — enables the Share action. */
  chat?: Chat | null
}

export function MobileCommandsMenu({
  open,
  onClose,
  onSlashCommand,
  hasLinkedRepo = false,
  inConflict = false,
  chat,
}: MobileCommandsMenuProps) {
  // The sheet has two views: the command list and the share panel.
  const [view, setView] = useState<"commands" | "share">("commands")

  const handleClose = () => {
    setView("commands")
    onClose()
  }

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
    handleClose()
    onSlashCommand(id)
  }

  return (
    <MobileBottomSheet
      open={open}
      onClose={handleClose}
      title={view === "share" ? "Share chat" : "Commands"}
      height="auto"
    >
      {view === "share" && chat ? (
        <ShareSheet chat={chat} onBack={() => setView("commands")} />
      ) : (
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

          {/* Share action — available whenever there's a chat to share. */}
          {chat && (
            <>
              <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Actions
              </div>
              <button
                onClick={() => setView("share")}
                className="flex items-center gap-3 w-full px-4 py-4 text-left transition-colors touch-target hover:bg-accent active:bg-accent"
              >
                <span className="shrink-0 text-muted-foreground">
                  <Share2 className="h-5 w-5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-medium">Share chat</div>
                  <div className="text-sm text-muted-foreground">
                    {chat.shareId ? "Public link is active" : "Create a public read-only link"}
                  </div>
                </div>
              </button>
            </>
          )}
        </div>
      )}
    </MobileBottomSheet>
  )
}

// =============================================================================
// ShareSheet — the share panel shown inside the mobile commands sheet
// =============================================================================

function ShareSheet({ chat, onBack }: { chat: Chat; onBack: () => void }) {
  const { shareId, busy, copied, shareUrl, enableShare, revokeShare, copyLink } =
    useShareChat(chat.id, chat.shareId)

  return (
    <div className="px-4 py-3">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      {shareId ? (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Anyone with this link can view this chat read-only. New messages stay
            visible as the chat continues.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 rounded-md border border-border bg-muted px-2 py-2 text-sm text-foreground outline-none"
            />
            <button
              onClick={copyLink}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Copy link"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <button
            onClick={revokeShare}
            disabled={busy}
            className="mt-4 flex items-center gap-2 text-sm text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2Off className="h-4 w-4" />
            )}
            Stop sharing
          </button>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Create a public link so anyone can view this chat read-only.
          </p>
          <button
            onClick={enableShare}
            disabled={busy}
            className="mt-4 flex items-center justify-center gap-2 w-full rounded-md bg-foreground px-3 py-2.5 text-sm font-medium text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            Create public link
          </button>
        </>
      )}
    </div>
  )
}
