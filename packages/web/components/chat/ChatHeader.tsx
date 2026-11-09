"use client"

import { useState, useRef } from "react"
import { ChevronDown, Github, Pencil, Trash2, Loader2, Command, FolderDown, HardDrive, HelpCircle, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { useElectron } from "@/lib/hooks/useElectron"
import { useRepoFolderButton } from "@/lib/hooks/useLocalSync"
import { useModals } from "@/lib/contexts"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import { Input } from "../ui/input"
import { ShareButton } from "./ShareButton"
import { DeployButton } from "./DeployButton"
import { CreditBalancePill } from "./CreditBalancePill"
import { ChatJobRunHeader } from "./ChatJobRunHeader"
import { getChatDisplayTitle } from "@/lib/chat-tree"
import { isRealRepo, type Chat } from "@/lib/types"

// =============================================================================
// ChatHeader - Title bar with title menu
// =============================================================================

interface ChatHeaderProps {
  chat: Chat
  onUpdateChat?: (updates: Partial<Chat>) => void
  onOpenEnvVars?: () => void
  onOpenSkills?: () => void
  onOpenCommandPalette?: () => void
  /** Whether the current user is an admin — gates the "Increase resources" item. */
  isAdmin?: boolean
  /** Open the sandbox resize modal. Omitted when there's no sandbox to resize. */
  onOpenSandboxResize?: () => void
  /** Opens a chat by id — same mechanism used by the sidebar/Triggers modal.
   *  Only needed for chats linked to a scheduled job run (its "previous
   *  runs" dropdown uses this to jump between a job's past runs). */
  onSelectChat?: (chatId: string) => void
}

export function ChatHeader({
  chat,
  onUpdateChat,
  onOpenEnvVars,
  onOpenSkills,
  onOpenCommandPalette,
  isAdmin,
  onOpenSandboxResize,
  onSelectChat,
}: ChatHeaderProps) {
  const modals = useModals()
  const { isDesktopApp } = useElectron()
  const { data: settingsData } = useSettingsQuery()
  const showCommandPaletteButton = settingsData?.settings.showCommandPaletteButton ?? false

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState("")
  const [titleMenuOpen, setTitleMenuOpen] = useState(false)
  const titleMenuRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Close menus on outside click
  useClickOutside(titleMenuRef, () => setTitleMenuOpen(false), titleMenuOpen)

  // Job-linked chats show just the job name here (no date suffix — that
  // lives in the separate run-date menu below) and can't be renamed inline;
  // renaming a job goes through its edit modal (ScheduledJobActionsMenu →
  // Edit), not a free-text chat title.
  const isJobChat = !!chat.scheduledJobRun
  const chatTitle = isJobChat ? chat.scheduledJobRun!.jobName : getChatDisplayTitle(chat)
  const isNewRepo = chat.repo === "__new__"
  const hasBranchOnGitHub = !isNewRepo && chat.branch && chat.sandboxId
  const githubBranchUrl = hasBranchOnGitHub
    ? `https://github.com/${chat.repo}/tree/${chat.branch}`
    : null

  const startEditingTitle = () => {
    setEditTitleValue(chatTitle)
    setIsEditingTitle(true)
    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 0)
  }

  const saveTitle = () => {
    const trimmed = editTitleValue.trim()
    if (trimmed && trimmed !== chatTitle && onUpdateChat) {
      onUpdateChat({ displayName: trimmed })
    }
    setIsEditingTitle(false)
  }

  const cancelEditingTitle = () => {
    setIsEditingTitle(false)
    setEditTitleValue("")
  }

  return (
    <>
      <div
      className="flex items-center justify-between pt-3"
      style={{
        paddingLeft: "1.625rem",
        paddingRight: "1rem",
        ...(isDesktopApp ? { WebkitAppRegion: "drag" } as React.CSSProperties : {}),
      }}
    >
      <div
        className="flex items-center gap-2 min-w-0"
        style={isDesktopApp ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
      >
        {/* Title */}
        {isEditingTitle ? (
          <Input
            ref={titleInputRef}
            type="text"
            value={editTitleValue}
            onChange={(e) => setEditTitleValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle()
              if (e.key === "Escape") cancelEditingTitle()
            }}
            onBlur={saveTitle}
            className="w-56 font-medium"
          />
        ) : (
          <div className="group/title relative flex items-center gap-[2px] min-w-0" ref={titleMenuRef}>
            <button
              onClick={isJobChat ? undefined : startEditingTitle}
              className={cn(
                "flex h-7 items-center min-w-0 text-sm font-medium text-foreground px-2 rounded-l-md rounded-r-none transition-colors",
                isJobChat ? "cursor-default" : "hover:bg-accent group-hover/title:bg-accent cursor-pointer"
              )}
              title={isJobChat ? undefined : "Click to rename"}
            >
              <span className="truncate">{chatTitle}</span>
            </button>
            <button
              onClick={() => setTitleMenuOpen((v) => !v)}
              className="flex h-7 w-6 items-center justify-center rounded-r-md rounded-l-none text-muted-foreground hover:bg-accent hover:text-foreground group-hover/title:bg-accent group-hover/title:text-foreground transition-colors cursor-pointer"
              aria-label="Chat menu"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {titleMenuOpen && (
              <div className="absolute left-0 top-full mt-1 min-w-[210px] rounded-md border border-border bg-popover shadow-md py-1 z-50">
                {!isJobChat && (
                  <button
                    onClick={() => {
                      setTitleMenuOpen(false)
                      startEditingTitle()
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </button>
                )}
                {githubBranchUrl && (
                  <button
                    onClick={() => {
                      setTitleMenuOpen(false)
                      window.open(githubBranchUrl, "_blank", "noopener,noreferrer")
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left cursor-pointer"
                  >
                    <Github className="h-3.5 w-3.5" />
                    Open in GitHub
                  </button>
                )}
                <button
                  onClick={() => {
                    setTitleMenuOpen(false)
                    onOpenEnvVars?.()
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left cursor-pointer"
                >
                  <span className="h-3.5 w-3.5 flex items-center justify-center text-xs italic font-serif">𝑥</span>
                  Environment Variables
                </button>
                {onOpenSkills && (
                  <button
                    onClick={() => {
                      setTitleMenuOpen(false)
                      onOpenSkills()
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left cursor-pointer"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Skills
                  </button>
                )}
                {isAdmin && onOpenSandboxResize && (
                  <button
                    onClick={() => {
                      setTitleMenuOpen(false)
                      onOpenSandboxResize()
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left cursor-pointer"
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    Increase resources
                  </button>
                )}
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => {
                    setTitleMenuOpen(false)
                    modals.setDeleteConfirmChatId(chat.id)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left text-destructive cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}

        {/* Scheduled-job context — only for chats created by a scheduled
         *  job run (see Chat.scheduledJobRun). This chat IS the real,
         *  interactive chat for that run; this just adds status + a
         *  "previous runs" switcher + job actions inline next to the title,
         *  instead of a separate standalone report view/row. */}
        {chat.scheduledJobRun && onSelectChat && (
          <ChatJobRunHeader run={chat.scheduledJobRun} currentChatId={chat.id} onSelectChat={onSelectChat} />
        )}
      </div>
      <div
        className="flex items-center gap-1"
        style={isDesktopApp ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
      >
        <CreditBalancePill />
        <FolderSyncButton repo={chat.repo} />
        {isRealRepo(chat.repo) && (
          <DeployButton chatId={chat.id} repo={chat.repo} branch={chat.baseBranch} />
        )}
        <ShareButton key={chat.id} chatId={chat.id} initialShareId={chat.shareId} />
        {showCommandPaletteButton && onOpenCommandPalette && (
          <button
            onClick={onOpenCommandPalette}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            title="Commands"
            aria-label="Open commands"
          >
            <Command className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => modals.setHelpOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Help"
          aria-label="Help"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>
      </div>
    </>
  )
}

// =============================================================================
// FolderSyncButton - Desktop-only: clone/open the repo locally (Backgrounder folder)
// =============================================================================

function FolderSyncButton({ repo }: { repo: string }) {
  const { visible, status, error, busy, onClick } = useRepoFolderButton(repo)
  if (!visible) return null

  const title = error
    ? error
    : status === "cloning"
      ? "Cloning locally…"
      : status === "syncing"
        ? "Syncing locally…"
        : status === "ready"
          ? "Open repository folder"
          : "Clone & open repository locally"

  return (
    <button
      onClick={onClick}
      disabled={status === "cloning"}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer disabled:cursor-default",
        error
          ? "text-amber-500 hover:bg-amber-500/10"
          : status === "ready"
            ? "text-green-500 hover:bg-green-500/10"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
      title={title}
      aria-label={title}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FolderDown className="h-4 w-4" />
      )}
    </button>
  )
}

