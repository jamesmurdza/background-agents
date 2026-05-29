"use client"

import { useState, useEffect } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2 } from "lucide-react"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { createRepository } from "@/lib/github"

interface CreateRepoModalProps {
  open: boolean
  onClose: () => void
  /** Called with the new repo's `full_name` and `default_branch` after a successful create. */
  onSelect: (repo: string, branch: string) => void
  isMobile?: boolean
  /** Pre-fill the Name field with a slugified version of this string (typically the chat's display name). */
  suggestedName?: string | null
}

// Slugify a chat title into a GitHub-friendly repo name: lowercase, hyphenated,
// alphanumerics only, trimmed to GitHub's 100-char limit.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
}

/**
 * Create-Repository dialog.
 *
 * Replaces the old multi-mode RepoPickerModal — repo and branch *selection*
 * now happens inline via RepoCombobox/BranchCombobox in the chat input. This
 * modal only exists for the create-new-repo flow, which is reached from:
 *   - the command palette ("Create Repository")
 *   - the `/repo` slash command in ChatPanel
 *   - the "+ Create new repository" item in RepoCombobox's dropdown
 *
 * On success, fires `onSelect(repo.full_name, repo.default_branch)` so the
 * caller can assign the new repo to the current chat (and push to the remote
 * if a sandbox already exists — handled in page.tsx's handleRepoSelect).
 */
export function CreateRepoModal({
  open,
  onClose,
  onSelect,
  isMobile = false,
  suggestedName = null,
}: CreateRepoModalProps) {
  const [newRepoName, setNewRepoName] = useState("")
  const [newRepoDescription, setNewRepoDescription] = useState("")
  const [newRepoIsPrivate, setNewRepoIsPrivate] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Drag to dismiss (mobile only)
  const { handlers: dragHandlers, dragY, isDragging } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  // Reset on close; prefill the name from the suggested chat title on open.
  useEffect(() => {
    if (open) {
      if (suggestedName) {
        setNewRepoName((prev) => prev || slugify(suggestedName))
      }
    } else {
      setNewRepoName("")
      setNewRepoDescription("")
      setNewRepoIsPrivate(true)
      setCreating(false)
      setError(null)
    }
  }, [open, suggestedName])

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) {
      setError("Repository name is required")
      return
    }

    // Validate repo name format
    const nameRegex = /^[a-zA-Z0-9._-]+$/
    if (!nameRegex.test(newRepoName.trim())) {
      setError("Repository name can only contain alphanumeric characters, hyphens, underscores, and periods")
      return
    }

    setCreating(true)
    setError(null)

    try {
      const repo = await createRepository({
        name: newRepoName.trim(),
        description: newRepoDescription.trim() || undefined,
        isPrivate: newRepoIsPrivate,
      })

      // Select the newly created repo and complete
      onSelect(repo.full_name, repo.default_branch)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create repository")
    } finally {
      setCreating(false)
    }
  }

  // Submit on Enter from any text input in the form
  const handleFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !creating && newRepoName.trim()) {
      e.preventDefault()
      handleCreateRepo()
    }
  }

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
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            // Focus the Name input when the dialog opens.
            setTimeout(() => {
              const input = document.querySelector<HTMLInputElement>(
                "[data-repo-create-name]"
              )
              input?.focus()
              input?.select()
            }, 0)
          }}
          className={cn(
            "fixed z-50 bg-popover flex flex-col overflow-hidden",
            isMobile
              ? "inset-x-0 bottom-0 top-0 rounded-none"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md border border-border rounded-lg shadow-xl",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? { transform: `translateY(${dragY}px)` } : undefined}
        >
          {/* Draggable header area */}
          <div {...dragHandlers}>
            {isMobile && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>
            )}

            <ModalHeader title="Create Repository" />
          </div>

          {/* Form */}
          <div
            className={cn(
              "flex-1 mobile-scroll overflow-y-auto",
              isMobile ? "max-h-none" : "max-h-80"
            )}
          >
            <div className={cn(isMobile ? "p-4" : "p-4")}>
              {error && (
                <div
                  className={cn(
                    "text-destructive mb-4 p-3 bg-destructive/10 rounded-md",
                    isMobile ? "text-base" : "text-sm"
                  )}
                >
                  {error}
                </div>
              )}

              <div className="space-y-5">
                {/* Repository Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium block">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="text"
                    data-repo-create-name
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    onKeyDown={handleFormKeyDown}
                    placeholder="my-new-repo"
                    disabled={creating}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium block">Description</label>
                  <Input
                    type="text"
                    value={newRepoDescription}
                    onChange={(e) => setNewRepoDescription(e.target.value)}
                    onKeyDown={handleFormKeyDown}
                    placeholder="Optional"
                    disabled={creating}
                  />
                </div>

                {/* Visibility */}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium block">Visibility</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRepoIsPrivate}
                      onChange={(e) => setNewRepoIsPrivate(e.target.checked)}
                      disabled={creating}
                      className="h-4 w-4 rounded border-border accent-primary disabled:opacity-50"
                    />
                    <span className="text-sm">Private</span>
                  </label>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-3">
                  <button
                    onClick={onClose}
                    disabled={creating}
                    className="rounded-md hover:bg-accent transition-colors disabled:opacity-50 px-3 py-1.5 text-sm cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateRepo}
                    disabled={creating || !newRepoName.trim()}
                    className="bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer"
                  >
                    {creating && <Loader2 className="animate-spin h-3.5 w-3.5" />}
                    {creating ? "Creating..." : "Create"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
