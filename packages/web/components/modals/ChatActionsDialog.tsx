"use client"

import { useCallback } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Archive, Trash2, Link2, Link2Off } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"

interface ChatActionsDialogProps {
  open: boolean
  onClose: () => void
  /** Name shown in the prompt; falls back to "this chat". */
  chatName?: string | null
  /** Whether the chat has a public share link — tailors the warnings. */
  isShared?: boolean
  /** When true the chat is already archived, so the Archive option is hidden. */
  isArchived?: boolean
  onArchive: () => void
  onDelete: () => void
  isMobile?: boolean
}

/**
 * Replaces the plain delete confirmation: instead of immediately removing a
 * chat, the user chooses between Archive (reversible, keeps the share link) and
 * Delete (permanent, drops the share link), or cancels. Each option spells out
 * its consequence so the destructive path is unambiguous.
 */
export function ChatActionsDialog({
  open,
  onClose,
  chatName,
  isShared = false,
  isArchived = false,
  onArchive,
  onDelete,
  isMobile = false,
}: ChatActionsDialogProps) {
  const name = chatName?.trim() || "this chat"

  const handleArchive = useCallback(() => {
    onArchive()
    onClose()
  }, [onArchive, onClose])

  const handleDelete = useCallback(() => {
    onDelete()
    onClose()
  }, [onDelete, onClose])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
            open ? "opacity-100" : "opacity-0"
          )}
        />
        <Dialog.Content
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            focusChatPrompt()
          }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-xl shadow-xl"
          )}
        >
          <ModalHeader title="Manage chat" />
          <div className="px-4 pt-3 pb-4 space-y-3 text-sm">
            <p className="text-muted-foreground">
              What would you like to do with{" "}
              <span className="font-medium text-foreground">{name}</span>?
            </p>

            {/* Archive — reversible, preserves the share link. Hidden once the
                chat is already archived (use Unarchive from its menu instead). */}
            {!isArchived && (
            <button
              onClick={handleArchive}
              className="w-full text-left rounded-lg border border-border hover:bg-accent transition-colors p-3 flex items-start gap-3 cursor-pointer"
            >
              <Archive className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">Archive</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Hides this chat and its branches from your list. You can restore
                  it anytime.
                </span>
                {isShared && (
                  <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mt-1">
                    <Link2 className="h-3 w-3 shrink-0" />
                    Its share link keeps working
                  </span>
                )}
              </span>
            </button>
            )}

            {/* Delete — permanent, drops the share link */}
            <button
              onClick={handleDelete}
              className="w-full text-left rounded-lg border border-destructive/30 hover:bg-destructive/10 transition-colors p-3 flex items-start gap-3 cursor-pointer"
            >
              <Trash2 className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
              <span className="min-w-0">
                <span className="block font-medium text-destructive">Delete</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Permanently deletes this chat and its branches. This cannot be
                  undone.
                </span>
                {isShared && (
                  <span className="flex items-center gap-1.5 text-xs text-destructive mt-1">
                    <Link2Off className="h-3 w-3 shrink-0" />
                    Its share link will stop working
                  </span>
                )}
              </span>
            </button>

            <div className="flex justify-end pt-1">
              <button
                onClick={onClose}
                className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
