import { useRef, useCallback, useEffect } from "react"
import type { Branch, Message } from "@/lib/types"
import { generateId } from "@/lib/store"
import { BRANCH_STATUS, EXECUTION_STATUS, PATHS } from "@/lib/constants"

interface UseExecutionPollingOptions {
  branch: Branch
  repoName: string
  /** Update message in a specific branch - branchId is required to avoid race conditions when user switches branches during execution */
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  /** Add message to a specific branch - branchId is required to avoid race conditions when user switches branches during execution */
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  onForceSave: () => void
  onCommitsDetected?: () => void
  /** Ref to signal that streaming is active - used by sync to avoid overwriting */
  streamingMessageIdRef?: React.MutableRefObject<string | null>
  /** Ref to the globally selected branch id – used for unread when polling a non-active branch */
  globalActiveBranchIdRef?: React.MutableRefObject<string | null>
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
}: UseExecutionPollingOptions) {
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const resumeRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const currentExecutionIdRef = useRef<string | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)
  const startingCommitRef = useRef<string | null>(branch.startCommit || null)
  const startPollingRef = useRef<(messageId: string, executionId?: string) => void>(() => {})
  const pollingBranchIdRef = useRef<string | null>(null)
  // Use refs to always get the latest branch name/sandboxId in the polling callback
  // This prevents stale closures when the branch is renamed during polling
  const branchNameRef = useRef(branch.name)
  const branchSandboxIdRef = useRef(branch.sandboxId)
  branchNameRef.current = branch.name
  branchSandboxIdRef.current = branch.sandboxId

  // Use a ref to track branch messages to avoid dependency array issues
  // This prevents the polling callback from being recreated on every message update
  const branchMessagesRef = useRef(branch.messages)
  branchMessagesRef.current = branch.messages
  const activeBranchIdRef = useRef(branch.id)
  activeBranchIdRef.current = branch.id

  // Update startingCommitRef when branch changes
  useEffect(() => {
    if (branch.startCommit) {
      startingCommitRef.current = branch.startCommit
    }
  }, [branch.id, branch.startCommit])

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
    pollingBranchIdRef.current = branch.id
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

    const poll = async () => {
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
            (tc: { tool: string; summary: string }, idx: number) => ({
              id: `tc-${idx}`,
              tool: tc.tool,
              summary: tc.summary,
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
                toolCalls?: Array<{ tool: string; summary: string }>
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
          // Delay clearing streaming ref so final PATCH can land before sync overwrites
          const completedMessageId = messageId
          if (streamingMessageIdRef) {
            const ref = streamingMessageIdRef
            setTimeout(() => {
              if (ref.current === completedMessageId) ref.current = null
            }, 2000)
          }

          if (data.status === EXECUTION_STATUS.ERROR) {
            const targetBranchId = pollingBranchIdRef.current
            if (targetBranchId) {
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
                onUpdateMessage(targetBranchId, messageId, { content })
              }
            }
          }

          onForceSave()

          // Run auto-commit and commit-detection before going idle (spinner stays until this finishes)
          const currentSandboxId = branchSandboxIdRef.current
          const currentBranchName = branchNameRef.current
          if (currentSandboxId) {
            try {
              await fetch("/api/sandbox/git", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sandboxId: currentSandboxId,
                  repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
                  action: "auto-commit-push",
                  branchName: currentBranchName,
                }),
              })

              if (startingCommitRef.current) {
                const logRes = await fetch("/api/sandbox/git", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sandboxId: currentSandboxId,
                    repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
                    action: "log",
                    sinceCommit: startingCommitRef.current,
                  }),
                })
                const logData = await logRes.json()
                const allCommits: { shortHash: string; message: string }[] =
                  logData.commits || []

                const chatCommits = new Set(
                  branchMessagesRef.current
                    .filter((m) => m.commitHash)
                    .map((m) => m.commitHash),
                )
                const newCommits = allCommits.filter(
                  (c) => !chatCommits.has(c.shortHash),
                )

                // Use pollingBranchIdRef to ensure commits go to the correct branch
                // even if user switched branches during execution
                const targetBranchId = pollingBranchIdRef.current
                if (targetBranchId) {
                  for (const c of [...newCommits].reverse()) {
                    onAddMessage(targetBranchId, {
                      id: generateId(),
                      role: "assistant",
                      content: "",
                      timestamp: new Date().toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                      commitHash: c.shortHash,
                      commitMessage: c.message,
                    })
                  }
                }
                if (newCommits.length > 0) {
                  startingCommitRef.current = allCommits[0].shortHash
                  onCommitsDetected?.()
                }
              }
            } catch {
              // Non-critical
            }
          }

          const completedBranchId = completedBranchIdForLog ?? pollingBranchIdRef.current
          if (completedBranchId) {
            onUpdateBranch(completedBranchId, {
              status: "idle",
              lastActivity: "now",
              lastActivityTs: Date.now(),
              unread,
            })
          }
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
      } catch (err) {
        console.error("[execution-poll] poll threw", { branchId: pollingBranchIdRef.current, err })
      }
    }

    poll()
    pollingRef.current = setInterval(poll, 500)
  // Note: branch.sandboxId, branch.name, and branch.messages are accessed via refs to avoid stale closures
  // This is critical - including branch.messages in deps causes the callback to be recreated on every
  // message update, which clears the polling interval and causes streaming content to disappear
  }, [repoName, onUpdateMessage, onUpdateBranch, onAddMessage, onForceSave, onCommitsDetected, streamingMessageIdRef])

  startPollingRef.current = startPolling

  // Stop polling and update message
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    if (currentMessageIdRef.current && pollingBranchIdRef.current) {
      // Use ref to get current messages to avoid dependency issues
      const lastMsg = branchMessagesRef.current.find(m => m.id === currentMessageIdRef.current)
      const currentContent = lastMsg?.content || ""
      onUpdateMessage(pollingBranchIdRef.current, currentMessageIdRef.current, {
        content: currentContent ? `${currentContent}\n\n[Stopped by user]` : "[Stopped by user]"
      })
    }

    currentExecutionIdRef.current = null
    currentMessageIdRef.current = null
    // Clear streaming signal so sync can resume normal behavior
    if (streamingMessageIdRef) {
      streamingMessageIdRef.current = null
    }
    if (pollingBranchIdRef.current) {
      onUpdateBranch(pollingBranchIdRef.current, { status: BRANCH_STATUS.IDLE })
    }
  }, [onUpdateMessage, onUpdateBranch, streamingMessageIdRef])

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
        } else if (currentStatus === BRANCH_STATUS.RUNNING && !pollingRef.current) {
          // Prefer execution/active so we get executionId and avoid 404s / duplicate poll loops
          fetch("/api/agent/execution/active", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId: branch.id }),
          })
            .then((r) => r.json())
            .then((execData) => {
              if (execData.execution && execData.execution.status === EXECUTION_STATUS.RUNNING) {
                if (pollingRef.current) return
                currentMessageIdRef.current = execData.execution.messageId
                currentExecutionIdRef.current = execData.execution.executionId
                startPollingRef.current(execData.execution.messageId, execData.execution.executionId)
                return
              }
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
            })
            .catch(() => {
              onUpdateBranch(branch.id, { status: BRANCH_STATUS.IDLE })
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
