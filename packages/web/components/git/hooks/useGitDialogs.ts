"use client"

import { useState, useCallback, useEffect } from "react"
import type { Branch, Message } from "@/lib/shared/types"
import { generateId } from "@/lib/shared/store"
import { PATHS } from "@/lib/shared/constants"

// Export the return type for use in components
export type UseGitDialogsReturn = ReturnType<typeof useGitDialogs>

// Conflict state type (covers both rebase and merge conflicts)
export interface RebaseConflictState {
  inRebase: boolean
  inMerge?: boolean
  conflictedFiles: string[]
}

interface UseGitDialogsOptions {
  branch: Branch | null
  repoName: string
  repoOwner: string
  repoFullName: string
  onAddMessage: (branchId: string, message: Message) => Promise<string>
}

/**
 * Shared hook for git dialog operations: merge, rebase, tag
 * Used by both mobile and desktop interfaces
 */
export function useGitDialogs({
  branch,
  repoName,
  repoOwner,
  repoFullName,
  onAddMessage,
}: UseGitDialogsOptions) {
  const branchId = branch?.id ?? ""
  const branchName = branch?.name ?? ""
  const branchBaseName = branch?.baseBranch ?? ""
  const sandboxId = branch?.sandboxId ?? ""

  // Dialog open states
  const [mergeOpen, setMergeOpen] = useState(false)
  const [rebaseOpen, setRebaseOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)

  // Shared state for branch picker dialogs
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState("")
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Merge-specific state
  const [mergeDirection, setMergeDirection] = useState<"into-current" | "from-current">("from-current")
  const [squashMerge, setSquashMerge] = useState(false)

  // Tag-specific state
  const [tagNameInput, setTagNameInput] = useState("")

  // Rebase/merge conflict state
  const [rebaseConflict, setRebaseConflict] = useState<RebaseConflictState>({
    inRebase: false,
    inMerge: false,
    conflictedFiles: [],
  })

  const addSystemMessage = useCallback((content: string) => {
    if (!branchId) return
    onAddMessage(branchId, {
      id: generateId(),
      role: "assistant",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })
  }, [branchId, onAddMessage])

  const fetchBranches = useCallback(async () => {
    if (!branch) {
      setRemoteBranches([])
      setSelectedBranch("")
      return
    }
    setBranchesLoading(true)
    try {
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(repoOwner)}&repo=${encodeURIComponent(repoName)}`
      )
      const data = await res.json()
      const branches = (data.branches || []).filter((b: string) => b !== branchName)
      setRemoteBranches(branches)
      setSelectedBranch(branches.includes(branchBaseName) ? branchBaseName : branches[0] || "")
    } catch {
      setRemoteBranches([])
    } finally {
      setBranchesLoading(false)
    }
  }, [repoOwner, repoName, branch, branchName, branchBaseName])

  // Reset merge UI only when a dialog opens — not when fetchBranches identity changes
  useEffect(() => {
    if (mergeOpen || rebaseOpen) {
      setSelectedBranch("")
      setMergeDirection("from-current")
      setSquashMerge(false)
    }
  }, [mergeOpen, rebaseOpen])

  useEffect(() => {
    if (mergeOpen || rebaseOpen) {
      fetchBranches()
    }
  }, [mergeOpen, rebaseOpen, fetchBranches])

  // Reset tag input when dialog opens
  useEffect(() => {
    if (tagOpen) {
      setTagNameInput("")
    }
  }, [tagOpen])

  const toggleMergeDirection = useCallback(() => {
    setMergeDirection(prev => prev === "into-current" ? "from-current" : "into-current")
  }, [])

  const handleMerge = useCallback(async () => {
    if (!selectedBranch || !branch || !sandboxId) return
    setActionLoading(true)

    const sourceBranch = mergeDirection === "from-current" ? branchName : selectedBranch
    const targetBranch = mergeDirection === "from-current" ? selectedBranch : branchName

    const [ownerFromFull, repoFromFull] = repoFullName.split("/")
    const apiOwner = repoOwner || ownerFromFull || ""
    const apiRepo = repoName || repoFromFull || ""

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "merge",
          targetBranch: targetBranch,
          currentBranch: sourceBranch,
          squash: squashMerge,
          repoOwner: apiOwner,
          repoApiName: apiRepo,
        }),
      })
      const data = await res.json()

      // Check for conflict response
      if (res.status === 409 && data.conflict) {
        // Set conflict state
        setRebaseConflict({
          inRebase: false,
          inMerge: true,
          conflictedFiles: data.conflictedFiles || [],
        })

        // Show user-facing message about the conflict
        const fileList = (data.conflictedFiles || [])
          .map((f: string) => `- \`${f}\``)
          .join('\n')

        addSystemMessage(
          `⚠️ **Merge conflict detected**\n\n` +
          `Merging **${sourceBranch}** into **${targetBranch}** resulted in conflicts.\n\n` +
          `**Conflicted files:**\n${fileList}\n\n` +
          `You can ask the agent to resolve these conflicts, or click **Abort Merge** to cancel.`
        )
        setMergeOpen(false)
        return
      }

      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`${squashMerge ? "Squash merged" : "Merged"} **${sourceBranch}** into **${targetBranch}** and pushed.`)
      setMergeOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`Merge failed: ${err instanceof Error ? err.message : "Unknown error"}`)
      setMergeOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branch, sandboxId, branchName, repoName, repoOwner, repoFullName, addSystemMessage, mergeDirection, squashMerge])

  const handleRebase = useCallback(async () => {
    if (!selectedBranch || !branch || !sandboxId) return
    setActionLoading(true)

    const [ownerFromFull, repoFromFull] = repoFullName.split("/")
    const apiOwner = repoOwner || ownerFromFull || ""
    const apiRepo = repoName || repoFromFull || ""

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "rebase",
          targetBranch: selectedBranch,
          currentBranch: branchName,
          repoOwner: apiOwner,
          repoApiName: apiRepo,
        }),
      })
      const data = await res.json()

      // Check for conflict response
      if (res.status === 409 && data.conflict) {
        // Set conflict state
        setRebaseConflict({
          inRebase: true,
          conflictedFiles: data.conflictedFiles || [],
        })

        // Show user-facing message about the conflict
        const fileList = (data.conflictedFiles || [])
          .map((f: string) => `- \`${f}\``)
          .join('\n')

        addSystemMessage(
          `⚠️ **Rebase conflict detected**\n\n` +
          `Rebasing **${branchName}** onto **${selectedBranch}** resulted in conflicts.\n\n` +
          `**Conflicted files:**\n${fileList}\n\n` +
          `You can ask the agent to resolve these conflicts, or click **Abort Rebase** to cancel.`
        )
        setRebaseOpen(false)
        return
      }

      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Rebased **${branchName}** onto **${selectedBranch}** and force-pushed.`)
      setRebaseOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`Rebase failed: ${err instanceof Error ? err.message : "Unknown error"}`)
      setRebaseOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branch, sandboxId, branchName, repoOwner, repoName, repoFullName, addSystemMessage])

  const handleTag = useCallback(async () => {
    const name = tagNameInput.trim()
    if (!name || !branch || !sandboxId) return
    setActionLoading(true)

    const [owner, repo] = repoFullName.split("/")

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "tag",
          tagName: name,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Tag **${name}** created and pushed.`)
      setTagOpen(false)
      setTagNameInput("")
    } catch (err: unknown) {
      addSystemMessage(`Tag failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(false)
    }
  }, [tagNameInput, branch, sandboxId, repoFullName, repoName, addSystemMessage])

  // Abort an in-progress rebase or merge - auto-detects which one
  const handleAbortRebase = useCallback(async () => {
    if (!sandboxId) return
    setActionLoading(true)

    // Determine which action to use based on current conflict state
    const action = rebaseConflict.inMerge ? "abort-merge" : "abort-rebase"
    const actionLabel = rebaseConflict.inMerge ? "Merge" : "Rebase"

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      // Clear conflict state
      setRebaseConflict({ inRebase: false, inMerge: false, conflictedFiles: [] })
      addSystemMessage(`${actionLabel} aborted. Your branch is back to its previous state.`)
    } catch (err: unknown) {
      addSystemMessage(`Abort failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(false)
    }
  }, [sandboxId, repoName, addSystemMessage, rebaseConflict.inMerge])

  // Check if repo is currently in a rebase or merge conflict state (for live detection)
  const checkRebaseStatus = useCallback(async () => {
    if (!sandboxId) return

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "check-rebase-status",
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setRebaseConflict({
          inRebase: data.inRebase || false,
          inMerge: data.inMerge || false,
          conflictedFiles: data.conflictedFiles || [],
        })
      }
    } catch {
      // Ignore errors - non-critical check
    }
  }, [sandboxId, repoName])

  // Check rebase status on mount and when branch changes
  useEffect(() => {
    if (sandboxId) {
      checkRebaseStatus()
    }
  }, [sandboxId, checkRebaseStatus])

  return {
    // Dialog open states
    mergeOpen,
    setMergeOpen,
    rebaseOpen,
    setRebaseOpen,
    tagOpen,
    setTagOpen,

    // Loading states
    branchesLoading,
    actionLoading,

    // Branch picker state
    remoteBranches,
    selectedBranch,
    setSelectedBranch,

    // Merge state
    mergeDirection,
    toggleMergeDirection,
    squashMerge,
    setSquashMerge,

    // Tag state
    tagNameInput,
    setTagNameInput,

    // Current branch info (for display)
    branchName,

    // Actions
    handleMerge,
    handleRebase,
    handleTag,
    handleAbortRebase,
    checkRebaseStatus,

    // Rebase conflict state
    rebaseConflict,
  }
}
