import { useState, useRef, useCallback, useEffect } from "react"
import type { Branch } from "@/lib/shared/types"
import { PATHS } from "@/lib/shared/constants"

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
  // Track which branch ID has an active auto-suggest in progress
  const [suggestingBranchId, setSuggestingBranchId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Only show suggesting state if it's for the current branch
  const suggesting = suggestingBranchId === branch.id

  // Reset UI state when switching branches (but keep suggestingBranchId to track background work)
  useEffect(() => {
    setRenaming(false)
    setRenameValue("")
  }, [branch.id])

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
      // Update URL to reflect the new branch name
      const url = `/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/${newName.split("/").map(encodeURIComponent).join("/")}`
      window.history.replaceState(null, "", url)
      setRenaming(false)
    } catch (err: unknown) {
      addSystemMessage(`::icon-error:: **Rename failed:** ${err instanceof Error ? err.message : "Unknown error"}`)
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
      addSystemMessage(
        "::icon-info:: **No conversation history** to generate a branch name suggestion from."
      )
      return
    }

    const targetBranchId = branch.id
    setSuggestingBranchId(targetBranchId)
    setRenaming(true)
    setRenameValue("loading...") // Show loading state

    try {
      const res = await fetch("/api/branches/suggest-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: targetBranchId }),
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
      addSystemMessage(`::icon-error:: **Suggestion failed:** ${err instanceof Error ? err.message : "Unknown error"}`)
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
      setSuggestingBranchId(null)
    }
  }, [branch.id, branch.name, branch.messages.length, addSystemMessage])

  /**
   * Automatically suggests and applies a branch name based on conversation history.
   * Unlike suggestBranchName, this does NOT require confirmation but still shows loading state.
   * Used when the user sends their first message without changing the branch name.
   *
   * @param prompt - Optional prompt to use for immediate suggestion (before message is saved to DB)
   */
  const autoSuggestBranchName = useCallback(async (prompt?: string) => {
    // Only auto-suggest if the user hasn't manually renamed the branch
    if (branch.hasCustomName) {
      return
    }

    // Capture branch info at call time to avoid stale closures
    const targetBranchId = branch.id
    const targetBranchName = branch.name
    const targetSandboxId = branch.sandboxId

    // Background rename only — do not set `renaming` (that mounts the title input
    // with autoFocus and steals focus from the chat textarea).
    setSuggestingBranchId(targetBranchId)

    try {
      const res = await fetch("/api/branches/suggest-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: targetBranchId, prompt }),
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
          sandboxId: targetSandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "rename-branch",
          currentBranch: targetBranchName,
          newBranchName: suggestedName,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })

      if (renameRes.ok) {
        onUpdateBranch(targetBranchId, { name: suggestedName })
        // Only update URL if this branch is still the active branch.
        // If the user switched branches during the async rename, we shouldn't
        // change the URL to point to this branch (that would switch them back).
        if (branch.id === targetBranchId) {
          const url = `/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/${suggestedName.split("/").map(encodeURIComponent).join("/")}`
          window.history.replaceState(null, "", url)
        }
      }
      // Silently fail if rename doesn't work - auto-suggestion is not critical
    } catch (err) {
      // Silently fail - auto-suggestion is not critical
      console.warn("Auto branch name suggestion failed:", err)
    } finally {
      setSuggestingBranchId(null)
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
