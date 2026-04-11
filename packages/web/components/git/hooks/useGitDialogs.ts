"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import type { Branch, Message, PushErrorInfo } from "@/lib/shared/types"
import { generateId } from "@/lib/shared/store"
import { ASSISTANT_SOURCE, PATHS } from "@/lib/shared/constants"
import { upsertPushErrorSystemMessage } from "@/lib/chat/upsert-push-error-message"

// Export the return type for use in components
export type UseGitDialogsReturn = ReturnType<typeof useGitDialogs>

// Conflict state type (rebase and/or merge in progress with conflicts)
export interface RebaseConflictState {
  inRebase: boolean
  inMerge: boolean
  conflictedFiles: string[]
}

interface UseGitDialogsOptions {
  branch: Branch | null
  repoName: string
  repoOwner: string
  repoFullName: string
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void | Promise<void>
  defaultSquashOnMerge?: boolean
}

/**
 * Survives ChatPanel remounts (branch switch uses key → new hook instance).
 * Keyed by sandbox + branch so concurrent hook instances (mobile/desktop) or
 * quick branch switches do not overwrite or wipe each other's entries.
 */
const REBASE_CONFLICT_CACHE = new Map<string, RebaseConflictState>()

function rebaseConflictCacheKey(sandboxId: string, branchId: string): string {
  return `${sandboxId}::${branchId}`
}

/**
 * Shared hook for git dialog operations: merge, rebase
 * Used by both mobile and desktop interfaces
 */
export function useGitDialogs({
  branch,
  repoName,
  repoOwner,
  repoFullName,
  onAddMessage,
  onUpdateMessage,
  defaultSquashOnMerge = false,
}: UseGitDialogsOptions) {
  const branchId = branch?.id ?? ""
  const branchIdRef = useRef(branchId)
  branchIdRef.current = branchId
  const branchName = branch?.name ?? ""
  const branchBaseName = branch?.baseBranch ?? ""
  const sandboxId = branch?.sandboxId ?? ""
  const sandboxIdRef = useRef(sandboxId)
  sandboxIdRef.current = sandboxId

  // Dialog open states
  const [mergeOpen, setMergeOpen] = useState(false)
  const [rebaseOpen, setRebaseOpen] = useState(false)
  const [prOpen, setPROpen] = useState(false)

  // Shared state for branch picker dialogs
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState("")
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Merge-specific state
  const [mergeDirection, setMergeDirection] = useState<"into-current" | "from-current">("from-current")
  const [squashMerge, setSquashMerge] = useState(defaultSquashOnMerge)

  // Reset squash default when merge dialog opens
  useEffect(() => {
    if (mergeOpen) setSquashMerge(defaultSquashOnMerge)
  }, [mergeOpen, defaultSquashOnMerge])

  // Internal state; display uses module cache synchronously (see rebaseConflict below) so first paint after branch switch is never blocked on useEffect.
  const [rebaseConflictState, setRebaseConflictState] = useState<RebaseConflictState>({
    inRebase: false,
    inMerge: false,
    conflictedFiles: [],
  })

  const rebaseConflict = useMemo((): RebaseConflictState => {
    if (!branchId || !sandboxId) return rebaseConflictState
    const key = rebaseConflictCacheKey(sandboxId, branchId)
    return REBASE_CONFLICT_CACHE.get(key) ?? rebaseConflictState
  }, [branchId, sandboxId, rebaseConflictState])

  const prevSandboxForRebaseRef = useRef<string | null>(null)

  const putRebaseConflictInCache = useCallback(
    (sid: string, bid: string, next: RebaseConflictState) => {
      if (!sid || !bid) return
      const key = rebaseConflictCacheKey(sid, bid)
      REBASE_CONFLICT_CACHE.set(key, next)
    },
    []
  )

  const addSystemMessage = useCallback((content: string) => {
    if (!branchId) return
    onAddMessage(branchId, {
      id: generateId(),
      role: "assistant",
      content,
      assistantSource: ASSISTANT_SOURCE.SYSTEM,
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
      const branches = (data.branches || [])
        .map((b: { name: string }) => b.name)
        .filter((name: string) => name !== branchName)
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
    if (mergeOpen || rebaseOpen || prOpen) {
      setSelectedBranch("")
      setMergeDirection("from-current")
      setSquashMerge(false)
    }
  }, [mergeOpen, rebaseOpen, prOpen])

  useEffect(() => {
    if (mergeOpen || rebaseOpen || prOpen) {
      fetchBranches()
    }
  }, [mergeOpen, rebaseOpen, prOpen, fetchBranches])

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
      if (res.status === 409 && data.conflict && data.inMerge) {
        const next: RebaseConflictState = {
          inRebase: false,
          inMerge: true,
          conflictedFiles: data.conflictedFiles || [],
        }
        setRebaseConflictState(next)
        if (branchId && sandboxId) putRebaseConflictInCache(sandboxId, branchId, next)
        const fileList = (data.conflictedFiles || [])
          .map((f: string) => `- \`${f}\``)
          .join("\n")
        addSystemMessage(
          `::icon-warning:: **Merge conflict detected**\n\n` +
            `Merging **${sourceBranch}** into **${targetBranch}** resulted in conflicts.\n\n` +
            `**Conflicted files:**\n${fileList}\n\n` +
            `You can ask the agent to resolve these conflicts, or click **Abort Merge** to cancel.`
        )
        setMergeOpen(false)
        return
      }
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Merge failed")
      addSystemMessage(
        `::icon-success:: ${squashMerge ? "**Squash merged**" : "**Merged**"} **${sourceBranch}** into **${targetBranch}** and pushed.`
      )
      setMergeOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`::icon-error:: **Merge failed:** ${err instanceof Error ? err.message : "Unknown error"}`)
      setMergeOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branch, sandboxId, branchName, branchId, repoName, repoOwner, repoFullName, addSystemMessage, mergeDirection, squashMerge, putRebaseConflictInCache])

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
          branchId,
        }),
      })
      const data = await res.json()

      // Check for conflict response
      if (res.status === 409 && data.conflict) {
        // Set conflict state
        const next: RebaseConflictState = {
          inRebase: true,
          inMerge: false,
          conflictedFiles: data.conflictedFiles || [],
        }
        setRebaseConflictState(next)
        if (branchId && sandboxId) putRebaseConflictInCache(sandboxId, branchId, next)

        // Show user-facing message about the conflict
        const fileList = (data.conflictedFiles || [])
          .map((f: string) => `- \`${f}\``)
          .join('\n')

        addSystemMessage(
          `::icon-warning:: **Rebase conflict detected**\n\n` +
          `Rebasing **${branchName}** onto **${selectedBranch}** resulted in conflicts.\n\n` +
          `**Conflicted files:**\n${fileList}\n\n` +
          `You can ask the agent to resolve these conflicts, or click **Abort Rebase** to cancel.`
        )
        setRebaseOpen(false)
        return
      }

      if (!res.ok) {
        const errMsg =
          typeof data.error === "string"
            ? data.error
            : `Request failed (${res.status})`
        // Rebase succeeded locally but GitHub ref update failed — same situation as auto-commit push;
        // offer delete-remote-branch + push retry (MessageBubble PushErrorRetry).
        if (errMsg.includes("Force push failed") && branchId) {
          const pushError: PushErrorInfo = {
            errorMessage: errMsg,
            branchName,
            sandboxId,
            repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
            repoOwner: apiOwner,
            repoApiName: apiRepo,
          }
          const content =
            `::icon-warning:: **Rebase finished locally** but the remote branch could not be updated.\n\n${errMsg}`
          await upsertPushErrorSystemMessage(branchId, branch.messages, content, pushError, {
            onUpdateMessage,
            onAddMessage,
            generateId,
          })
          setRebaseOpen(false)
          return
        }
        throw new Error(errMsg)
      }
      addSystemMessage(
        `::icon-success:: **Rebased** **${branchName}** onto **${selectedBranch}**. The branch on GitHub now points at your rebased commits.`
      )
      setRebaseOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`::icon-error:: **Rebase failed:** ${err instanceof Error ? err.message : "Unknown error"}`)
      setRebaseOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branch, sandboxId, branchName, branchId, repoOwner, repoName, repoFullName, addSystemMessage, onAddMessage, onUpdateMessage, putRebaseConflictInCache])

  const handleCreatePR = useCallback(async () => {
    if (!selectedBranch || !branch) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoOwner,
          repo: repoName,
          head: branchName,
          base: selectedBranch,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to create PR")

      addSystemMessage(
        `::icon-success:: **Pull request created:** [#${data.number} - ${data.title}](${data.url})`
      )
      setPROpen(false)
    } catch (err: unknown) {
      addSystemMessage(`::icon-error:: **PR creation failed:** ${err instanceof Error ? err.message : "Unknown error"}`)
      setPROpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branch, repoOwner, repoName, branchName, addSystemMessage])

  const handleAbortConflict = useCallback(async () => {
    if (!sandboxId) return
    const isMerge = rebaseConflictState.inMerge
    setActionLoading(true)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: isMerge ? "abort-merge" : "abort-rebase",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const cleared: RebaseConflictState = { inRebase: false, inMerge: false, conflictedFiles: [] }
      setRebaseConflictState(cleared)
      if (branchId && sandboxId) putRebaseConflictInCache(sandboxId, branchId, cleared)
      addSystemMessage(
        isMerge
          ? `::icon-success:: **Merge aborted.** Your branch is back to its previous state.`
          : `::icon-success:: **Rebase aborted.** Your branch is back to its previous state.`
      )
    } catch (err: unknown) {
      addSystemMessage(`::icon-error:: **Abort failed:** ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(false)
    }
  }, [sandboxId, repoName, addSystemMessage, branchId, putRebaseConflictInCache, rebaseConflictState.inMerge])

  // Check if repo is currently in a rebase state (for live detection)
  const checkRebaseStatus = useCallback(async () => {
    if (!sandboxId) return

    const branchAtStart = branchIdRef.current
    const sandboxAtStart = sandboxId

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: sandboxAtStart,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "check-rebase-status",
        }),
      })
      const data = await res.json()
      if (res.ok) {
        const next: RebaseConflictState = {
          inRebase: data.inRebase || false,
          inMerge: data.inMerge || false,
          conflictedFiles: data.conflictedFiles || [],
        }
        const idNow = branchIdRef.current
        const sidNow = sandboxIdRef.current
        if (branchAtStart !== idNow || sandboxAtStart !== sidNow) {
          return
        }
        setRebaseConflictState(next)
        if (idNow && sidNow) putRebaseConflictInCache(sidNow, idNow, next)
      }
    } catch {
      // Best-effort; next navigation or manual check will retry
    }
  }, [sandboxId, repoName, putRebaseConflictInCache])

  // Re-fetch when sandbox or active branch changes. Display comes from cache + useMemo (first paint); this only syncs React state and verifies with git.
  useEffect(() => {
    if (!sandboxId) {
      setRebaseConflictState({ inRebase: false, inMerge: false, conflictedFiles: [] })
      prevSandboxForRebaseRef.current = null
      return
    }
    if (
      prevSandboxForRebaseRef.current !== null &&
      prevSandboxForRebaseRef.current !== sandboxId &&
      branchId
    ) {
      const prev = prevSandboxForRebaseRef.current
      const staleKey = rebaseConflictCacheKey(prev, branchId)
      REBASE_CONFLICT_CACHE.delete(staleKey)
    }
    prevSandboxForRebaseRef.current = sandboxId

    const cached =
      branchId && sandboxId
        ? REBASE_CONFLICT_CACHE.get(rebaseConflictCacheKey(sandboxId, branchId))
        : undefined
    if (cached) {
      setRebaseConflictState(cached)
    } else {
      setRebaseConflictState({ inRebase: false, inMerge: false, conflictedFiles: [] })
    }
    void checkRebaseStatus()
  }, [sandboxId, branchId, checkRebaseStatus])

  return {
    // Dialog open states
    mergeOpen,
    setMergeOpen,
    rebaseOpen,
    setRebaseOpen,
    prOpen,
    setPROpen,

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

    // Current branch info (for display)
    branchName,

    // Actions
    handleMerge,
    handleRebase,
    handleCreatePR,
    handleAbortConflict,
    checkRebaseStatus,

    // Rebase / merge conflict state
    rebaseConflict,
  }
}
