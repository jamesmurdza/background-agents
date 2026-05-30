"use client"

import { useState, useRef } from "react"
import { AlertTriangle, ChevronDown, Github, X, Pencil, Trash2, Loader2, Command, Folder, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { useElectron } from "@/lib/hooks/useElectron"
import { useRepoFolderButton } from "@/lib/hooks/useLocalSync"
import { useModals, useGit } from "@/lib/contexts"
import { Input } from "../ui/input"
import type { Chat } from "@/lib/types"
import type { RebaseConflictState } from "@background-agents/common"

// =============================================================================
// ChatHeader - Title bar with conflict indicator and title menu
// =============================================================================

interface ChatHeaderProps {
  chat: Chat
  onUpdateChat?: (updates: Partial<Chat>) => void
  onOpenEnvVars?: () => void
  onOpenCommandPalette?: () => void
}

export function ChatHeader({
  chat,
  onUpdateChat,
  onOpenEnvVars,
  onOpenCommandPalette,
}: ChatHeaderProps) {
  const modals = useModals()
  const git = useGit()
  const { isDesktopApp } = useElectron()

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState("")
  const [titleMenuOpen, setTitleMenuOpen] = useState(false)
  const titleMenuRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Conflict menu state
  const [conflictMenuOpen, setConflictMenuOpen] = useState(false)
  const conflictMenuRef = useRef<HTMLDivElement>(null)

  // Conflict state
  const rebaseConflict = git.rebaseConflict
  const inConflict = !!(rebaseConflict?.inRebase || rebaseConflict?.inMerge)
  const isMergeConflict = rebaseConflict?.inMerge ?? false

  // Close menus on outside click
  useClickOutside(titleMenuRef, () => setTitleMenuOpen(false), titleMenuOpen)
  useClickOutside(conflictMenuRef, () => setConflictMenuOpen(false), conflictMenuOpen)

  const chatTitle = chat.displayName || "Untitled"
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
    <div
      className="flex items-center justify-between pt-3"
      style={{
        paddingLeft: "1.625rem",
        paddingRight: "1rem",
        ...(isDesktopApp ? { WebkitAppRegion: "drag" } as React.CSSProperties : {}),
      }}
    >
      <div
        className="flex items-center gap-2"
        style={isDesktopApp ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
      >
        {/* Conflict indicator */}
        {inConflict && (
          <ConflictIndicator
            rebaseConflict={rebaseConflict}
            isMergeConflict={isMergeConflict}
            conflictMenuOpen={conflictMenuOpen}
            setConflictMenuOpen={setConflictMenuOpen}
            conflictMenuRef={conflictMenuRef}
            onAbort={() => git.handleAbortConflict?.()}
            actionLoading={git.actionLoading}
          />
        )}

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
          <div className="group/title relative flex items-center gap-[2px]" ref={titleMenuRef}>
            <button
              onClick={startEditingTitle}
              className="flex h-7 items-center text-sm font-medium text-foreground px-2 rounded-l-md rounded-r-none hover:bg-accent group-hover/title:bg-accent transition-colors cursor-pointer"
              title="Click to rename"
            >
              {chatTitle}
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
      </div>
      <div
        className="flex items-center gap-1"
        style={isDesktopApp ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
      >
        <FolderSyncButton repo={chat.repo} />
        {onOpenCommandPalette && (
          <button
            onClick={onOpenCommandPalette}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            title="Commands"
            aria-label="Open commands"
          >
            <Command className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
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
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
      title={title}
      aria-label={title}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : status === "ready" ? (
        <FolderOpen className="h-4 w-4" />
      ) : (
        <Folder className="h-4 w-4" />
      )}
    </button>
  )
}

// =============================================================================
// ConflictIndicator - Shows conflict warning with abort option
// =============================================================================

interface ConflictIndicatorProps {
  rebaseConflict: RebaseConflictState | null
  isMergeConflict: boolean
  conflictMenuOpen: boolean
  setConflictMenuOpen: (open: boolean) => void
  conflictMenuRef: React.RefObject<HTMLDivElement | null>
  onAbort: () => void
  actionLoading: boolean
}

function ConflictIndicator({
  rebaseConflict,
  isMergeConflict,
  conflictMenuOpen,
  setConflictMenuOpen,
  conflictMenuRef,
  onAbort,
  actionLoading,
}: ConflictIndicatorProps) {
  return (
    <div className="relative" ref={conflictMenuRef}>
      <button
        onClick={() => setConflictMenuOpen(!conflictMenuOpen)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
        title={isMergeConflict ? "Merge conflict" : "Rebase conflict"}
      >
        <AlertTriangle className="h-4 w-4" />
      </button>
      {conflictMenuOpen && (
        <div className="absolute left-0 top-full mt-1 min-w-[220px] rounded-md border border-border bg-popover shadow-md py-1 z-50">
          <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
            {isMergeConflict ? "Merge" : "Rebase"} conflict in progress
          </div>
          {rebaseConflict?.conflictedFiles && rebaseConflict.conflictedFiles.length > 0 && (
            <div className="px-3 py-2 border-b border-border">
              <div className="text-xs text-muted-foreground mb-1">Conflicted files:</div>
              <div className="space-y-0.5">
                {rebaseConflict.conflictedFiles.slice(0, 5).map((file) => (
                  <div key={file} className="text-xs text-foreground truncate font-mono">
                    {file}
                  </div>
                ))}
                {rebaseConflict.conflictedFiles.length > 5 && (
                  <div className="text-xs text-muted-foreground">
                    +{rebaseConflict.conflictedFiles.length - 5} more
                  </div>
                )}
              </div>
            </div>
          )}
          <button
            onClick={() => {
              setConflictMenuOpen(false)
              onAbort()
            }}
            disabled={actionLoading}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left text-destructive cursor-pointer disabled:opacity-50"
          >
            {actionLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            {isMergeConflict ? "Abort Merge" : "Abort Rebase"}
          </button>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// MobileConflictBar - Conflict indicator for mobile
// =============================================================================

interface MobileConflictBarProps {
  rebaseConflict: RebaseConflictState | null
  isMergeConflict: boolean
  onAbort: () => void
  actionLoading: boolean
}

export function MobileConflictBar({
  rebaseConflict,
  isMergeConflict,
  onAbort,
  actionLoading,
}: MobileConflictBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 text-xs bg-amber-500/10 border-b border-amber-500/20">
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>{isMergeConflict ? "Merge" : "Rebase"} conflict</span>
        {rebaseConflict?.conflictedFiles && rebaseConflict.conflictedFiles.length > 0 && (
          <span className="text-amber-500/70">({rebaseConflict.conflictedFiles.length} files)</span>
        )}
      </div>
      <button
        onClick={onAbort}
        disabled={actionLoading}
        className="flex items-center gap-1 text-destructive hover:text-destructive/80 disabled:opacity-50"
      >
        {actionLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <X className="h-3.5 w-3.5" />
        )}
        Abort
      </button>
    </div>
  )
}
