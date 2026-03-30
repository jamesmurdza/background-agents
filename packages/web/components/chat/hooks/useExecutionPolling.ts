import { useRef, useCallback, useEffect } from "react"
import type { Branch, Message, PushErrorInfo } from "@/lib/shared/types"
import { generateId } from "@/lib/shared/store"
import { ASSISTANT_SOURCE, BRANCH_STATUS, EXECUTION_STATUS, PATHS } from "@/lib/shared/constants"
import { isLoopFinished, LOOP_CONTINUATION_MESSAGE } from "@/lib/shared/types"
import {
  addToolCallIds,
  addContentBlockIds,
  shouldContinueLoop,
  buildErrorContent,
  MAX_NOT_FOUND_RETRIES,
  STOPPED_WITHOUT_END_NOTE,
  type ToolCallWithId,
  type ContentBlockWithId,
} from "@/lib/core/polling"
import {
  getExistingCommitHashes,
  filterNewCommits,
} from "@/lib/core/git"
import {
  upsertPushErrorSystemMessage,
  clearPushErrorMessages,
} from "@/lib/chat/upsert-push-error-message"
import type { ToolCall, ContentBlock } from "@/lib/shared/types"

interface UseExecutionPollingOptions {
  branch: Branch
  repoName: string
  /** Repository owner (e.g., "octocat") */
  repoOwner: string
  /** Repository API name (e.g., "hello-world") */
  repoApiName: string
  /** Update message in a specific branch. May return a Promise so completion can await final save. */
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void | Promise<void>
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  /** Add message to a specific branch - branchId is required to avoid race conditions when user switches branches during execution */
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  onForceSave: () => void
  onCommitsDetected?: () => void
  /** Ref to signal that streaming is active - used by sync to avoid overwriting */
  streamingMessageIdRef?: React.MutableRefObject<string | null>
  /** Ref to the globally selected branch id – used for unread when polling a non-active branch */
  globalActiveBranchIdRef?: React.MutableRefObject<string | null>
  /** Callback to trigger loop continuation - sends the continuation message */
  onLoopContinue?: (branchId: string) => void
  /** After commit detection / auto-commit-push, refresh merge-rebase conflict UI from git */
  onRefreshGitConflictState?: () => void
}

/**
 * Handles polling for background agent execution status using a simple
 * HTTP polling loop that reads snapshots from the server.
 */
export function useExecutionPolling({
  branch,
  repoName,
  repoOwner,
  repoApiName,
  onUpdateMessage,
  onUpdateBranch,
  onAddMessage,
  onForceSave,
  onCommitsDetected,
  streamingMessageIdRef,
  globalActiveBranchIdRef,
  onLoopContinue,
  onRefreshGitConflictState,
}: UseExecutionPollingOptions) {
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const pollInFlightRef = useRef(false)
  const resumeRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const currentExecutionIdRef = useRef<string | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)
  const startPollingRef = useRef<(messageId: string, executionId?: string) => void>(() => {})
  const completionHandledRef = useRef(false)
  const pollingBranchIdRef = useRef<string | null>(null)
  // Guard to prevent multiple startPolling calls from racing
  // Set synchronously at the start of startPolling, before any async work
  const pollingActiveRef = useRef(false)
  // Guard to prevent detectAndShowCommits from running multiple times for the same execution
  const commitDetectionRunningRef = useRef(false)

  // Store the branch context at polling start time to avoid using wrong branch data
  // when the user switches branches during execution. These are ONLY updated when
  // polling starts, not on every render.
  const pollingBranchSandboxIdRef = useRef<string | undefined>(undefined)
  const pollingBranchMessagesRef = useRef<Message[]>([])
  const pollingLastShownCommitHashRef = useRef<string | null>(null)

  // Track the currently viewed branch (used for determining unread status)
  const activeBranchIdRef = useRef(branch.id)
  activeBranchIdRef.current = branch.id

  // Loop mode refs - track loop state without recreating callbacks
  const loopEnabledRef = useRef(branch.loopEnabled)
  const loopCountRef = useRef(branch.loopCount || 0)
  const loopMaxIterationsRef = useRef(branch.loopMaxIterations || 10)
  loopEnabledRef.current = branch.loopEnabled
  loopCountRef.current = branch.loopCount || 0
  loopMaxIterationsRef.current = branch.loopMaxIterations || 10

  /**
   * Detects and displays new commits made since lastShownCommitHash.
   * Called on execution completion and when user stops execution.
   * @param runAutoCommit - Whether to run auto-commit before checking for commits
   */
  const detectAndShowCommits = useCallback(async (runAutoCommit: boolean = true) => {
    // Prevent concurrent runs - this can happen if multiple polling instances complete
    // or if stopPolling races with normal completion
    if (commitDetectionRunningRef.current) return
    commitDetectionRunningRef.current = true

    // Use the branch context captured at polling start, not the currently viewed branch
    const currentSandboxId = pollingBranchSandboxIdRef.current
    const targetBranchId = pollingBranchIdRef.current

    if (!currentSandboxId || !targetBranchId) {
      commitDetectionRunningRef.current = false
      return
    }

    try {
      // Optionally run auto-commit first
      if (runAutoCommit) {
        const statusRes = await fetch("/api/sandbox/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId: currentSandboxId,
            repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
            action: "check-rebase-status",
          }),
        })
        const statusData = (await statusRes.json().catch(() => ({}))) as {
          inRebase?: boolean
          inMerge?: boolean
        }
        const gitConflictInProgress =
          statusRes.ok && !!(statusData.inRebase || statusData.inMerge)

        if (!gitConflictInProgress) {
          const autoCommitRes = await fetch("/api/sandbox/git", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sandboxId: currentSandboxId,
              repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
              action: "auto-commit-push",
              branchId: targetBranchId,
            }),
          })

          // Show error in chat if push failed, with option to retry (not for merge/rebase conflicts)
          if (!autoCommitRes.ok) {
            const errorData = (await autoCommitRes.json().catch(() => ({}))) as {
              error?: string
              inRebase?: boolean
              inMerge?: boolean
            }
            const errorMessage = errorData.error || `Push failed (${autoCommitRes.status})`
            const isConflictStateError =
              autoCommitRes.status === 409 &&
              (errorData.inRebase ||
                errorData.inMerge ||
                errorMessage.includes("Merge in progress") ||
                errorMessage.includes("Rebase in progress"))
            // Benign: git had nothing to record — not a push failure worth surfacing
            const isNothingToCommitNoise =
              /nothing to commit/i.test(errorMessage) &&
              /working tree clean/i.test(errorMessage)

            if (!isConflictStateError && !isNothingToCommitNoise) {
              const pushError: PushErrorInfo = {
                errorMessage,
                branchName: branch.name,
                sandboxId: currentSandboxId,
                repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
                repoOwner,
                repoApiName,
              }

              await upsertPushErrorSystemMessage(
                targetBranchId,
                pollingBranchMessagesRef.current,
                `::icon-warning:: **Push failed:** ${errorMessage}`,
                pushError,
                {
                  onUpdateMessage,
                  onAddMessage,
                  generateId,
                }
              )
            }
          } else {
            await clearPushErrorMessages(
              targetBranchId,
              pollingBranchMessagesRef.current,
              onUpdateMessage
            )
          }
        }
      }

      // Check for new commits since lastShownCommitHash (captured at polling start)
      if (pollingLastShownCommitHashRef.current) {
        const logRes = await fetch("/api/sandbox/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId: currentSandboxId,
            repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
            action: "log",
            sinceCommit: pollingLastShownCommitHashRef.current,
          }),
        })
        const logData = await logRes.json()
        const allCommits: { shortHash: string; message: string }[] =
          logData.commits || []

        // Safety check: filter out commits already shown in chat (deduplication)
        // Use the messages from the branch being polled, not the currently viewed branch
        // Map to simplified format for pure function
        const messagesForDedup = pollingBranchMessagesRef.current.map(m => ({
          id: m.id,
          commitHash: m.commitHash
        }))
        const existingHashes = getExistingCommitHashes(messagesForDedup)

        // Filter to only new commits (uses pure function from lib/core/git)
        const newCommits = filterNewCommits(allCommits, existingHashes)

        // Add commit messages to chat (already in oldest-first order from filterNewCommits)
        for (const c of newCommits) {
          const commitMessage: Message = {
            id: generateId(),
            role: "assistant",
            assistantSource: ASSISTANT_SOURCE.COMMIT,
            content: "",
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            commitHash: c.shortHash,
            commitMessage: c.message,
          }
          onAddMessage(targetBranchId, commitMessage)
          // Update our local ref so subsequent deduplication checks include this commit
          pollingBranchMessagesRef.current = [...pollingBranchMessagesRef.current, commitMessage]
        }

        if (newCommits.length > 0) {
          // Update the polling ref to the latest commit for subsequent checks
          pollingLastShownCommitHashRef.current = allCommits[0].shortHash
          onCommitsDetected?.()
        }
      }
    } catch {
      // Non-critical - commit detection failure shouldn't break the flow
    } finally {
      onRefreshGitConflictState?.()
      commitDetectionRunningRef.current = false
    }
  }, [repoName, repoOwner, repoApiName, branch.name, onAddMessage, onUpdateMessage, onCommitsDetected, onRefreshGitConflictState])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      // Reset the polling active guard on unmount to ensure clean state
      // This prevents stale callbacks from thinking polling is already active
      pollingActiveRef.current = false
    }
  }, [])

  // Start polling for execution status via HTTP snapshots
  const startPolling = useCallback((messageId: string, executionId?: string) => {
    // Prevent concurrent startPolling calls - this guard is checked synchronously
    // before any async work begins, preventing race conditions in the useEffect
    if (pollingActiveRef.current) {
      return
    }
    pollingActiveRef.current = true

    // Capture the branch context at polling start time
    // This ensures we use the correct branch data even if the user switches branches
    pollingBranchIdRef.current = branch.id
    pollingBranchSandboxIdRef.current = branch.sandboxId
    pollingBranchMessagesRef.current = branch.messages
    pollingLastShownCommitHashRef.current = branch.lastShownCommitHash || null
    // Reset commit detection guard for new execution
    commitDetectionRunningRef.current = false

    void clearPushErrorMessages(branch.id, branch.messages, onUpdateMessage)

    if (streamingMessageIdRef) {
      streamingMessageIdRef.current = messageId
    }
    currentMessageIdRef.current = messageId

    // Clear any existing polling interval
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    let notFoundRetries = 0
    // MAX_NOT_FOUND_RETRIES imported from lib/core/polling
    // Reset completion flag for new polling session
    completionHandledRef.current = false

    // STOPPED_WITHOUT_END_NOTE imported from lib/core/polling

    const appendStoppedWithoutEndNote = () => {
      const targetBranchId = pollingBranchIdRef.current
      if (!targetBranchId) return
      const lastMsg = pollingBranchMessagesRef.current.find((m) => m.id === messageId)
      const currentContent = lastMsg?.content ?? ""
      onUpdateMessage(targetBranchId, messageId, {
        content: currentContent + STOPPED_WITHOUT_END_NOTE,
      })
    }

    const poll = async () => {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      try {
        const res = await fetch("/api/agent/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, executionId }),
        })

        const data = await res.json()

        if (!res.ok) {
          if (res.status === 404 && data.error === "Execution not found") {
            notFoundRetries++
            if (notFoundRetries >= MAX_NOT_FOUND_RETRIES) {
              if (pollingRef.current) {
                clearInterval(pollingRef.current)
                pollingRef.current = null
              }
              pollingActiveRef.current = false
              currentExecutionIdRef.current = null
              currentMessageIdRef.current = null
              appendStoppedWithoutEndNote()
              if (pollingBranchIdRef.current) {
                onUpdateBranch(pollingBranchIdRef.current, { status: BRANCH_STATUS.IDLE })
              }
            }
            return
          }
          console.error("[execution-poll] poll error", data.error)
          return
        }

        notFoundRetries = 0

        // Safety: stop polling when agent is no longer running (avoids looping after agent ends)
        if (
          data.status != null &&
          data.status !== EXECUTION_STATUS.RUNNING &&
          data.status !== EXECUTION_STATUS.COMPLETED &&
          data.status !== EXECUTION_STATUS.ERROR
        ) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          pollingActiveRef.current = false
          currentExecutionIdRef.current = null
          currentMessageIdRef.current = null
          if (streamingMessageIdRef) streamingMessageIdRef.current = null
          appendStoppedWithoutEndNote()
          if (pollingBranchIdRef.current) {
            onUpdateBranch(pollingBranchIdRef.current, { status: BRANCH_STATUS.IDLE })
          }
          return
        }

        // Update message content
        if (
          data.content ||
          (data.toolCalls && data.toolCalls.length > 0) ||
          (data.contentBlocks && data.contentBlocks.length > 0)
        ) {
          // Use pure functions from lib/core/polling for ID generation
          // Cast to app types since the pure functions use simpler internal types
          const toolCallsWithIds = addToolCallIds(data.toolCalls || []) as ToolCall[]
          const contentBlocksWithIds = addContentBlockIds(data.contentBlocks || []) as ContentBlock[]

          // Use pollingBranchIdRef to ensure updates go to the correct branch
          const targetBranchId = pollingBranchIdRef.current
          if (targetBranchId) {
            onUpdateMessage(targetBranchId, messageId, {
              content: data.content || "",
              toolCalls: toolCallsWithIds,
              contentBlocks:
                contentBlocksWithIds.length > 0 ? contentBlocksWithIds : undefined,
            })
          }
        }

        // Check if completed or error (only run completion once; multiple in-flight polls can all see "completed")
        if (
          data.status === EXECUTION_STATUS.COMPLETED ||
          data.status === EXECUTION_STATUS.ERROR
        ) {
          if (completionHandledRef.current) return
          completionHandledRef.current = true

          const completedBranchIdForLog = pollingBranchIdRef.current
          const viewingBranchId = globalActiveBranchIdRef?.current ?? activeBranchIdRef.current
          const unread = viewingBranchId !== completedBranchIdForLog

          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          pollingActiveRef.current = false
          currentExecutionIdRef.current = null
          currentMessageIdRef.current = null

          // Persist final message to DB so refresh loads full content
          const targetBranchId = pollingBranchIdRef.current
          if (targetBranchId) {
            // Use pure functions from lib/core/polling for ID generation
            // Cast to app types since the pure functions use simpler internal types
            const finalToolCalls = addToolCallIds(data.toolCalls || []) as ToolCall[]
            const finalContentBlocks = addContentBlockIds(data.contentBlocks || []) as ContentBlock[]

            let finalContent = data.content || ""
            const hasNoOutput =
              !finalContent &&
              finalToolCalls.length === 0 &&
              finalContentBlocks.length === 0
            if (
              data.status === EXECUTION_STATUS.COMPLETED &&
              hasNoOutput
            ) {
              finalContent = STOPPED_WITHOUT_END_NOTE.trim()
            }
            const savePromise = onUpdateMessage(targetBranchId, messageId, {
              content: finalContent,
              toolCalls: finalToolCalls,
              contentBlocks:
                finalContentBlocks.length > 0 ? finalContentBlocks : undefined,
            })
            if (savePromise) await savePromise
          }

          // Delay clearing streaming ref so sync doesn't overwrite before next load
          const completedMessageId = messageId
          if (streamingMessageIdRef) {
            const ref = streamingMessageIdRef
            setTimeout(() => {
              if (ref.current === completedMessageId) ref.current = null
            }, 2000)
          }

          if (data.status === EXECUTION_STATUS.ERROR) {
            const errBranchId = pollingBranchIdRef.current
            if (errBranchId) {
              // Use pure function from lib/core/polling for error content building
              const content = buildErrorContent(data.content ?? "", data.error, data.agentCrashed)
              if (content !== (data.content ?? "")) {
                const errSave = onUpdateMessage(errBranchId, messageId, { content })
                if (errSave) await errSave
              }
            }
          }

          onForceSave()

          // Run auto-commit and commit-detection before going idle (spinner stays until this finishes)
          await detectAndShowCommits(true)

          const completedBranchId = completedBranchIdForLog ?? pollingBranchIdRef.current

          // Check if loop mode should continue (uses pure function from lib/core/polling)
          const loopShouldContinue =
            completedBranchId &&
            shouldContinueLoop(
              data.status as 'completed' | 'error',
              loopEnabledRef.current ?? false,
              loopCountRef.current,
              loopMaxIterationsRef.current,
              data.content || "",
              isLoopFinished
            )

          if (loopShouldContinue && completedBranchId) {
            // Increment loop count and set status to running immediately
            // This prevents the cron job from also triggering a continuation (race condition)
            const newLoopCount = loopCountRef.current + 1
            onUpdateBranch(completedBranchId, {
              status: "running",
              loopCount: newLoopCount,
              lastActivity: "now",
              lastActivityTs: Date.now(),
            })
            // Trigger loop continuation
            onLoopContinue?.(completedBranchId)
          } else {
            // Normal completion - set status to idle
            if (completedBranchId) {
              // If loop was enabled but stopped (finished or max reached), reset loop count
              const loopUpdates = loopEnabledRef.current ? { loopCount: 0 } : {}
              onUpdateBranch(completedBranchId, {
                status: "idle",
                lastActivity: "now",
                lastActivityTs: Date.now(),
                unread,
                ...loopUpdates,
              })
            }
            // Play completion sound only when loop is done
            try {
              const ctx = new AudioContext()
              const osc = ctx.createOscillator()
              const gain = ctx.createGain()
              osc.connect(gain)
              gain.connect(ctx.destination)
              osc.frequency.value = 880
              osc.type = "sine"
              gain.gain.setValueAtTime(0.15, ctx.currentTime)
              gain.gain.exponentialRampToValueAtTime(
                0.001,
                ctx.currentTime + 0.3,
              )
              osc.start(ctx.currentTime)
              osc.stop(ctx.currentTime + 0.3)
            } catch {
              // Ignore audio errors
            }
          }
        }
      } catch (err) {
        console.error("[execution-poll] poll threw", { branchId: pollingBranchIdRef.current, err })
      } finally {
        pollInFlightRef.current = false
      }
    }

    poll()
    pollingRef.current = setInterval(poll, 500)
  // Note: We intentionally access branch.id, branch.sandboxId, and branch.messages directly
  // (not through refs) because we want to capture their values at the moment startPolling is called.
  // However, we don't include branch.messages in deps because it changes on every message update,
  // which would cause the callback to be recreated and reset the polling interval.
  // The branch context is captured once when startPolling is called and stored in refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id, branch.sandboxId, repoName, onUpdateMessage, onUpdateBranch, onAddMessage, onForceSave, streamingMessageIdRef, detectAndShowCommits])

  startPollingRef.current = startPolling

  // Stop polling and update message
  const stopPolling = useCallback(async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    pollingActiveRef.current = false
    if (currentMessageIdRef.current && pollingBranchIdRef.current) {
      // Use the captured branch messages from polling start to avoid using wrong branch data
      const lastMsg = pollingBranchMessagesRef.current.find(m => m.id === currentMessageIdRef.current)
      const currentContent = lastMsg?.content || ""
      onUpdateMessage(pollingBranchIdRef.current, currentMessageIdRef.current, {
        content: currentContent ? `${currentContent}\n\n[Stopped by user]` : "[Stopped by user]"
      })
    }

    // Detect and show any commits made before the user stopped execution
    // This ensures commits are not lost when the user manually stops
    await detectAndShowCommits(true)

    currentExecutionIdRef.current = null
    currentMessageIdRef.current = null
    // Clear streaming signal so sync can resume normal behavior
    if (streamingMessageIdRef) {
      streamingMessageIdRef.current = null
    }
    if (pollingBranchIdRef.current) {
      // Disable loop mode when user manually stops - prevents cron job from restarting
      onUpdateBranch(pollingBranchIdRef.current, {
        status: BRANCH_STATUS.IDLE,
        loopEnabled: false,
        loopCount: 0
      })
    }
  }, [onUpdateMessage, onUpdateBranch, streamingMessageIdRef, detectAndShowCommits])

  // Check and resume polling on mount/branch switch
  useEffect(() => {
    // Capture the branch.id at effect start to detect stale async callbacks
    const effectBranchId = branch.id
    let cancelled = false

    // When branch changes, we need to check if we should stop polling for the previous branch
    // If polling is active for a DIFFERENT branch, stop it so we can start fresh for this branch
    if (pollingActiveRef.current && pollingBranchIdRef.current !== effectBranchId) {
      // Stop polling for the previous branch - but don't run commit detection or cleanup
      // since we're just switching views, not stopping the execution
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      pollInFlightRef.current = false
      pollingActiveRef.current = false
      // Clear streaming ref to avoid blocking sync for new branch
      if (streamingMessageIdRef) {
        streamingMessageIdRef.current = null
      }
      // Note: We don't reset pollingBranchIdRef here - the old branch's execution continues
      // in the background, we just stop polling for it from this component instance
    }

    if (!branch.sandboxId) {
      return
    }
    // Use pollingActiveRef for the guard - it's set synchronously at the start of startPolling
    if (pollingActiveRef.current) {
      return
    }

    const currentStatus = branch.status
    const currentMessages = branch.messages
    fetch("/api/sandbox/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxId: branch.sandboxId }),
    })
      .then((r) => r.json())
      .then((data) => {
        // Check if effect was cancelled (component unmounted or branch changed)
        if (cancelled) {
          return
        }
        if (data.state && data.state !== "started") {
          onUpdateBranch(effectBranchId, { status: BRANCH_STATUS.STOPPED })
        } else {
          // Always check for active execution regardless of current branch status.
          // This fixes a race condition where the branch status might be stale (e.g., IDLE)
          // even though an execution is actively running in the database.
          // The execution/active endpoint is the source of truth for running state.
          fetch("/api/agent/execution/active", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId: effectBranchId }),
          })
            .then((r) => r.json())
            .then((execData) => {
              // Check if effect was cancelled
              if (cancelled) {
                return
              }
              if (execData.execution && execData.execution.status === EXECUTION_STATUS.RUNNING) {
                if (pollingActiveRef.current) {
                  return
                }
                // Update branch status to RUNNING if it wasn't already - this ensures spinner shows
                if (currentStatus !== BRANCH_STATUS.RUNNING) {
                  onUpdateBranch(effectBranchId, { status: BRANCH_STATUS.RUNNING })
                }
                currentMessageIdRef.current = execData.execution.messageId
                currentExecutionIdRef.current = execData.execution.executionId
                startPollingRef.current(execData.execution.messageId, execData.execution.executionId)
                return
              }
              // No active execution found - if branch thought it was running, set to idle
              if (currentStatus === BRANCH_STATUS.RUNNING) {
                const lastAssistantMsg =
                  currentMessages && currentMessages.length > 0
                    ? [...currentMessages].reverse().find((m) => m.role === "assistant" && !m.commitHash)
                    : null
                if (!lastAssistantMsg) {
                  onUpdateBranch(effectBranchId, { status: BRANCH_STATUS.IDLE })
                  return
                }
                // Execution row may not exist yet if user switched immediately after send; retry once
                const retryResume = () => {
                  // Check cancelled flag before proceeding
                  if (cancelled) {
                    return
                  }
                  if (pollingActiveRef.current) return
                  fetch("/api/agent/execution/active", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ branchId: effectBranchId }),
                  })
                    .then((r) => r.json())
                    .then((retryData) => {
                      // Check cancelled flag after async operation
                      if (cancelled) {
                        return
                      }
                      if (pollingActiveRef.current) return
                      if (retryData.execution && retryData.execution.status === EXECUTION_STATUS.RUNNING) {
                        currentMessageIdRef.current = retryData.execution.messageId
                        currentExecutionIdRef.current = retryData.execution.executionId
                        startPollingRef.current(retryData.execution.messageId, retryData.execution.executionId)
                        return
                      }
                      currentMessageIdRef.current = lastAssistantMsg.id
                      startPollingRef.current(lastAssistantMsg.id)
                    })
                    .catch(() => {
                      // Check cancelled flag in error handler
                      if (cancelled) return
                      if (pollingActiveRef.current) return
                      currentMessageIdRef.current = lastAssistantMsg.id
                      startPollingRef.current(lastAssistantMsg.id)
                    })
                }
                if (resumeRetryTimeoutRef.current) clearTimeout(resumeRetryTimeoutRef.current)
                resumeRetryTimeoutRef.current = setTimeout(retryResume, 700)
              }
            })
            .catch(() => {
              // Check cancelled flag in error handler
              if (cancelled) return
              // On error checking execution, only set to idle if we thought we were running
              if (currentStatus === BRANCH_STATUS.RUNNING) {
                onUpdateBranch(effectBranchId, { status: BRANCH_STATUS.IDLE })
              }
            })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (resumeRetryTimeoutRef.current) {
        clearTimeout(resumeRetryTimeoutRef.current)
        resumeRetryTimeoutRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id, branch.sandboxId])

  return {
    currentExecutionIdRef,
    currentMessageIdRef,
    startPolling,
    stopPolling,
  }
}
