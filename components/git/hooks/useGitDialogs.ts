"use client"

import { useState, useCallback, useEffect } from "react"
import type { Branch, Message } from "@/lib/types"
import { generateId } from "@/lib/store"
import { PATHS } from "@/lib/constants"

// Export the return type for use in components
export type UseGitDialogsReturn = ReturnType<typeof useGitDialogs>

interface UseGitDialogsOptions {
  branch: Branch
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

  // Tag-specific state
  const [tagNameInput, setTagNameInput] = useState("")

  const addSystemMessage = useCallback((content: string) => {
    onAddMessage(branch.id, {
      id: generateId(),
      role: "assistant",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })
  }, [branch.id, onAddMessage])

  const fetchBranches = useCallback(async () => {
    setBranchesLoading(true)
    try {
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(repoOwner)}&repo=${encodeURIComponent(repoName)}`
      )
      const data = await res.json()
      const branches = (data.branches || []).filter((b: string) => b !== branch.name)
      setRemoteBranches(branches)
      setSelectedBranch(branches.includes(branch.baseBranch) ? branch.baseBranch : branches[0] || "")
    } catch {
      setRemoteBranches([])
    } finally {
      setBranchesLoading(false)
    }
  }, [repoOwner, repoName, branch.name, branch.baseBranch])

  // Fetch branches when merge or rebase dialog opens
  useEffect(() => {
    if (mergeOpen || rebaseOpen) {
      setSelectedBranch("")
      setMergeDirection("from-current")
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
    if (!selectedBranch) return
    setActionLoading(true)

    const sourceBranch = mergeDirection === "from-current" ? branch.name : selectedBranch
    const targetBranch = mergeDirection === "from-current" ? selectedBranch : branch.name

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "merge",
          targetBranch: targetBranch,
          currentBranch: sourceBranch,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Merged **${sourceBranch}** into **${targetBranch}** and pushed.`)
      setMergeOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`Merge failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branch.sandboxId, branch.name, repoName, addSystemMessage, mergeDirection])

  const handleRebase = useCallback(async () => {
    if (!selectedBranch) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "rebase",
          targetBranch: selectedBranch,
          currentBranch: branch.name,
          repoOwner: repoOwner,
          repoApiName: repoName,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Rebased **${branch.name}** onto **${selectedBranch}** and force-pushed.`)
      setRebaseOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`Rebase failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branch.sandboxId, branch.name, repoOwner, repoName, addSystemMessage])

  const handleTag = useCallback(async () => {
    const name = tagNameInput.trim()
    if (!name) return
    setActionLoading(true)

    const [owner, repo] = repoFullName.split("/")

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
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
  }, [tagNameInput, branch.sandboxId, repoFullName, repoName, addSystemMessage])

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

    // Tag state
    tagNameInput,
    setTagNameInput,

    // Current branch info (for display)
    branchName: branch.name,

    // Actions
    handleMerge,
    handleRebase,
    handleTag,
  }
}
