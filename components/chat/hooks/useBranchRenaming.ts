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
      onUpdateBranch(branch.id, { name: newName })
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
    setRenameValue("Generating...") // Show loading state

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

      setRenameValue(data.suggestedName)
    } catch (err: unknown) {
      // On error, fall back to current branch name
      setRenameValue(branch.name)
      addSystemMessage(`Suggestion failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setSuggesting(false)
    }
  }, [branch.id, branch.name, branch.messages.length, addSystemMessage])

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
    canSuggestName: canSuggestName && branch.messages.length > 0,
  }
}
