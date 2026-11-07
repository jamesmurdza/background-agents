"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { PATHS } from "@/lib/constants"
import { EMPTY_CONFLICT_STATE } from "@background-agents/common"
import type { Chat } from "@/lib/types"
import type { UseGitDialogsOptions, UseGitDialogsResult, PRDescriptionType, RebaseConflictState } from "./types"
import { callSandboxGit } from "./api"
import { materializeAndEnsureSandbox } from "@/lib/sandbox-client"
import { useToastStore } from "@/lib/stores/toast-store"

// ============================================================================
// useGitDialogs Hook
// ============================================================================

export function useGitDialogs({
  chat,
  chats,
  updateChatById,
  refetchMessages,
  setOnConflictStateChange,
  isDraftChatId,
  materializeDraft,
  draftChatConfig,
  updateDraftChatConfig,
}: UseGitDialogsOptions): UseGitDialogsResult {
  const chatId = chat?.id ?? ""
  const branchName = chat?.branch ?? ""
  const baseBranch = chat?.baseBranch ?? ""
  const sandboxId = chat?.sandboxId ?? ""
  const repo = chat?.repo ?? ""

  // Helpers to look up another chat on the same repo by branch. We use this
  // both for friendly display names ("merged into <chatname>" rather than the
  // branch name) and to coordinate post-merge updates with whichever other
  // chat owns the target branch.
  const findChatOnBranch = useCallback(
    (branch: string): Chat | null => {
      if (!chat) return null
      return chats.find((c) => c.repo === chat.repo && c.branch === branch) ?? null
    },
    [chat, chats]
  )
  const findOtherChatOnBranch = useCallback(
    (branch: string): Chat | null => {
      if (!chat) return null
      return (
        chats.find(
          (c) => c.id !== chat.id && c.repo === chat.repo && c.branch === branch
        ) ?? null
      )
    },
    [chat, chats]
  )
  const resolveChatName = useCallback(
    (branch: string): string | null => findChatOnBranch(branch)?.displayName ?? null,
    [findChatOnBranch]
  )

  // Parse owner/repo from repo string
  const [repoOwner, repoApiName] = repo.includes("/") ? repo.split("/") : ["", ""]

  // Dialog open states
  const [mergeOpen, setMergeOpen] = useState(false)
  const [rebaseOpen, setRebaseOpen] = useState(false)
  const [prOpen, setPROpen] = useState(false)
  const [squashOpen, setSquashOpen] = useState(false)

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

  // Subscribe to SSE conflict-state updates so the warning icon refreshes live
  // after the agent resolves a rebase conflict server-side.
  useEffect(() => {
    if (!setOnConflictStateChange) return
    setOnConflictStateChange((state) => setRebaseConflict(state))
    return () => setOnConflictStateChange(null)
  }, [setOnConflictStateChange])

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

  // Run a git action with the shared bookkeeping every handler needs: flip the
  // action-loading flag, swallow errors (the backend creates the user-facing
  // message), then — win or lose — refetch messages to surface that message and
  // optionally close the originating dialog. The action body only has to do the
  // work that's actually specific to it (fire the request, update local state).
  const runGitAction = useCallback(
    async (
      action: () => Promise<void>,
      closeDialog?: (open: boolean) => void,
      /** Overrides the chat id to refetch messages for (e.g. a chat just materialized from a draft). */
      refetchChatId?: string
    ) => {
      setActionLoading(true)
      try {
        await action()
      } catch {
        // Error message may have been created by the backend - the refetch shows it.
      } finally {
        const idToRefetch = refetchChatId ?? chatId
        if (idToRefetch) await refetchMessages?.(idToRefetch)
        closeDialog?.(false)
        setActionLoading(false)
      }
    },
    [chatId, refetchMessages]
  )

  // callSandboxGit recreates an expired sandbox transparently and retries, but
  // the fresh sandboxId has to be persisted on the chat or the *next* action
  // would just hit the same dead id again.
  const syncRecreatedSandboxId = useCallback(
    (recreatedSandboxId: string | undefined) => {
      if (recreatedSandboxId && chat && recreatedSandboxId !== chat.sandboxId) {
        void updateChatById(chat.id, { sandboxId: recreatedSandboxId })
      }
    },
    [chat, updateChatById]
  )

  // Handle merge
  const handleMerge = useCallback(async () => {
    if (!selectedBranch || !branchName) return

    let activeSandboxId = sandboxId
    let activeChatId = chatId

    // Draft chat (no DB row / sandbox yet): materialize it into a real chat
    // row, then make sure it has a running sandbox, before merging. Kept
    // deliberately independent of this hook's own lifecycle — if the dialog
    // (and this hook) unmounts while this is in flight, the materialize +
    // ensure + merge sequence below keeps running; it isn't tied to any
    // component-unmount abort signal.
    if ((!activeSandboxId || !activeChatId) && chatId && isDraftChatId?.(chatId) && materializeDraft) {
      setActionLoading(true)
      useToastStore.getState().addToast({ title: "Starting sandbox…", body: "This only takes a moment." })
      const ensured = await materializeAndEnsureSandbox(chatId, materializeDraft, {
        environmentVariables: draftChatConfig?.pendingEnvironmentVariables,
        clearPending: () => updateDraftChatConfig?.({ pendingEnvironmentVariables: undefined }),
      })
      setActionLoading(false)
      if (!ensured) {
        useToastStore.getState().addToast({ title: "Couldn't start sandbox", body: "Merge not performed — try again." })
        return
      }
      activeChatId = ensured.chatId
      activeSandboxId = ensured.sandboxId
    }

    if (!activeSandboxId || !activeChatId) return

    // Look up the *other* chat that owns the target branch in this repo (if any).
    // We use it both pre-merge (to block merging into a running chat) and
    // post-merge (to pull changes into its sandbox / mark it needs-sync).
    const targetChat = findOtherChatOnBranch(selectedBranch)

    // Block merge into a running branch (frontend check only - backend creates the message)
    if (targetChat?.status === "running") {
      // The API will create the error message
      setMergeOpen(false)
      return
    }

    // Resolve names for the success message
    const sourceName = chat?.displayName || branchName
    const targetName = resolveChatName(selectedBranch) || selectedBranch

    await runGitAction(async () => {
      const { ok, status, data, recreatedSandboxId } = await callSandboxGit<{
        conflict?: boolean
        inMerge?: boolean
        conflictedFiles?: string[]
        needsSync?: boolean
      }>({
        sandboxId: activeSandboxId,
        repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
        action: "merge",
        targetBranch: selectedBranch,
        currentBranch: branchName,
        squash: squashMerge,
        repoOwner,
        repoApiName,
        targetSandboxId: targetChat?.sandboxId ?? null,
        chatId: activeChatId,
        sourceName,
        targetName,
      })

      // Use activeChatId/activeSandboxId rather than the syncRecreatedSandboxId
      // helper here: for a chat just materialized from a draft, `chat.id` is
      // still the stale draft id.
      if (recreatedSandboxId && recreatedSandboxId !== activeSandboxId) {
        void updateChatById(activeChatId, { sandboxId: recreatedSandboxId })
      }

      if (status === 409 && data.conflict && data.inMerge) {
        setRebaseConflict({
          inRebase: false,
          inMerge: true,
          conflictedFiles: data.conflictedFiles || [],
        })
        return
      }

      if (!ok) return

      // If sandbox was stopped, mark the target chat's branch as needing sync
      // so it pulls the merged changes on next wake.
      if (data.needsSync && targetChat) {
        void updateChatById(targetChat.id, { needsSync: true })
      }

      // If this chat has no parent chat, advance its base branch to the merge
      // target so subsequent rebases/squashes use the right reference.
      if (!chat?.parentChatId) {
        void updateChatById(activeChatId, { baseBranch: selectedBranch })
      }
    }, setMergeOpen, activeChatId)
  }, [selectedBranch, branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, squashMerge, findOtherChatOnBranch, chat, resolveChatName, updateChatById, runGitAction, isDraftChatId, materializeDraft, draftChatConfig, updateDraftChatConfig])

  // Shared rebase mechanics, parameterized on the target branch so callers
  // that already know it (the rebase-suggestion banner) can skip the
  // dialog's own selectedBranch state entirely.
  const performRebase = useCallback(async (targetBranch: string, closeDialog?: (open: boolean) => void) => {
    if (!targetBranch || !branchName || !sandboxId || !chatId) return

    await runGitAction(async () => {
      const { ok, status, data, recreatedSandboxId } = await callSandboxGit<{
        conflict?: boolean
        conflictedFiles?: string[]
      }>({
        sandboxId,
        repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
        action: "rebase",
        targetBranch,
        currentBranch: branchName,
        repoOwner,
        repoApiName,
        chatId,
      })

      syncRecreatedSandboxId(recreatedSandboxId)

      if (status === 409 && data.conflict) {
        setRebaseConflict({
          inRebase: true,
          inMerge: false,
          conflictedFiles: data.conflictedFiles || [],
        })
        return
      }

      if (!ok) return
    }, closeDialog)
  }, [branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, runGitAction, syncRecreatedSandboxId])

  // Handle rebase from the dialog, using its own selected target branch.
  const handleRebase = useCallback(async () => {
    await performRebase(selectedBranch, setRebaseOpen)
  }, [performRebase, selectedBranch])

  // Rebase onto an explicit branch, bypassing the dialog entirely.
  const rebaseOnto = useCallback(async (targetBranch: string) => {
    await performRebase(targetBranch)
  }, [performRebase])

  // Handle create PR
  const handleCreatePR = useCallback(async (descriptionType: PRDescriptionType = "short") => {
    if (!selectedBranch || !branchName || !repoOwner || !repoApiName || !chatId) return

    await runGitAction(async () => {
      await fetch("/api/github/pr", {
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
    }, setPROpen)
  }, [selectedBranch, branchName, repoOwner, repoApiName, chatId, runGitAction])

  // Handle force push (temp-branch dance: push commits to a throwaway remote
  // branch so GitHub has the objects, then PATCH the real branch ref to that SHA).
  const handleForcePush = useCallback(async () => {
    if (!branchName || !sandboxId || !repoOwner || !repoApiName || !chatId) return

    await runGitAction(async () => {
      const { recreatedSandboxId } = await callSandboxGit({
        sandboxId,
        repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
        action: "force-push",
        currentBranch: branchName,
        repoOwner,
        repoApiName,
        chatId,
      })
      syncRecreatedSandboxId(recreatedSandboxId)
    })
  }, [branchName, sandboxId, chatId, repoName, repoOwner, repoApiName, runGitAction, syncRecreatedSandboxId])

  // Handle abort conflict
  const handleAbortConflict = useCallback(async () => {
    if (!sandboxId || !chatId) return
    const isMerge = rebaseConflict.inMerge

    await runGitAction(async () => {
      const { ok, recreatedSandboxId } = await callSandboxGit({
        sandboxId,
        repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
        action: isMerge ? "abort-merge" : "abort-rebase",
        chatId,
      })

      syncRecreatedSandboxId(recreatedSandboxId)

      // A recreated sandbox has no rebase/merge in progress (fresh clone) —
      // either way there's nothing left to abort, so treat it as resolved.
      if (ok || recreatedSandboxId) setRebaseConflict(EMPTY_CONFLICT_STATE)
    })
  }, [sandboxId, chatId, repoName, rebaseConflict.inMerge, runGitAction, syncRecreatedSandboxId])

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

    await runGitAction(async () => {
      await fetch("/api/github/squash", {
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
    }, setSquashOpen)
  }, [branchName, sandboxId, chatId, commitsAhead, baseBranch, repoOwner, repoApiName, runGitAction])

  // Check rebase status
  const checkRebaseStatus = useCallback(async () => {
    if (!sandboxId) return

    try {
      const { ok, data } = await callSandboxGit<{
        inRebase?: boolean
        inMerge?: boolean
        conflictedFiles?: string[]
      }>({
        sandboxId,
        repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
        action: "check-rebase-status",
      })

      if (ok) {
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
    branchLabel: (branch: string) => resolveChatName(branch) || branch,
    handleMerge,
    handleRebase,
    rebaseOnto,
    handleCreatePR,
    handleSquash,
    handleForcePush,
    handleAbortConflict,
    rebaseConflict,
    setRebaseConflict,
    checkRebaseStatus,
  }
}
