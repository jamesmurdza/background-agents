import { useRef, useCallback, useEffect } from "react"
import type { Branch, Message } from "@/lib/types"
import { generateId } from "@/lib/store"
import { BRANCH_STATUS, EXECUTION_STATUS } from "@/lib/constants"

interface UseExecutionPollingOptions {
  branch: Branch
  repoName: string
  onUpdateMessage: (messageId: string, updates: Partial<Message>) => void
  onUpdateBranch: (updates: Partial<Branch>) => void
  onAddMessage: (message: Message) => Promise<string>
  onForceSave: () => void
  onCommitsDetected?: () => void
}

/**
 * Handles polling for background agent execution status
 */
export function useExecutionPolling({
  branch,
  repoName,
  onUpdateMessage,
  onUpdateBranch,
  onAddMessage,
  onForceSave,
  onCommitsDetected,
}: UseExecutionPollingOptions) {
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const currentExecutionIdRef = useRef<string | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)
  const startingCommitRef = useRef<string | null>(branch.startCommit || null)
  const startPollingRef = useRef<(messageId: string, executionId?: string) => void>(() => {})
  // Use refs to always get the latest branch name/sandboxId in the polling callback
  // This prevents stale closures when the branch is renamed during polling
  const branchNameRef = useRef(branch.name)
  const branchSandboxIdRef = useRef(branch.sandboxId)
  branchNameRef.current = branch.name
  branchSandboxIdRef.current = branch.sandboxId

  // Update startingCommitRef when branch changes
  useEffect(() => {
    if (branch.startCommit) {
      startingCommitRef.current = branch.startCommit
    }
  }, [branch.id, branch.startCommit])

  // Ref to track pending setTimeout for polling startup
  const pendingPollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      if (pendingPollTimeoutRef.current) {
        clearTimeout(pendingPollTimeoutRef.current)
        pendingPollTimeoutRef.current = null
      }
    }
  }, [])

  // Start polling for execution status
  const startPolling = useCallback((messageId: string, executionId?: string) => {
    // Clear any existing polling interval
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    // Clear any pending poll timeout (prevents double-start race condition)
    if (pendingPollTimeoutRef.current) {
      clearTimeout(pendingPollTimeoutRef.current)
      pendingPollTimeoutRef.current = null
    }

    let notFoundRetries = 0
    const MAX_NOT_FOUND_RETRIES = 10

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
            console.warn(`Polling: Execution not found (attempt ${notFoundRetries}/${MAX_NOT_FOUND_RETRIES})`)
            if (notFoundRetries >= MAX_NOT_FOUND_RETRIES) {
              console.error("Polling error: Execution not found after max retries, stopping")
              if (pollingRef.current) {
                clearInterval(pollingRef.current)
                pollingRef.current = null
              }
              currentExecutionIdRef.current = null
              currentMessageIdRef.current = null
              onUpdateBranch({ status: BRANCH_STATUS.IDLE })
            }
            return
          }
          console.error("Polling error:", data.error)
          return
        }

        notFoundRetries = 0

        // Update message content
        if (data.content || (data.toolCalls && data.toolCalls.length > 0) || (data.contentBlocks && data.contentBlocks.length > 0)) {
          const toolCallsWithIds = (data.toolCalls || []).map((tc: { tool: string; summary: string }, idx: number) => ({
            id: `tc-${idx}`,
            tool: tc.tool,
            summary: tc.summary,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }))
          const contentBlocksWithIds = (data.contentBlocks || []).map((block: { type: string; text?: string; toolCalls?: Array<{ tool: string; summary: string }> }, blockIdx: number) => {
            if (block.type === "tool_calls" && block.toolCalls) {
              return {
                type: "tool_calls" as const,
                toolCalls: block.toolCalls.map((tc, tcIdx) => ({
                  id: `tc-${blockIdx}-${tcIdx}`,
                  tool: tc.tool,
                  summary: tc.summary,
                  timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                })),
              }
            }
            return block
          })
          onUpdateMessage(messageId, {
            content: data.content || "",
            toolCalls: toolCallsWithIds,
            contentBlocks: contentBlocksWithIds.length > 0 ? contentBlocksWithIds : undefined,
          })
        }

        if (data.sessionId) {
          onUpdateBranch({ sessionId: data.sessionId })
        }

        // Check if completed or error
        if (data.status === EXECUTION_STATUS.COMPLETED || data.status === EXECUTION_STATUS.ERROR) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          currentExecutionIdRef.current = null
          currentMessageIdRef.current = null

          if (data.status === EXECUTION_STATUS.ERROR && data.error) {
            onUpdateMessage(messageId, {
              content: data.content ? `${data.content}\n\nError: ${data.error}` : `Error: ${data.error}`,
            })
          }

          onUpdateBranch({ status: "idle", lastActivity: "now", lastActivityTs: Date.now() })
          onForceSave()

          // Check for new commits - use refs to get latest branch name/sandboxId
          // in case the branch was renamed during polling
          const currentSandboxId = branchSandboxIdRef.current
          const currentBranchName = branchNameRef.current
          if (currentSandboxId) {
            try {
              await fetch("/api/sandbox/git", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sandboxId: currentSandboxId,
                  repoPath: `/home/daytona/${repoName}`,
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
                    repoPath: `/home/daytona/${repoName}`,
                    action: "log",
                    sinceCommit: startingCommitRef.current,
                  }),
                })
                const logData = await logRes.json()
                const allCommits: { shortHash: string; message: string }[] = logData.commits || []

                const chatCommits = new Set(branch.messages.filter((m) => m.commitHash).map((m) => m.commitHash))
                const newCommits = allCommits.filter(c => !chatCommits.has(c.shortHash))

                for (const c of [...newCommits].reverse()) {
                  onAddMessage({
                    id: generateId(),
                    role: "assistant",
                    content: "",
                    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    commitHash: c.shortHash,
                    commitMessage: c.message,
                  })
                }
                if (newCommits.length > 0) {
                  startingCommitRef.current = allCommits[0].shortHash
                  onCommitsDetected?.()
                }
              }
            } catch {}
          }

          // Play notification sound
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
          } catch {}
        }
      } catch (err) {
        console.error("Polling failed:", err)
      }
    }

    pendingPollTimeoutRef.current = setTimeout(() => {
      pendingPollTimeoutRef.current = null
      poll()
      pollingRef.current = setInterval(poll, 500)
    }, 150)
  // Note: branch.sandboxId and branch.name are accessed via refs to avoid stale closures when branch is renamed
  }, [branch.messages, repoName, onUpdateMessage, onUpdateBranch, onAddMessage, onForceSave, onCommitsDetected])

  startPollingRef.current = startPolling

  // Stop polling and update message
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    if (pendingPollTimeoutRef.current) {
      clearTimeout(pendingPollTimeoutRef.current)
      pendingPollTimeoutRef.current = null
    }

    if (currentMessageIdRef.current) {
      const lastMsg = branch.messages.find(m => m.id === currentMessageIdRef.current)
      const currentContent = lastMsg?.content || ""
      onUpdateMessage(currentMessageIdRef.current, {
        content: currentContent ? `${currentContent}\n\n[Stopped by user]` : "[Stopped by user]"
      })
    }

    currentExecutionIdRef.current = null
    currentMessageIdRef.current = null
    onUpdateBranch({ status: BRANCH_STATUS.IDLE })
  }, [branch.messages, onUpdateMessage, onUpdateBranch])

  // Check and resume polling on mount/branch switch
  useEffect(() => {
    if (!branch.sandboxId) return
    // Skip if polling is already active or pending
    if (pollingRef.current || pendingPollTimeoutRef.current) return

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
          onUpdateBranch({ status: BRANCH_STATUS.STOPPED })
        } else if (currentStatus === BRANCH_STATUS.RUNNING && !pollingRef.current) {
          if (currentMessages && currentMessages.length > 0) {
            const lastAssistantMsg = [...currentMessages].reverse().find(m => m.role === "assistant" && !m.commitHash)
            if (lastAssistantMsg) {
              currentMessageIdRef.current = lastAssistantMsg.id
              startPollingRef.current(lastAssistantMsg.id)
            } else {
              onUpdateBranch({ status: BRANCH_STATUS.IDLE })
            }
          } else {
            fetch("/api/agent/execution/active", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ branchId: branch.id }),
            })
              .then((r) => r.json())
              .then((execData) => {
                if (execData.execution && execData.execution.status === EXECUTION_STATUS.RUNNING) {
                  currentMessageIdRef.current = execData.execution.messageId
                  currentExecutionIdRef.current = execData.execution.executionId
                  startPollingRef.current(execData.execution.messageId, execData.execution.executionId)
                } else {
                  onUpdateBranch({ status: BRANCH_STATUS.IDLE })
                }
              })
              .catch(() => {
                onUpdateBranch({ status: BRANCH_STATUS.IDLE })
              })
          }
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id, branch.sandboxId])

  return {
    pollingRef,
    currentExecutionIdRef,
    currentMessageIdRef,
    startPolling,
    stopPolling,
  }
}
