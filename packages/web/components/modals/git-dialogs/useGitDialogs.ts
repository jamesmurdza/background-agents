"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { PATHS } from "@/lib/constants"
import { EMPTY_CONFLICT_STATE } from "@upstream/common"
import type { UseGitDialogsOptions, UseGitDialogsResult, PRDescriptionType, RebaseConflictState } from "./types"

// ============================================================================
// Helper Types & Functions
// ============================================================================

interface GitOperationOptions<T = void> {
  /** Called before the API request to validate inputs. Return false to abort. */
  validate?: () => boolean
  /** The async function that performs the API request */
  execute: () => Promise<Response>
  /** Optional handler for processing the response. Return true to skip default refetch/close. */
  onResponse?: (res: Response, data: unknown) => Promise<boolean | void>
  /** Called on successful completion (res.ok === true) */
  onSuccess?: (data: unknown) => void
  /** Function to close the dialog */
  closeDialog: () => void
  /** Function to refetch messages */
  refetchMessages?: (chatId: string) => Promise<void>
  /** Chat ID for refetching messages */
  chatId: string
  /** Function to set loading state */
  setLoading: (loading: boolean) => void
}

/**
 * Executes a git operation with standardized loading state, error handling,
 * and message refetching. Reduces boilerplate in git operation handlers.
 */
async function executeGitOperation<T = void>({
  validate,
  execute,
  onResponse,
  onSuccess,
  closeDialog,
  refetchMessages,
  chatId,
  setLoading,
}: GitOperationOptions<T>): Promise<void> {
  if (validate && !validate()) return

  setLoading(true)

  try {
    const res = await execute()
    const data = await res.json()

    // Allow custom response handling (e.g., for conflict detection)
    if (onResponse) {
      const handled = await onResponse(res, data)
      if (handled) return
    }

    if (res.ok && onSuccess) {
      onSuccess(data)
    }

    // Refetch messages and close dialog (backend creates success/error messages)
    await refetchMessages?.(chatId)
    closeDialog()
  } catch {
    // Error message may have been created by backend - refetch to show it
    await refetchMessages?.(chatId)
    closeDialog()
  } finally {
    setLoading(false)
  }
}

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

  // Conflict state
  const [rebaseConflict, setRebaseConflict] = useState<RebaseConflictState>(EMPTY_CONFLICT_STATE)

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
    // Block merge into a running branch (frontend check only - backend creates the message)
    const targetStatus = getTargetChatStatus?.(selectedBranch)
    if (targetStatus === "running") {
      setMergeOpen(false)
      return
    }

    // Get the target sandbox ID so we can pull the merged changes there
    const targetSandboxId = getTargetSandboxId?.(selectedBranch) ?? null

    // Resolve names for the success message
    const sourceName = chat?.displayName || branchName
    const targetName = resolveChatName?.(selectedBranch) || selectedBranch

    await executeGitOperation({
      validate: () => !!(selectedBranch && branchName && sandboxId && chatId),
      execute: () => fetch("/api/sandbox/git", {
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
      }),
      onResponse: async (res, data: unknown) => {
        const responseData = data as { conflict?: boolean; inMerge?: boolean; conflictedFiles?: string[] }
        if (res.status === 409 && responseData.conflict && responseData.inMerge) {
          setRebaseConflict({
            inRebase: false,
            inMerge: true,
            conflictedFiles: responseData.conflictedFiles || [],
          })
          await refetchMessages?.(chatId)
          setMergeOpen(false)
          return true // Handled - skip default close
        }
        return false
      },
      onSuccess: (data: unknown) => {
        const responseData = data as { needsSync?: boolean }
        // If sandbox was stopped, mark branch for sync on next wake
        if (responseData.needsSync && onMarkBranchNeedsSync) {
          onMarkBranchNeedsSync(selectedBranch)
        }
        // If this chat has no parent chat, update base branch to the merge target
        if (!chat?.parentChatId && onSetBaseBranch) {
          onSetBaseBranch(selectedBranch)
        }
      },
      closeDialog: () => setMergeOpen(false),
      refetchMessages,
      chatId,
      setLoading: setActionLoading,
    })
  }, [selectedBranch, branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, squashMerge, getTargetSandboxId, getTargetChatStatus, onMarkBranchNeedsSync, chat?.parentChatId, chat?.displayName, onSetBaseBranch, resolveChatName, refetchMessages])

  // Handle rebase
  const handleRebase = useCallback(async () => {
    await executeGitOperation({
      validate: () => !!(selectedBranch && branchName && sandboxId && chatId),
      execute: () => fetch("/api/sandbox/git", {
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
      }),
      onResponse: async (res, data: unknown) => {
        const responseData = data as { conflict?: boolean; conflictedFiles?: string[] }
        if (res.status === 409 && responseData.conflict) {
          setRebaseConflict({
            inRebase: true,
            inMerge: false,
            conflictedFiles: responseData.conflictedFiles || [],
          })
          await refetchMessages?.(chatId)
          setRebaseOpen(false)
          return true // Handled - skip default close
        }
        return false
      },
      closeDialog: () => setRebaseOpen(false),
      refetchMessages,
      chatId,
      setLoading: setActionLoading,
    })
  }, [selectedBranch, branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, refetchMessages])

  // Handle create PR
  const handleCreatePR = useCallback(async (descriptionType: PRDescriptionType = "short") => {
    await executeGitOperation({
      validate: () => !!(selectedBranch && branchName && repoOwner && repoApiName && chatId),
      execute: () => fetch("/api/github/pr", {
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
      }),
      closeDialog: () => setPROpen(false),
      refetchMessages,
      chatId,
      setLoading: setActionLoading,
    })
  }, [selectedBranch, branchName, repoOwner, repoApiName, chatId, refetchMessages])

  // Handle force push (temp-branch dance: push commits to a throwaway remote
  // branch so GitHub has the objects, then PATCH the real branch ref to that SHA).
  const handleForcePush = useCallback(async () => {
    await executeGitOperation({
      validate: () => !!(branchName && sandboxId && repoOwner && repoApiName && chatId),
      execute: () => fetch("/api/sandbox/git", {
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
      }),
      closeDialog: () => setForcePushOpen(false),
      refetchMessages,
      chatId,
      setLoading: setActionLoading,
    })
  }, [branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, refetchMessages])

  // Handle abort conflict
  const handleAbortConflict = useCallback(async () => {
    const isMerge = rebaseConflict.inMerge

    await executeGitOperation({
      validate: () => !!(sandboxId && chatId),
      execute: () => fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: isMerge ? "abort-merge" : "abort-rebase",
          chatId,
        }),
      }),
      onSuccess: () => {
        setRebaseConflict(EMPTY_CONFLICT_STATE)
      },
      closeDialog: () => {}, // No dialog to close - just clear conflict state
      refetchMessages,
      chatId,
      setLoading: setActionLoading,
    })
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
    await executeGitOperation({
      validate: () => !!(branchName && sandboxId && chatId && commitsAhead >= 2),
      execute: () => fetch("/api/github/squash", {
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
      }),
      closeDialog: () => setSquashOpen(false),
      refetchMessages,
      chatId,
      setLoading: setActionLoading,
    })
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

  // Check status on mount/sandbox change
  useEffect(() => {
    if (sandboxId) {
      checkRebaseStatus()
    }
  }, [sandboxId, checkRebaseStatus])

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
