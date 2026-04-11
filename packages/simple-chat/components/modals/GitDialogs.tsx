"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Loader2, GitMerge, GitBranch, GitPullRequest, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat } from "@/lib/types"

// ============================================================================
// Shared Dialog Component
// ============================================================================

interface BaseDialogProps {
  open: boolean
  onClose: () => void
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  isMobile?: boolean
}

function BaseDialog({ open, onClose, title, icon, children, isMobile = false }: BaseDialogProps) {
  // Swipe to dismiss state (mobile only)
  const [isDragging, setIsDragging] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [startY, setStartY] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  const SWIPE_THRESHOLD = 100

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    const content = contentRef.current
    if (content && content.scrollTop > 0) return
    setIsDragging(true)
    setStartY(e.touches[0].clientY)
    setDragY(0)
  }, [isMobile])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || !isMobile) return
    const diff = e.touches[0].clientY - startY
    if (diff > 0) setDragY(diff)
  }, [isDragging, startY, isMobile])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging || !isMobile) return
    setIsDragging(false)
    if (dragY > SWIPE_THRESHOLD) onClose()
    setDragY(0)
  }, [isDragging, dragY, onClose, isMobile])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh]"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-lg shadow-lg",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? { transform: `translateY(${dragY}px)` } : undefined}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Drag handle for mobile */}
          {isMobile && (
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
          )}

          {/* Header */}
          <div className={cn(
            "flex items-center justify-between border-b border-border",
            isMobile ? "px-4 py-3" : "px-4 py-3"
          )}>
            <Dialog.Title className={cn(
              "flex items-center gap-2 font-semibold",
              isMobile ? "text-lg" : "text-sm"
            )}>
              {icon}
              {title}
            </Dialog.Title>
            <Dialog.Close className={cn(
              "rounded-lg hover:bg-accent transition-colors",
              isMobile ? "p-2 -mr-2" : "p-1"
            )}>
              <X className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
            </Dialog.Close>
          </div>

          {/* Content */}
          <div ref={contentRef} className={cn(
            "flex-1 overflow-y-auto",
            isMobile ? "p-4" : "p-4"
          )}>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ============================================================================
// Merge Dialog
// ============================================================================

interface MergeDialogProps {
  open: boolean
  onClose: () => void
  chat: Chat | null
  onExecuteGitCommand: (command: string) => void
  isMobile?: boolean
}

export function MergeDialog({ open, onClose, chat, onExecuteGitCommand, isMobile = false }: MergeDialogProps) {
  const [targetBranch, setTargetBranch] = useState("")
  const [squash, setSquash] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setTargetBranch(chat?.baseBranch || "main")
      setSquash(false)
    }
  }, [open, chat?.baseBranch])

  const handleMerge = async () => {
    if (!targetBranch || !chat?.branch) return
    setLoading(true)
    try {
      const squashFlag = squash ? "--squash" : ""
      onExecuteGitCommand(`git checkout ${targetBranch} && git merge ${squashFlag} ${chat.branch} && git push origin ${targetBranch}`)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Merge Branch"
      icon={<GitMerge className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
    >
      <div className={cn("space-y-4", isMobile && "space-y-5")}>
        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>From branch</label>
          <div className={cn(
            "bg-muted/50 rounded-md px-3 font-medium truncate",
            isMobile ? "py-3 text-base" : "py-2 text-sm"
          )}>
            {chat?.branch || "No branch"}
          </div>
        </div>

        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Into branch</label>
          <input
            type="text"
            value={targetBranch}
            onChange={(e) => setTargetBranch(e.target.value)}
            placeholder="main"
            className={cn(
              "w-full bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring",
              isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
            )}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={squash}
            onChange={(e) => setSquash(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className={cn(
            "text-muted-foreground",
            isMobile ? "text-base" : "text-sm"
          )}>Squash commits</span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className={cn(
              "rounded-md hover:bg-accent transition-colors",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={!targetBranch || loading}
            className={cn(
              "rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Merge
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}

// ============================================================================
// Rebase Dialog
// ============================================================================

interface RebaseDialogProps {
  open: boolean
  onClose: () => void
  chat: Chat | null
  onExecuteGitCommand: (command: string) => void
  isMobile?: boolean
}

export function RebaseDialog({ open, onClose, chat, onExecuteGitCommand, isMobile = false }: RebaseDialogProps) {
  const [ontoBranch, setOntoBranch] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setOntoBranch(chat?.baseBranch || "main")
    }
  }, [open, chat?.baseBranch])

  const handleRebase = async () => {
    if (!ontoBranch || !chat?.branch) return
    setLoading(true)
    try {
      onExecuteGitCommand(`git fetch origin ${ontoBranch} && git rebase origin/${ontoBranch} && git push --force-with-lease origin ${chat.branch}`)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Rebase Branch"
      icon={<GitBranch className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
    >
      <div className={cn("space-y-4", isMobile && "space-y-5")}>
        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Rebase</label>
          <div className={cn(
            "bg-muted/50 rounded-md px-3 font-medium truncate",
            isMobile ? "py-3 text-base" : "py-2 text-sm"
          )}>
            {chat?.branch || "No branch"}
          </div>
        </div>

        <div>
          <label className={cn(
            "block text-muted-foreground mb-1",
            isMobile ? "text-sm" : "text-xs"
          )}>Onto branch</label>
          <input
            type="text"
            value={ontoBranch}
            onChange={(e) => setOntoBranch(e.target.value)}
            placeholder="main"
            className={cn(
              "w-full bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring",
              isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
            )}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className={cn(
              "rounded-md hover:bg-accent transition-colors",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            Cancel
          </button>
          <button
            onClick={handleRebase}
            disabled={!ontoBranch || loading}
            className={cn(
              "rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Rebase
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}

// ============================================================================
// PR Dialog
// ============================================================================

interface PRDialogProps {
  open: boolean
  onClose: () => void
  chat: Chat | null
  onExecuteGitCommand: (command: string) => void
  isMobile?: boolean
}

export function PRDialog({ open, onClose, chat, onExecuteGitCommand, isMobile = false }: PRDialogProps) {
  const [baseBranch, setBaseBranch] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setBaseBranch(chat?.baseBranch || "main")
    }
  }, [open, chat?.baseBranch])

  const handleCreatePR = async () => {
    if (!baseBranch || !chat?.branch || !chat?.repo) return
    setLoading(true)
    try {
      // Use gh CLI to create PR - title and body will be auto-generated
      onExecuteGitCommand(`gh pr create --base ${baseBranch} --fill`)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const isGitHubRepo = chat?.repo && chat.repo !== "__new__"

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Create Pull Request"
      icon={<GitPullRequest className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />}
      isMobile={isMobile}
    >
      <div className={cn("space-y-4", isMobile && "space-y-5")}>
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
              <label className={cn(
                "block text-muted-foreground mb-1",
                isMobile ? "text-sm" : "text-xs"
              )}>From branch</label>
              <div className={cn(
                "bg-muted/50 rounded-md px-3 font-medium truncate",
                isMobile ? "py-3 text-base" : "py-2 text-sm"
              )}>
                {chat?.branch || "No branch"}
              </div>
            </div>

            <div>
              <label className={cn(
                "block text-muted-foreground mb-1",
                isMobile ? "text-sm" : "text-xs"
              )}>Into branch</label>
              <input
                type="text"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder="main"
                className={cn(
                  "w-full bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring",
                  isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
                )}
              />
            </div>

            <p className={cn(
              "text-muted-foreground",
              isMobile ? "text-sm" : "text-xs"
            )}>
              PR title and description will be generated from your commits.
            </p>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className={cn(
              "rounded-md hover:bg-accent transition-colors",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            Cancel
          </button>
          {isGitHubRepo && (
            <button
              onClick={handleCreatePR}
              disabled={!baseBranch || loading}
              className={cn(
                "rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2",
                isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
              )}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create PR
            </button>
          )}
        </div>
      </div>
    </BaseDialog>
  )
}

// ============================================================================
// Combined Git Dialogs Hook
// ============================================================================

export interface UseGitDialogsResult {
  mergeOpen: boolean
  setMergeOpen: (open: boolean) => void
  rebaseOpen: boolean
  setRebaseOpen: (open: boolean) => void
  prOpen: boolean
  setPROpen: (open: boolean) => void
}

export function useGitDialogs(): UseGitDialogsResult {
  const [mergeOpen, setMergeOpen] = useState(false)
  const [rebaseOpen, setRebaseOpen] = useState(false)
  const [prOpen, setPROpen] = useState(false)

  return {
    mergeOpen,
    setMergeOpen,
    rebaseOpen,
    setRebaseOpen,
    prOpen,
    setPROpen,
  }
}
