"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import type { Branch, Message, ToolCall, ContentBlock } from "@/lib/shared/types"
import { isLoopFinished } from "@/lib/shared/types"
import { BRANCH_STATUS } from "@/lib/shared/constants"
import {
  addToolCallIds,
  addContentBlockIds,
  buildErrorContent,
  shouldContinueLoop,
  STOPPED_WITHOUT_END_NOTE,
} from "@/lib/core/polling"
import { detectAndShowCommits } from "@/lib/core/execution/detect-and-show-commits"
import { useDebouncedCommitDetection } from "@/hooks/use-debounced-commit-detection"

// Module-level tracking for sync guard — prevents sync from overwriting
// streaming content while a branch is being actively polled.
const pollingBranches = new Set<string>()

export function isBranchPolling(branchId: string): boolean {
  return pollingBranches.has(branchId)
}

const MAX_NOT_FOUND_RETRIES = 60
const POLL_INTERVAL_MS = 500
const NOT_FOUND_INTERVAL_MS = 1000

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

interface UseExecutionPollerOptions {
  branch: Branch
  /** Sandbox repo folder name and GitHub identifiers (captured for commit/push; must match agent run). */
  repoName: string
  repoOwner: string
  /** Often same as `repoName`; used in push-error payload. */
  repoApiName: string
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void | Promise<void>
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  onForceSave: () => void
  onCommitsDetected?: () => void
  onLoopContinue?: (branchId: string) => void
  onRefreshGitConflictState?: () => void
}

/**
 * Polls for execution status updates. Two modes:
 *
 * 1. Explicit: caller calls `startPolling(messageId)` after sending a message.
 *    The hook polls `/api/agent/status` in a while-loop until completion.
 *
 * 2. Recovery: on mount (e.g. page refresh), if the branch is RUNNING but no
 *    explicit messageId is set, the hook asks the server for the active execution
 *    and resumes polling automatically. No external recovery logic needed.
 *
 * Polling stops automatically when `branch.status` leaves RUNNING (via effect cleanup).
 */
export function useExecutionPoller({
  branch,
  repoName,
  repoOwner,
  repoApiName,
  onUpdateMessage,
  onUpdateBranch,
  onAddMessage,
  onForceSave,
  onCommitsDetected,
  onLoopContinue,
  onRefreshGitConflictState,
}: UseExecutionPollerOptions) {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)

  // Always-fresh refs for async code
  const cbRef = useRef({
    onUpdateMessage,
    onUpdateBranch,
    onAddMessage,
    onForceSave,
    onCommitsDetected,
    onLoopContinue,
    onRefreshGitConflictState,
  })
  useEffect(() => {
    cbRef.current = {
      onUpdateMessage,
      onUpdateBranch,
      onAddMessage,
      onForceSave,
      onCommitsDetected,
      onLoopContinue,
      onRefreshGitConflictState,
    }
  })
  const branchRef = useRef(branch)
  branchRef.current = branch

  // Debounced commit detection triggered by Bash tool calls
  const { checkAfterToolCalls, reset: resetCommitDetection, flush: flushCommitDetection } = useDebouncedCommitDetection({
    branchRef,
    repoName,
    repoOwner,
    repoApiName,
    onAddMessage,
    onUpdateMessage,
    onUpdateBranch,
    onCommitsDetected,
    onRefreshGitConflictState,
  })

  // Clear tracking when branch stops running
  useEffect(() => {
    if (branch.status !== BRANCH_STATUS.RUNNING && activeMessageId) {
      setActiveMessageId(null)
    }
  }, [branch.status, activeMessageId])

  // Main effect: recovery (if needed) → poll loop
  useEffect(() => {
    if (branch.status !== BRANCH_STATUS.RUNNING) return

    let cancelled = false
    const branchId = branch.id

    const run = async () => {
      // Reset debounced commit detection for new polling session
      resetCommitDetection()

      let resolvedId: string | null = activeMessageId

      // Recovery: no explicit messageId — ask the server which execution is running.
      // On page refresh this fires automatically; during normal sends the caller
      // sets activeMessageId via startPolling() so this branch is skipped.
      if (!resolvedId) {
        try {
          const res = await fetch("/api/agent/execution/active", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId }),
          })
          if (cancelled) return
          if (!res.ok) return
          const data = await res.json()
          if (cancelled) return
          if (data.execution?.messageId && data.execution?.status === "running") {
            resolvedId = data.execution.messageId as string
          } else if (data.execution?.messageId && (data.execution?.status === "completed" || data.execution?.status === "error")) {
            // Execution completed while we were away (e.g. page refresh raced with
            // completion). Do one final status fetch to get the persisted content,
            // run commit detection, then mark idle.
            try {
              const statusRes = await fetch("/api/agent/status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messageId: data.execution.messageId }),
              })
              if (!cancelled && statusRes.ok) {
                const statusData = await statusRes.json()
                if (statusData.content || statusData.toolCalls?.length > 0 || statusData.contentBlocks?.length > 0) {
                  const tc = addToolCallIds(statusData.toolCalls || []) as ToolCall[]
                  const cb = addContentBlockIds(statusData.contentBlocks || []) as ContentBlock[]
                  cbRef.current.onUpdateMessage(branchId, data.execution.messageId, {
                    content: statusData.content || "",
                    toolCalls: tc,
                    contentBlocks: cb.length > 0 ? cb : undefined,
                  })
                }
              }
            } catch { /* best effort */ }
            // Run commit detection for execution that completed while away
            const b = branchRef.current
            const sandboxId = b.sandboxId || ""
            if (sandboxId && repoName) {
              try {
                await detectAndShowCommits({
                  runAutoCommit: true,
                  sandboxId,
                  branchId,
                  branchName: b.name,
                  repoName,
                  repoOwner,
                  repoApiName,
                  lastShownCommitHash: b.lastShownCommitHash || null,
                  messages: b.messages,
                  onAddMessage: cbRef.current.onAddMessage,
                  onUpdateMessage: cbRef.current.onUpdateMessage,
                  onUpdateBranch: cbRef.current.onUpdateBranch,
                  onCommitsDetected: cbRef.current.onCommitsDetected,
                  onRefreshGitConflictState: cbRef.current.onRefreshGitConflictState,
                })
              } catch { /* non-critical */ }
            }
            cbRef.current.onUpdateBranch(branchId, { status: BRANCH_STATUS.IDLE })
            return
          } else {
            // No execution at all — truly stale branch status
            cbRef.current.onUpdateBranch(branchId, { status: BRANCH_STATUS.IDLE })
            return
          }
        } catch {
          return
        }
      }

      const messageId: string = resolvedId
      pollingBranches.add(branchId)
      let notFoundRetries = 0
      let highestSnapshotVersion = 0

      while (!cancelled) {
        try {
          const res = await fetch("/api/agent/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId }),
          })
          if (cancelled) break

          if (!res.ok) {
            if (res.status === 404) {
              notFoundRetries++
              if (notFoundRetries >= MAX_NOT_FOUND_RETRIES) {
                cbRef.current.onUpdateMessage(branchId, messageId, { content: STOPPED_WITHOUT_END_NOTE.trim() })
                // Still try to detect commits in case agent made commits before disappearing
                const b = branchRef.current
                const sandboxId = b.sandboxId || ""
                if (sandboxId && repoName) {
                  try {
                    await detectAndShowCommits({
                      runAutoCommit: true,
                      sandboxId,
                      branchId,
                      branchName: b.name,
                      repoName,
                      repoOwner,
                      repoApiName,
                      lastShownCommitHash: b.lastShownCommitHash || null,
                      messages: b.messages,
                      onAddMessage: cbRef.current.onAddMessage,
                      onUpdateMessage: cbRef.current.onUpdateMessage,
                      onUpdateBranch: cbRef.current.onUpdateBranch,
                      onCommitsDetected: cbRef.current.onCommitsDetected,
                      onRefreshGitConflictState: cbRef.current.onRefreshGitConflictState,
                    })
                  } catch { /* non-critical */ }
                }
                cbRef.current.onUpdateBranch(branchId, { status: BRANCH_STATUS.IDLE })
                break
              }
              await sleep(NOT_FOUND_INTERVAL_MS)
              continue
            }
            await sleep(POLL_INTERVAL_MS)
            continue
          }

          notFoundRetries = 0
          const data = await res.json()
          if (cancelled) break

          // Monotonic version guard — reject stale out-of-order responses
          const ver = typeof data.snapshotVersion === "number" ? data.snapshotVersion : 0
          if (ver < highestSnapshotVersion) {
            await sleep(POLL_INTERVAL_MS)
            continue
          }
          highestSnapshotVersion = ver

          // Unexpected status (e.g. "cancelled", "timeout")
          if (data.status != null && !["running", "completed", "error"].includes(data.status)) {
            cbRef.current.onUpdateMessage(branchId, messageId, {
              content: (data.content ?? "") + STOPPED_WITHOUT_END_NOTE,
            })
            // Still try to detect commits - agent may have made commits before interruption
            const b = branchRef.current
            const sandboxId = b.sandboxId || ""
            if (sandboxId && repoName) {
              try {
                await detectAndShowCommits({
                  runAutoCommit: true,
                  sandboxId,
                  branchId,
                  branchName: b.name,
                  repoName,
                  repoOwner,
                  repoApiName,
                  lastShownCommitHash: b.lastShownCommitHash || null,
                  messages: b.messages,
                  onAddMessage: cbRef.current.onAddMessage,
                  onUpdateMessage: cbRef.current.onUpdateMessage,
                  onUpdateBranch: cbRef.current.onUpdateBranch,
                  onCommitsDetected: cbRef.current.onCommitsDetected,
                  onRefreshGitConflictState: cbRef.current.onRefreshGitConflictState,
                })
              } catch { /* non-critical */ }
            }
            cbRef.current.onUpdateBranch(branchId, { status: BRANCH_STATUS.IDLE })
            break
          }

          // Incremental content update
          if (data.content || data.toolCalls?.length > 0 || data.contentBlocks?.length > 0) {
            const tc = addToolCallIds(data.toolCalls || []) as ToolCall[]
            const cb = addContentBlockIds(data.contentBlocks || []) as ContentBlock[]
            cbRef.current.onUpdateMessage(branchId, messageId, {
              content: data.content || "",
              toolCalls: tc,
              contentBlocks: cb.length > 0 ? cb : undefined,
            })

            // Check for new commits after Bash tool calls (debounced)
            if (data.status === "running") {
              checkAfterToolCalls(tc, branchId)
            }
          }

          // Completion / error
          if (data.status === "completed" || data.status === "error") {
            await handleCompletion(data, branchId, messageId)
            break
          }
        } catch {
          // Network error — will retry on next iteration
        }

        await sleep(POLL_INTERVAL_MS)
      }

      if (!cancelled) pollingBranches.delete(branchId)
    }

    // --- completion helper (keeps the while-loop readable) ---
    async function handleCompletion(
      data: { status: string; content?: string; toolCalls?: ToolCall[]; contentBlocks?: ContentBlock[]; error?: string; agentCrashed?: { message?: string; output?: string } },
      branchId: string,
      messageId: string,
    ) {
      const finalTc = addToolCallIds(data.toolCalls || []) as ToolCall[]
      const finalCb = addContentBlockIds(data.contentBlocks || []) as ContentBlock[]
      let finalContent = data.content || ""
      if (data.status === "completed" && !finalContent && finalTc.length === 0 && finalCb.length === 0) {
        finalContent = STOPPED_WITHOUT_END_NOTE.trim()
      }

      const p = cbRef.current.onUpdateMessage(branchId, messageId, {
        content: finalContent,
        toolCalls: finalTc,
        contentBlocks: finalCb.length > 0 ? finalCb : undefined,
      })
      if (p) await p

      if (data.status === "error") {
        const ec = buildErrorContent(data.content ?? "", data.error, data.agentCrashed)
        if (ec !== (data.content ?? "")) {
          const ep = cbRef.current.onUpdateMessage(branchId, messageId, { content: ec })
          if (ep) await ep
        }
      }

      cbRef.current.onForceSave?.()

      // Clear any pending debounced commit check - final detection happens below
      flushCommitDetection()

      const b = branchRef.current
      const sandboxId = b.sandboxId || ""
      if (sandboxId && repoName) {
        await detectAndShowCommits({
          runAutoCommit: true,
          sandboxId,
          branchId,
          branchName: b.name,
          repoName,
          repoOwner,
          repoApiName,
          lastShownCommitHash: b.lastShownCommitHash || null,
          messages: b.messages,
          onAddMessage: cbRef.current.onAddMessage,
          onUpdateMessage: cbRef.current.onUpdateMessage,
          onUpdateBranch: cbRef.current.onUpdateBranch,
          onCommitsDetected: cbRef.current.onCommitsDetected,
          onRefreshGitConflictState: cbRef.current.onRefreshGitConflictState,
        })
      }

      const cur = branchRef.current
      const continueLoop = shouldContinueLoop(
        data.status as "completed" | "error",
        cur.loopEnabled || false,
        cur.loopCount || 0,
        cur.loopMaxIterations || 10,
        data.content || "",
        isLoopFinished,
      )

      if (continueLoop && cbRef.current.onLoopContinue) {
        cbRef.current.onUpdateBranch(branchId, {
          status: BRANCH_STATUS.RUNNING,
          loopCount: (cur.loopCount || 0) + 1,
          lastActivity: "now",
          lastActivityTs: Date.now(),
        })
        cbRef.current.onLoopContinue(branchId)
      } else {
        cbRef.current.onUpdateBranch(branchId, {
          status: BRANCH_STATUS.IDLE,
          lastActivity: "now",
          lastActivityTs: Date.now(),
          ...(cur.loopEnabled ? { loopCount: 0 } : {}),
        })

        try {
          const ctx = new AudioContext()
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.frequency.value = 880
          osc.type = "sine"
          gain.gain.setValueAtTime(0.15, ctx.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
          osc.start(ctx.currentTime)
          osc.stop(ctx.currentTime + 0.3)
        } catch { /* ignore audio errors */ }
      }
    }

    run()
    return () => {
      cancelled = true
      pollingBranches.delete(branchId)
      resetCommitDetection()
    }
  }, [branch.id, branch.status, activeMessageId, repoName, repoOwner, repoApiName, resetCommitDetection])

  const startPolling = useCallback((messageId: string) => {
    setActiveMessageId(messageId)
  }, [])

  return {
    startPolling,
    isPolling: branch.status === BRANCH_STATUS.RUNNING,
  }
}
