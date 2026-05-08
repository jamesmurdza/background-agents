"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { PATHS } from "@/lib/constants"
import { EMPTY_CONFLICT_STATE } from "@upstream/common"
import type { UseGitDialogsOptions, UseGitDialogsResult, PRDescriptionType, RebaseConflictState } from "./types"

// ============================================================================
// useGitDialogs Hook
// ============================================================================

export function useGitDialogs({ chat, resolveChatName, getTargetSandboxId, getTargetChatStatus, onMarkBranchNeedsSync, onSetBaseBranch, refetchMessages }: UseGitDialogsOptions): UseGitDialogsResult {
  const chatId = chat?.id ?? ""
  const branchName = chat?.branch ?? ""
  const baseBranch = chat?.baseBranch ?? ""
  const sandboxId = chat?.sandboxId ?? ""
  const repo = chat?.repo ?? ""

  // Parse owner/repo from repo string
  const [repoOwner, repoApiName] = repo.includes("/") ? repo.split("/") : ["", ""]

  // Dialog open states
  const [mergeOpen, setMergeOpen] = useState(false)
  const [rebaseOpen, setRebaseOpen] = useState(false)
  const [prOpen, setPROpen] = useState(false)
  const [squashOpen, setSquashOpen] = useState(false)
  const [forcePushOpen, setForcePushOpen] = useState(false)

  // Shared state for branch picker
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranchState] = useState("")
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Track pre-selected branch from drag-and-drop. This ref is set when
  // setSelectedBranch is called before the dialog opens, and consumed
  // when fetchBranches runs.
  const pendingSelectedBranchRef = useRef<string | null>(null)
  const setSelectedBranch = useCallback((branch: string) => {
    // If a dialog is already open, just set the state directly
    if (mergeOpen || rebaseOpen || prOpen) {
      setSelectedBranchState(branch)
    } else {
      // Store in ref to be consumed when the dialog opens and branches are fetched
      pendingSelectedBranchRef.current = branch
      setSelectedBranchState(branch)
    }
  }, [mergeOpen, rebaseOpen, prOpen])

  // Merge-specific state
  const [squashMerge, setSquashMerge] = useState(false)

  // Squash-specific state
  const [commitsAhead, setCommitsAhead] = useState(0)
  const [commitsLoading, setCommitsLoading] = useState(false)

  // Conflict state - initialize from chat.conflictState (persisted in DB)
  const [rebaseConflict, setRebaseConflict] = useState<RebaseConflictState>(() => {
    if (chat?.conflictState) {
      return chat.conflictState
    }
    return EMPTY_CONFLICT_STATE
  })

  // Keep conflict state in sync when chat changes
  useEffect(() => {
    if (chat?.conflictState) {
      setRebaseConflict(chat.conflictState)
    } else {
      setRebaseConflict(EMPTY_CONFLICT_STATE)
    }
  }, [chat?.id, chat?.conflictState])

  // Always use "project" as the directory name - sandbox/create always uses this
  const repoName = "project"

  // Fetch branches when dialog opens
  const fetchBranches = useCallback(async () => {
    if (!repoOwner || !repoApiName) {
      setRemoteBranches([])
      setSelectedBranchState("")
      return
    }

    setBranchesLoading(true)
    try {
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(repoOwner)}&repo=${encodeURIComponent(repoApiName)}`
      )
      const data = await res.json()
      const branches = (data.branches || [])
        .map((b: { name: string }) => b.name)
        .filter((name: string) => name !== branchName)
      setRemoteBranches(branches)
      // Use pending branch from drag-and-drop if valid, otherwise fall back to baseBranch
      const pendingBranch = pendingSelectedBranchRef.current
      pendingSelectedBranchRef.current = null // Consume the pending value
      const defaultBranch = pendingBranch && branches.includes(pendingBranch)
        ? pendingBranch
        : branches.includes(baseBranch)
          ? baseBranch
          : branches[0] || ""
      setSelectedBranchState(defaultBranch)
    } catch {
      setRemoteBranches([])
    } finally {
      setBranchesLoading(false)
    }
  }, [repoOwner, repoApiName, branchName, baseBranch])

  // Fetch branches when dialogs open
  useEffect(() => {
    if (mergeOpen || rebaseOpen || prOpen) {
      setSquashMerge(false)
      // Set selectedBranch to baseBranch immediately so user can submit while loading
      if (!pendingSelectedBranchRef.current && baseBranch) {
        setSelectedBranchState(baseBranch)
      }
      fetchBranches()
    }
  }, [mergeOpen, rebaseOpen, prOpen, fetchBranches, baseBranch])

  // Handle merge
  const handleMerge = useCallback(async () => {
    if (!selectedBranch || !branchName || !sandboxId || !chatId) return

    // Block merge into a running branch (frontend check only - backend creates the message)
    const targetStatus = getTargetChatStatus?.(selectedBranch)
    if (targetStatus === "running") {
      // The API will create the error message
      setMergeOpen(false)
      return
    }

    setActionLoading(true)

    // Get the target sandbox ID so we can pull the merged changes there
    const targetSandboxId = getTargetSandboxId?.(selectedBranch) ?? null

    // Resolve names for the success message
    const sourceName = chat?.displayName || branchName
    const targetName = resolveChatName?.(selectedBranch) || selectedBranch

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "merge",
          targetBranch: selectedBranch,
          currentBranch: branchName,
          squash: squashMerge,
          repoOwner,
          repoApiName,
          targetSandboxId,
          chatId,
          sourceName,
          targetName,
        }),
      })

      const data = await res.json()

      if (res.status === 409 && data.conflict && data.inMerge) {
        setRebaseConflict({
          inRebase: false,
          inMerge: true,
          conflictedFiles: data.conflictedFiles || [],
        })
        // Message is created by the backend - refetch to show it
        await refetchMessages?.(chatId)
        setMergeOpen(false)
        return
      }

      if (!res.ok) {
        // Error message created by backend - refetch to show it
        await refetchMessages?.(chatId)
        setMergeOpen(false)
        return
      }

      // If sandbox was stopped, mark branch for sync on next wake
      if (data.needsSync && onMarkBranchNeedsSync) {
        onMarkBranchNeedsSync(selectedBranch)
      }

      // If this chat has no parent chat, update base branch to the merge target
      if (!chat?.parentChatId && onSetBaseBranch) {
        onSetBaseBranch(selectedBranch)
      }

      // Success message created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setMergeOpen(false)
    } catch {
      // Error message may have been created by backend on API error - refetch to show it
      await refetchMessages?.(chatId)
      setMergeOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, squashMerge, getTargetSandboxId, getTargetChatStatus, onMarkBranchNeedsSync, chat?.parentChatId, chat?.displayName, onSetBaseBranch, resolveChatName, refetchMessages])

  // Handle rebase
  const handleRebase = useCallback(async () => {
    if (!selectedBranch || !branchName || !sandboxId || !chatId) return
    setActionLoading(true)

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
          repoOwner,
          repoApiName,
          chatId,
        }),
      })

      const data = await res.json()

      if (res.status === 409 && data.conflict) {
        setRebaseConflict({
          inRebase: true,
          inMerge: false,
          conflictedFiles: data.conflictedFiles || [],
        })
        // Message created by backend - refetch to show it
        await refetchMessages?.(chatId)
        setRebaseOpen(false)
        return
      }

      if (!res.ok) {
        // Error message created by backend - refetch to show it
        await refetchMessages?.(chatId)
        setRebaseOpen(false)
        return
      }

      // Success message created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setRebaseOpen(false)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setRebaseOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, refetchMessages])

  // Handle create PR
  const handleCreatePR = useCallback(async (descriptionType: PRDescriptionType = "short") => {
    if (!selectedBranch || !branchName || !repoOwner || !repoApiName || !chatId) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoApiName,
          head: branchName,
          base: selectedBranch,
          descriptionType,
          chatId,
        }),
      })

      // Message created by backend (success or error) - refetch to show it
      await refetchMessages?.(chatId)
      setPROpen(false)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setPROpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branchName, repoOwner, repoApiName, chatId, refetchMessages])

  // Handle force push (temp-branch dance: push commits to a throwaway remote
  // branch so GitHub has the objects, then PATCH the real branch ref to that SHA).
  const handleForcePush = useCallback(async () => {
    if (!branchName || !sandboxId || !repoOwner || !repoApiName || !chatId) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "force-push",
          currentBranch: branchName,
          repoOwner,
          repoApiName,
          chatId,
        }),
      })

      // Message created by backend (success or error) - refetch to show it
      await refetchMessages?.(chatId)
      setForcePushOpen(false)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setForcePushOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, refetchMessages])

  // Handle abort conflict
  const handleAbortConflict = useCallback(async () => {
    if (!sandboxId || !chatId) return
    const isMerge = rebaseConflict.inMerge
    setActionLoading(true)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: isMerge ? "abort-merge" : "abort-rebase",
          chatId,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        // Error message created by backend - refetch to show it
        await refetchMessages?.(chatId)
        return
      }

      setRebaseConflict(EMPTY_CONFLICT_STATE)
      // Success message created by backend - refetch to show it
      await refetchMessages?.(chatId)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
    } finally {
      setActionLoading(false)
    }
  }, [sandboxId, chatId, repoName, rebaseConflict.inMerge, refetchMessages])

  // Fetch commits ahead when squash dialog opens
  const fetchCommitsAhead = useCallback(async () => {
    if (!repoOwner || !repoApiName || !baseBranch || !branchName) {
      setCommitsAhead(0)
      return
    }
    setCommitsLoading(true)
    try {
      const res = await fetch("/api/github/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoApiName,
          base: baseBranch,
          head: branchName,
        }),
      })
      const data = await res.json()
      if (res.ok && typeof data.ahead_by === "number") {
        setCommitsAhead(data.ahead_by)
      } else {
        setCommitsAhead(0)
      }
    } catch {
      setCommitsAhead(0)
    } finally {
      setCommitsLoading(false)
    }
  }, [repoOwner, repoApiName, baseBranch, branchName])

  // Fetch commits ahead when squash dialog opens
  useEffect(() => {
    if (squashOpen) {
      fetchCommitsAhead()
    }
  }, [squashOpen, fetchCommitsAhead])

  // Handle squash
  const handleSquash = useCallback(async () => {
    if (!branchName || !sandboxId || !chatId || commitsAhead < 2) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/github/squash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoApiName,
          head: branchName,
          base: baseBranch,
          sandboxId,
          chatId,
        }),
      })

      // Message created by backend (success or error) - refetch to show it
      await refetchMessages?.(chatId)
      setSquashOpen(false)
    } catch {
      // Error message may have been created by backend - refetch to show it
      await refetchMessages?.(chatId)
      setSquashOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [branchName, sandboxId, chatId, commitsAhead, baseBranch, repoOwner, repoApiName, refetchMessages])

  // Check rebase status
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
      // Best-effort
    }
  }, [sandboxId, repoName])

  // Note: We no longer check rebase status on mount. Conflict state is loaded
  // from chat.conflictState (persisted in DB). The checkRebaseStatus function
  // is still available for manual refresh if needed.

  return {
    mergeOpen,
    setMergeOpen,
    rebaseOpen,
    setRebaseOpen,
    prOpen,
    setPROpen,
    squashOpen,
    setSquashOpen,
    forcePushOpen,
    setForcePushOpen,
    remoteBranches,
    selectedBranch,
    setSelectedBranch,
    branchesLoading,
    actionLoading,
    squashMerge,
    setSquashMerge,
    commitsAhead,
    commitsLoading,
    baseBranch,
    branchName,
    branchLabel: (branch: string) => resolveChatName?.(branch) || branch,
    handleMerge,
    handleRebase,
    handleCreatePR,
    handleSquash,
    handleForcePush,
    handleAbortConflict,
    rebaseConflict,
    setRebaseConflict,
    checkRebaseStatus,
  }
}
