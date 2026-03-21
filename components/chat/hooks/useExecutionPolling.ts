import { useRef, useCallback, useEffect } from "react"
import type { Branch, Message } from "@/lib/types"
import { generateId } from "@/lib/store"
import { BRANCH_STATUS, EXECUTION_STATUS, PATHS } from "@/lib/constants"
import { isLoopFinished, LOOP_CONTINUATION_MESSAGE } from "@/lib/types"

interface UseExecutionPollingOptions {
  branch: Branch
  repoName: string
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
}

/**
 * Handles polling for background agent execution status using a simple
 * HTTP polling loop that reads snapshots from the server.
 */
export function useExecutionPolling({
  branch,
  repoName,
  onUpdateMessage,
  onUpdateBranch,
  onAddMessage,
  onForceSave,
  onCommitsDetected,
  streamingMessageIdRef,
  globalActiveBranchIdRef,
  onLoopContinue,
}: UseExecutionPollingOptions) {
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const pollInFlightRef = useRef(false)
  const resumeRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const currentExecutionIdRef = useRef<string | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)
  const startPollingRef = useRef<(messageId: string, executionId?: string) => void>(() => {})
  const pollingBranchIdRef = useRef<string | null>(null)

  // Store the branch context at polling start time to avoid using wrong branch data
  // when the user switches branches during execution. These are ONLY updated when
  // polling starts, not on every render.
  const pollingBranchNameRef = useRef<string | null>(null)
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
    // Use the branch context captured at polling start, not the currently viewed branch
    const currentSandboxId = pollingBranchSandboxIdRef.current
    const currentBranchName = pollingBranchNameRef.current
    const targetBranchId = pollingBranchIdRef.current

    if (!currentSandboxId || !targetBranchId) return

    try {
      // Optionally run auto-commit first
      if (runAutoCommit) {
        const autoCommitRes = await fetch("/api/sandbox/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId: currentSandboxId,
            repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
            action: "auto-commit-push",
            branchName: currentBranchName,
          }),
        })

        // Show error in chat if push failed
        if (!autoCommitRes.ok) {
          const errorData = await autoCommitRes.json().catch(() => ({}))
          const errorMessage = (errorData as { error?: string }).error || `Push failed (${autoCommitRes.status})`
          onAddMessage(targetBranchId, {
            id: generateId(),
            role: "assistant",
            content: `⚠️ **Push failed:** ${errorMessage}`,
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          })
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
        const chatCommits = new Set(
          pollingBranchMessagesRef.current
            .filter((m) => m.commitHash)
            .map((m) => m.commitHash),
        )

        // Only show commits that are newer than any already-displayed commit.
        // git log returns commits newest-first, so stop at the first commit
        // we've already seen to avoid showing out-of-order/repeated commits.
        const firstSeenIdx = allCommits.findIndex((c) =>
          chatCommits.has(c.shortHash),
        )
        const newCommits =
          firstSeenIdx === -1
            ? allCommits // No overlap, all are new
            : allCommits.slice(0, firstSeenIdx) // Only commits before first seen

        // Add commit messages to chat (oldest first)
        for (const c of [...newCommits].reverse()) {
          const commitMessage: Message = {
            id: generateId(),
            role: "assistant",
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
    }
  }, [repoName, onAddMessage, onCommitsDetected])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [])

  // Start polling for execution status via HTTP snapshots
  const startPolling = useCallback((messageId: string, executionId?: string) => {
    // Capture the branch context at polling start time
    // This ensures we use the correct branch data even if the user switches branches
    pollingBranchIdRef.current = branch.id
    pollingBranchNameRef.current = branch.name
    pollingBranchSandboxIdRef.current = branch.sandboxId
    pollingBranchMessagesRef.current = branch.messages
    pollingLastShownCommitHashRef.current = branch.lastShownCommitHash || null

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
    const MAX_NOT_FOUND_RETRIES = 10
    let completionHandled = false

    const STOPPED_WITHOUT_END_NOTE =
      "\n\n---\n*Agent stopped without responding. Please try again.*"

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
          const toolCallsWithIds = (data.toolCalls || []).map(
            (tc: { tool: string; summary: string; fullSummary?: string }, idx: number) => ({
              id: `tc-${idx}`,
              tool: tc.tool,
              summary: tc.summary,
              fullSummary: tc.fullSummary,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }),
          )

          const contentBlocksWithIds = (data.contentBlocks || []).map(
            (
              block: {
                type: string
                text?: string
                toolCalls?: Array<{ tool: string; summary: string; fullSummary?: string }>
              },
              blockIdx: number,
            ) => {
              if (block.type === "tool_calls" && block.toolCalls) {
                return {
                  type: "tool_calls" as const,
                  toolCalls: block.toolCalls.map((tc, tcIdx) => ({
                    id: `tc-${blockIdx}-${tcIdx}`,
                    tool: tc.tool,
                    summary: tc.summary,
                    fullSummary: tc.fullSummary,
                    timestamp: new Date().toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })),
                }
              }
              return block
            },
          )

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
          if (completionHandled) return
          completionHandled = true

          const completedBranchIdForLog = pollingBranchIdRef.current
          const viewingBranchId = globalActiveBranchIdRef?.current ?? activeBranchIdRef.current
          const unread = viewingBranchId !== completedBranchIdForLog

          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          currentExecutionIdRef.current = null
          currentMessageIdRef.current = null

          // Persist final message to DB so refresh loads full content
          const targetBranchId = pollingBranchIdRef.current
          if (targetBranchId) {
            const finalToolCalls = (data.toolCalls || []).map(
              (tc: { tool: string; summary: string; fullSummary?: string }, idx: number) => ({
                id: `tc-${idx}`,
                tool: tc.tool,
                summary: tc.summary,
                fullSummary: tc.fullSummary,
                timestamp: new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              }),
            )
            const finalContentBlocks = (data.contentBlocks || []).map(
              (
                block: {
                  type: string
                  text?: string
                  toolCalls?: Array<{ tool: string; summary: string; fullSummary?: string }>
                },
                blockIdx: number,
              ) => {
                if (block.type === "tool_calls" && block.toolCalls) {
                  return {
                    type: "tool_calls" as const,
                    toolCalls: block.toolCalls.map((tc, tcIdx) => ({
                      id: `tc-${blockIdx}-${tcIdx}`,
                      tool: tc.tool,
                      summary: tc.summary,
                      fullSummary: tc.fullSummary,
                      timestamp: new Date().toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    })),
                  }
                }
                return block
              },
            )
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
              let content = data.content ?? ""
              if (data.agentCrashed) {
                const { message, output } = data.agentCrashed
                const crashMsg = message ?? "Process exited without completing"
                content = content ? `${content}\n\n[Agent crashed: ${crashMsg}]` : `[Agent crashed: ${crashMsg}]`
                if (output) content += `\n\nOutput:\n${output}`
              } else if (data.error) {
                const runFailed = `Run failed: ${data.error}`
                content = content ? `${content}\n\n${runFailed}` : runFailed
              }
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

          // Check if loop mode should continue
          const shouldContinueLoop =
            completedBranchId &&
            loopEnabledRef.current &&
            data.status === EXECUTION_STATUS.COMPLETED &&
            loopCountRef.current < loopMaxIterationsRef.current &&
            !isLoopFinished(data.content)

          if (shouldContinueLoop && completedBranchId) {
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
  // Note: We intentionally access branch.id, branch.name, branch.sandboxId, and branch.messages directly
  // (not through refs) because we want to capture their values at the moment startPolling is called.
  // However, we don't include branch.messages in deps because it changes on every message update,
  // which would cause the callback to be recreated and reset the polling interval.
  // The branch context is captured once when startPolling is called and stored in refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id, branch.name, branch.sandboxId, repoName, onUpdateMessage, onUpdateBranch, onAddMessage, onForceSave, streamingMessageIdRef, detectAndShowCommits])

  startPollingRef.current = startPolling

  // Stop polling and update message
  const stopPolling = useCallback(async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
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
    if (!branch.sandboxId) return
    if (pollingRef.current) return

    const currentStatus = branch.status
    const currentMessages = branch.messages
    fetch("/api/sandbox/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxId: branch.sandboxId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.state && data.state !== "started") {
          onUpdateBranch(branch.id, { status: BRANCH_STATUS.STOPPED })
        } else {
          // Always check for active execution regardless of current branch status.
          // This fixes a race condition where the branch status might be stale (e.g., IDLE)
          // even though an execution is actively running in the database.
          // The execution/active endpoint is the source of truth for running state.
          fetch("/api/agent/execution/active", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId: branch.id }),
          })
            .then((r) => r.json())
            .then((execData) => {
              if (execData.execution && execData.execution.status === EXECUTION_STATUS.RUNNING) {
                if (pollingRef.current) return
                // Update branch status to RUNNING if it wasn't already - this ensures spinner shows
                if (currentStatus !== BRANCH_STATUS.RUNNING) {
                  onUpdateBranch(branch.id, { status: BRANCH_STATUS.RUNNING })
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
                  onUpdateBranch(branch.id, { status: BRANCH_STATUS.IDLE })
                  return
                }
                // Execution row may not exist yet if user switched immediately after send; retry once
                const retryResume = () => {
                  if (pollingRef.current) return
                  fetch("/api/agent/execution/active", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ branchId: branch.id }),
                  })
                    .then((r) => r.json())
                    .then((retryData) => {
                      if (pollingRef.current) return
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
                      if (pollingRef.current) return
                      currentMessageIdRef.current = lastAssistantMsg.id
                      startPollingRef.current(lastAssistantMsg.id)
                    })
                }
                if (resumeRetryTimeoutRef.current) clearTimeout(resumeRetryTimeoutRef.current)
                resumeRetryTimeoutRef.current = setTimeout(retryResume, 700)
              }
            })
            .catch(() => {
              // On error checking execution, only set to idle if we thought we were running
              if (currentStatus === BRANCH_STATUS.RUNNING) {
                onUpdateBranch(branch.id, { status: BRANCH_STATUS.IDLE })
              }
            })
        }
      })
      .catch(() => {})
    return () => {
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
