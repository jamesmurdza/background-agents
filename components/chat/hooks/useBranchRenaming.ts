import { useState, useRef, useCallback } from "react"
import type { Branch } from "@/lib/types"
import { PATHS } from "@/lib/constants"

// Export the return type for use in sub-components
export type UseBranchRenamingReturn = ReturnType<typeof useBranchRenaming>

interface UseBranchRenamingOptions {
  branch: Branch
  repoName: string
  repoFullName: string
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  addSystemMessage: (content: string) => void
  /** Whether the user has an API key that supports branch name suggestion */
  canSuggestName?: boolean
}

/**
 * Handles branch renaming UI state and logic
 */
export function useBranchRenaming({
  branch,
  repoName,
  repoFullName,
  onUpdateBranch,
  addSystemMessage,
  canSuggestName = false,
}: UseBranchRenamingOptions) {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [renameLoading, setRenameLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const handleRename = useCallback(async () => {
    const newName = renameValue.trim()
    if (!newName || newName === branch.name || renameLoading) return
    setRenameLoading(true)
    try {
      const [owner, repo] = repoFullName.split("/")
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "rename-branch",
          currentBranch: branch.name,
          newBranchName: newName,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdateBranch(branch.id, { name: newName, hasCustomName: true })
      setRenaming(false)
    } catch (err: unknown) {
      addSystemMessage(`Rename failed: ${err instanceof Error ? err.message : "Unknown error"}`)
      setRenaming(false)
    } finally {
      setRenameLoading(false)
    }
  }, [renameValue, branch.name, branch.sandboxId, repoName, repoFullName, renameLoading, onUpdateBranch, addSystemMessage])

  const startRenaming = useCallback(() => {
    setRenaming(true)
    setRenameValue(branch.name)
  }, [branch.name])

  const cancelRenaming = useCallback(() => {
    if (!renameLoading) {
      setRenaming(false)
    }
  }, [renameLoading])

  /**
   * Suggests a branch name based on conversation history using AI.
   * Enters edit mode with the suggestion pre-filled.
   */
  const suggestBranchName = useCallback(async () => {
    // Only allow if there are messages to base suggestion on
    if (branch.messages.length === 0) {
      addSystemMessage("No conversation history to generate a branch name suggestion from.")
      return
    }

    setSuggesting(true)
    setRenaming(true)
    setRenameValue("loading...") // Show loading state

    try {
      const res = await fetch("/api/branches/suggest-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: branch.id }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate suggestion")
      }

      const suggestedName = data.suggestedName
      setRenameValue(suggestedName)
      // Focus the input with cursor at the end after React re-renders
      requestAnimationFrame(() => {
        const input = renameInputRef.current
        if (input) {
          input.focus()
          const len = suggestedName.length
          input.setSelectionRange(len, len)
        }
      })
    } catch (err: unknown) {
      // On error, fall back to current branch name
      const fallbackName = branch.name
      setRenameValue(fallbackName)
      addSystemMessage(`Suggestion failed: ${err instanceof Error ? err.message : "Unknown error"}`)
      // Still focus the input on error
      requestAnimationFrame(() => {
        const input = renameInputRef.current
        if (input) {
          input.focus()
          const len = fallbackName.length
          input.setSelectionRange(len, len)
        }
      })
    } finally {
      setSuggesting(false)
    }
  }, [branch.id, branch.name, branch.messages.length, addSystemMessage])

  /**
   * Automatically suggests and applies a branch name based on conversation history.
   * Unlike suggestBranchName, this does NOT enter edit mode or require confirmation.
   * Used when the user sends their first message without changing the branch name.
   */
  const autoSuggestBranchName = useCallback(async () => {
    // Only auto-suggest if the user hasn't manually renamed the branch
    if (branch.hasCustomName) {
      return
    }

    try {
      const res = await fetch("/api/branches/suggest-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: branch.id }),
      })

      const data = await res.json()

      if (!res.ok) {
        // Silently fail - auto-suggestion is not critical
        console.warn("Auto branch name suggestion failed:", data.error)
        return
      }

      const suggestedName = data.suggestedName

      // Apply the rename directly via API
      const [owner, repo] = repoFullName.split("/")
      const renameRes = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "rename-branch",
          currentBranch: branch.name,
          newBranchName: suggestedName,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })

      if (renameRes.ok) {
        onUpdateBranch(branch.id, { name: suggestedName })
      }
      // Silently fail if rename doesn't work - auto-suggestion is not critical
    } catch (err) {
      // Silently fail - auto-suggestion is not critical
      console.warn("Auto branch name suggestion failed:", err)
    }
  }, [branch.id, branch.name, branch.hasCustomName, branch.sandboxId, repoName, repoFullName, onUpdateBranch])

  return {
    renaming,
    setRenaming,
    renameValue,
    setRenameValue,
    renameLoading,
    renameInputRef,
    handleRename,
    startRenaming,
    cancelRenaming,
    // Suggestion features
    suggesting,
    suggestBranchName,
    autoSuggestBranchName,
    canSuggestName: canSuggestName && branch.messages.length > 0,
  }
}
