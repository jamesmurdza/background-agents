"use client"

import { useRef } from "react"
import { Menu, MoreVertical, ChevronDown, Pencil, Github, Trash2, Clock, Command } from "lucide-react"
import { useModals, useSidebar } from "@/lib/contexts"
import { CreditBalancePill } from "@/components/chat/CreditBalancePill"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import type { Chat } from "@/lib/types"

interface MobileHeaderProps {
  chat: Chat | null
  viewMode: "chat" | "scheduled-jobs"
  githubBranchUrl: string | null
  onOpenMenu: () => void
  onOpenInGitHub: () => void
  onOpenEnvVars: () => void
  onOpenCommandPalette?: () => void
}

export function MobileHeader({
  chat,
  viewMode,
  githubBranchUrl,
  onOpenMenu,
  onOpenInGitHub,
  onOpenEnvVars,
  onOpenCommandPalette,
}: MobileHeaderProps) {
  const modals = useModals()
  const mobileTitleMenuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useClickOutside(
    mobileTitleMenuRef,
    () => modals.setMobileTitleMenuOpen(false),
    modals.mobileTitleMenuOpen
  )

  return (
    <div className="flex items-center gap-3 px-4 pb-2 bg-background pt-safe">
      <button
        onClick={onOpenMenu}
        className="p-2 -ml-2 rounded-lg hover:bg-accent active:bg-accent text-foreground transition-colors touch-target"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Title - different for scheduled jobs vs chat */}
      {viewMode === "scheduled-jobs" ? (
        <div className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1 -ml-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-base font-semibold">Scheduled Agents</span>
        </div>
      ) : (
        <div className="relative flex-1 min-w-0" ref={mobileTitleMenuRef}>
          <button
            onClick={() => chat && modals.setMobileTitleMenuOpen(!modals.mobileTitleMenuOpen)}
            className="flex items-center gap-1 text-base font-semibold truncate max-w-full hover:bg-accent active:bg-accent rounded-md px-2 py-1 -ml-2 transition-colors"
          >
            <span className="truncate">{chat?.displayName || "Background Agents"}</span>
            {chat && <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </button>

          {modals.mobileTitleMenuOpen && chat && (
            <div className="absolute left-0 top-full mt-1 min-w-[210px] rounded-md border border-border bg-popover shadow-md py-1 z-50">
              <button
                onClick={() => {
                  modals.setMobileTitleMenuOpen(false)
                  modals.setMobileRenameChat({ id: chat.id, name: chat.displayName || "Untitled" })
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left cursor-pointer"
              >
                <Pencil className="h-4 w-4" />
                Rename
              </button>

              {githubBranchUrl && (
                <button
                  onClick={() => {
                    modals.setMobileTitleMenuOpen(false)
                    onOpenInGitHub()
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left cursor-pointer"
                >
                  <Github className="h-4 w-4" />
                  Open in GitHub
                </button>
              )}

              <button
                onClick={() => {
                  modals.setMobileTitleMenuOpen(false)
                  onOpenEnvVars()
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left cursor-pointer"
              >
                <span className="h-4 w-4 flex items-center justify-center text-sm italic font-serif">𝑥</span>
                Environment variables
              </button>

              <div className="my-1 border-t border-border" />

              <button
                onClick={() => {
                  modals.setMobileTitleMenuOpen(false)
                  modals.setDeleteConfirmChatId(chat.id)
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left text-destructive cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      )}

      {viewMode === "chat" && <CreditBalancePill compact />}

      {/* Command palette - only show for chat view */}
      {viewMode === "chat" && onOpenCommandPalette && (
        <button
          onClick={onOpenCommandPalette}
          className="p-2 -mr-1 rounded-lg hover:bg-accent active:bg-accent text-foreground transition-colors touch-target"
          aria-label="Open command palette"
        >
          <Command className="h-5 w-5" />
        </button>
      )}

      {/* Commands menu - only show for chat view */}
      {viewMode === "chat" && (
        <button
          onClick={() => modals.setMobileCommandsOpen(true)}
          className="p-2 -mr-2 rounded-lg hover:bg-accent active:bg-accent text-foreground transition-colors touch-target"
          aria-label="Commands"
        >
          <MoreVertical className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}
