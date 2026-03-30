"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import type { Branch, Message, PushErrorInfo } from "@/lib/shared/types"
import { generateId } from "@/lib/shared/store"
import { ASSISTANT_SOURCE, PATHS } from "@/lib/shared/constants"

// Export the return type for use in components
export type UseGitDialogsReturn = ReturnType<typeof useGitDialogs>

// Conflict state type
export interface RebaseConflictState {
  inRebase: boolean
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
 * Survives ChatPanel remounts (branch switch uses key → new hook instance).
 * Keyed by sandbox + branch so concurrent hook instances (mobile/desktop) or
 * quick branch switches do not overwrite or wipe each other's entries.
 */
const REBASE_CONFLICT_CACHE = new Map<string, RebaseConflictState>()

function rebaseConflictCacheKey(sandboxId: string, branchId: string): string {
  return `${sandboxId}::${branchId}`
}

function logRebaseConflict(message: string, data?: Record<string, unknown>) {
  if (data !== undefined) {
    console.log(`[rebase-conflict] ${message}`, data)
  } else {
    console.log(`[rebase-conflict] ${message}`)
  }
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

  // Internal state; display uses module cache synchronously (see rebaseConflict below) so first paint after branch switch is never blocked on useEffect.
  const [rebaseConflictState, setRebaseConflictState] = useState<RebaseConflictState>({
    inRebase: false,
    conflictedFiles: [],
  })

  const rebaseConflict = useMemo((): RebaseConflictState => {
    if (!branchId || !sandboxId) return rebaseConflictState
    const key = rebaseConflictCacheKey(sandboxId, branchId)
    return REBASE_CONFLICT_CACHE.get(key) ?? rebaseConflictState
  }, [branchId, sandboxId, rebaseConflictState])

  useEffect(() => {
    const cached =
      branchId && sandboxId
        ? REBASE_CONFLICT_CACHE.get(rebaseConflictCacheKey(sandboxId, branchId))
        : undefined
    logRebaseConflict("merged display snapshot", {
      branchId: branchId || "(none)",
      branchName: branchName || "(none)",
      cacheHit: branchId ? cached !== undefined : false,
      cacheInRebase: cached?.inRebase,
      stateInRebase: rebaseConflictState.inRebase,
      mergedInRebase: rebaseConflict.inRebase,
      cacheKeys: [...REBASE_CONFLICT_CACHE.keys()],
    })
  }, [
    branchId,
    branchName,
    sandboxId,
    rebaseConflict.inRebase,
    rebaseConflict.conflictedFiles.length,
    rebaseConflictState.inRebase,
  ])

  const prevSandboxForRebaseRef = useRef<string | null>(null)

  const putRebaseConflictInCache = useCallback(
    (sid: string, bid: string, next: RebaseConflictState) => {
      if (!sid || !bid) return
      const key = rebaseConflictCacheKey(sid, bid)
      REBASE_CONFLICT_CACHE.set(key, next)
      logRebaseConflict("cache SET", { key, inRebase: next.inRebase, files: next.conflictedFiles.length })
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
        const next: RebaseConflictState = {
          inRebase: true,
          conflictedFiles: data.conflictedFiles || [],
        }
        setRebaseConflictState(next)
        if (branchId && sandboxId) putRebaseConflictInCache(sandboxId, branchId, next)

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
          await onAddMessage(branchId, {
            id: generateId(),
            role: "assistant",
            assistantSource: ASSISTANT_SOURCE.SYSTEM,
            content:
              `⚠️ **Rebase finished locally** but the remote branch could not be updated.\n\n${errMsg}`,
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            pushError,
          })
          setRebaseOpen(false)
          return
        }
        throw new Error(errMsg)
      }
      addSystemMessage(
        `Rebased **${branchName}** onto **${selectedBranch}**. The branch on GitHub now points at your rebased commits.`
      )
      setRebaseOpen(false)
    } catch (err: unknown) {
      addSystemMessage(`Rebase failed: ${err instanceof Error ? err.message : "Unknown error"}`)
      setRebaseOpen(false)
    } finally {
      setActionLoading(false)
    }
  }, [selectedBranch, branch, sandboxId, branchName, branchId, repoOwner, repoName, repoFullName, addSystemMessage, onAddMessage, putRebaseConflictInCache])

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

  // Abort an in-progress rebase
  const handleAbortRebase = useCallback(async () => {
    if (!sandboxId) return
    setActionLoading(true)

    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "abort-rebase",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      // Clear conflict state
      const cleared: RebaseConflictState = { inRebase: false, conflictedFiles: [] }
      setRebaseConflictState(cleared)
      if (branchId && sandboxId) putRebaseConflictInCache(sandboxId, branchId, cleared)
      addSystemMessage(`Rebase aborted. Your branch is back to its previous state.`)
    } catch (err: unknown) {
      addSystemMessage(`Abort failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(false)
    }
  }, [sandboxId, repoName, addSystemMessage, branchId, putRebaseConflictInCache])

  // Check if repo is currently in a rebase state (for live detection)
  const checkRebaseStatus = useCallback(async () => {
    if (!sandboxId) return

    const startedAt = performance.now()
    const branchAtStart = branchIdRef.current
    const sandboxAtStart = sandboxId
    logRebaseConflict("checkRebaseStatus: start", {
      sandboxId: sandboxAtStart,
      branchId: branchAtStart,
      repoName,
    })

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
      const ms = Math.round(performance.now() - startedAt)
      if (res.ok) {
        const next: RebaseConflictState = {
          inRebase: data.inRebase || false,
          conflictedFiles: data.conflictedFiles || [],
        }
        const idNow = branchIdRef.current
        const sidNow = sandboxIdRef.current
        const branchMismatch = branchAtStart !== idNow
        const sandboxMismatch = sandboxAtStart !== sidNow
        logRebaseConflict("checkRebaseStatus: ok", {
          ms,
          branchIdAtStart: branchAtStart,
          branchIdNow: idNow,
          branchMismatch,
          sandboxAtStart,
          sandboxIdNow: sidNow,
          sandboxMismatch,
          inRebase: next.inRebase,
          files: next.conflictedFiles.length,
        })
        if (branchMismatch || sandboxMismatch) {
          logRebaseConflict("checkRebaseStatus: stale response ignored", {
            branchMismatch,
            sandboxMismatch,
          })
          return
        }
        setRebaseConflictState(next)
        if (idNow && sidNow) putRebaseConflictInCache(sidNow, idNow, next)
      } else {
        logRebaseConflict("checkRebaseStatus: HTTP not ok", { ms, status: res.status, data })
      }
    } catch (err) {
      logRebaseConflict("checkRebaseStatus: error", {
        ms: Math.round(performance.now() - startedAt),
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }, [sandboxId, repoName, putRebaseConflictInCache])

  // Re-fetch when sandbox or active branch changes. Display comes from cache + useMemo (first paint); this only syncs React state and verifies with git.
  useEffect(() => {
    logRebaseConflict("effect: branch/sandbox deps", {
      sandboxId: sandboxId || "(empty)",
      branchId: branchId || "(empty)",
      branchName: branchName || "(empty)",
    })

    if (!sandboxId) {
      setRebaseConflictState({ inRebase: false, conflictedFiles: [] })
      prevSandboxForRebaseRef.current = null
      logRebaseConflict("effect: no sandboxId, cleared state")
      return
    }
    if (
      prevSandboxForRebaseRef.current !== null &&
      prevSandboxForRebaseRef.current !== sandboxId &&
      branchId
    ) {
      const prev = prevSandboxForRebaseRef.current
      const staleKey = rebaseConflictCacheKey(prev, branchId)
      if (REBASE_CONFLICT_CACHE.delete(staleKey)) {
        logRebaseConflict("effect: sandbox changed, removed stale cache key for this branch", {
          from: prev,
          to: sandboxId,
          staleKey,
        })
      }
    }
    prevSandboxForRebaseRef.current = sandboxId

    const cached =
      branchId && sandboxId
        ? REBASE_CONFLICT_CACHE.get(rebaseConflictCacheKey(sandboxId, branchId))
        : undefined
    logRebaseConflict("effect: cache lookup", {
      branchId,
      cacheHit: cached !== undefined,
      cachedInRebase: cached?.inRebase,
    })
    if (cached) {
      setRebaseConflictState(cached)
    } else {
      setRebaseConflictState({ inRebase: false, conflictedFiles: [] })
    }
    void checkRebaseStatus()
  }, [sandboxId, branchId, branchName, checkRebaseStatus])

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
