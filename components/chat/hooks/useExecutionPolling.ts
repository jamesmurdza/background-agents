import { useRef, useCallback, useEffect } from "react"
import type { Branch, Message, ProviderName, ToolCall, ContentBlock } from "@/lib/types"
import { generateId } from "@/lib/store"
import { BRANCH_STATUS, EXECUTION_STATUS, AGENT_PROVIDER } from "@/lib/constants"
import type { AgentEvent } from "@/lib/agent-types"

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
 * Now supports cursor-based polling with the background-agents SDK
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
  const currentCursorRef = useRef<string | null>(null)
  const currentProviderRef = useRef<ProviderName>(AGENT_PROVIDER.CLAUDE)
  const startingCommitRef = useRef<string | null>(branch.startCommit || null)
  const startPollingRef = useRef<(messageId: string, executionId?: string, cursor?: string, provider?: ProviderName) => void>(() => {})

  // Accumulated content for building the message
  const accumulatedContentRef = useRef<string>("")
  const accumulatedToolCallsRef = useRef<ToolCall[]>([])
  const accumulatedContentBlocksRef = useRef<ContentBlock[]>([])
  const currentToolRef = useRef<{ name: string; output: string } | null>(null)

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

  // Process SDK events into message updates
  const processEvents = useCallback((events: AgentEvent[], messageId: string) => {
    let hasUpdates = false

    for (const event of events) {
      switch (event.type) {
        case "session":
          // Session ID received, update branch
          onUpdateBranch({ sessionId: event.id })
          break

        case "token":
          // Accumulate text content
          accumulatedContentRef.current += event.text
          hasUpdates = true

          // If we have text accumulated after tool calls, add a text block
          if (accumulatedContentBlocksRef.current.length > 0) {
            const lastBlock = accumulatedContentBlocksRef.current[accumulatedContentBlocksRef.current.length - 1]
            if (lastBlock.type === "text") {
              lastBlock.text += event.text
            } else {
              accumulatedContentBlocksRef.current.push({
                type: "text",
                text: event.text,
              })
            }
          } else if (accumulatedToolCallsRef.current.length > 0) {
            // Started with tools, now have text - add text block
            accumulatedContentBlocksRef.current.push({
              type: "text",
              text: event.text,
            })
          }
          break

        case "tool_start":
          // Starting a new tool call
          currentToolRef.current = { name: event.name, output: "" }
          hasUpdates = true
          break

        case "tool_delta":
          // Tool output streaming
          if (currentToolRef.current) {
            currentToolRef.current.output += event.text
          }
          break

        case "tool_end":
          // Tool call completed
          if (currentToolRef.current) {
            const toolCall: ToolCall = {
              id: generateId(),
              tool: currentToolRef.current.name,
              summary: event.output || currentToolRef.current.output.slice(0, 100) || currentToolRef.current.name,
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            }
            accumulatedToolCallsRef.current.push(toolCall)

            // Add to content blocks for interleaved display
            const lastBlock = accumulatedContentBlocksRef.current[accumulatedContentBlocksRef.current.length - 1]
            if (lastBlock?.type === "tool_calls") {
              lastBlock.toolCalls.push(toolCall)
            } else {
              // If we had text content before, push it as a text block first
              if (accumulatedContentRef.current && accumulatedContentBlocksRef.current.length === 0) {
                accumulatedContentBlocksRef.current.push({
                  type: "text",
                  text: accumulatedContentRef.current,
                })
              }
              accumulatedContentBlocksRef.current.push({
                type: "tool_calls",
                toolCalls: [toolCall],
              })
            }

            currentToolRef.current = null
            hasUpdates = true
          }
          break

        case "end":
          // Execution complete, handled by status
          break
      }
    }

    // Update message with accumulated content
    if (hasUpdates) {
      onUpdateMessage(messageId, {
        content: accumulatedContentRef.current,
        toolCalls: accumulatedToolCallsRef.current.length > 0 ? accumulatedToolCallsRef.current : undefined,
        contentBlocks: accumulatedContentBlocksRef.current.length > 0 ? accumulatedContentBlocksRef.current : undefined,
      })
    }
  }, [onUpdateBranch, onUpdateMessage])

  // Start polling for execution status
  const startPolling = useCallback((messageId: string, executionId?: string, cursor?: string, provider?: ProviderName) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }

    // Reset accumulated state
    accumulatedContentRef.current = ""
    accumulatedToolCallsRef.current = []
    accumulatedContentBlocksRef.current = []
    currentToolRef.current = null

    currentCursorRef.current = cursor || null
    currentProviderRef.current = provider || branch.agent || AGENT_PROVIDER.CLAUDE

    let notFoundRetries = 0
    const MAX_NOT_FOUND_RETRIES = 10

    const poll = async () => {
      try {
        // Use the new poll endpoint for cursor-based polling
        const res = await fetch("/api/agent/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            executionId: executionId || currentExecutionIdRef.current,
            cursor: currentCursorRef.current,
            provider: currentProviderRef.current,
          }),
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
              currentCursorRef.current = null
              onUpdateBranch({ status: BRANCH_STATUS.IDLE })
            }
            return
          }
          console.error("Polling error:", data.error)
          return
        }

        notFoundRetries = 0

        // Update cursor for next poll
        if (data.cursor) {
          currentCursorRef.current = data.cursor
        }

        // Process events incrementally
        if (data.events && data.events.length > 0) {
          processEvents(data.events, messageId)
        }

        // Update session ID if provided
        if (data.sessionId) {
          onUpdateBranch({ sessionId: data.sessionId })
        }

        // Check if completed or error
        if (data.status === "completed" || data.status === "error") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          currentExecutionIdRef.current = null
          currentMessageIdRef.current = null
          currentCursorRef.current = null

          if (data.status === "error" && data.error) {
            onUpdateMessage(messageId, {
              content: accumulatedContentRef.current
                ? `${accumulatedContentRef.current}\n\nError: ${data.error}`
                : `Error: ${data.error}`,
            })
          }

          onUpdateBranch({ status: "idle", lastActivity: "now", lastActivityTs: Date.now() })
          onForceSave()

          // Check for new commits
          if (branch.sandboxId) {
            try {
              await fetch("/api/sandbox/git", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sandboxId: branch.sandboxId,
                  repoPath: `/home/daytona/${repoName}`,
                  action: "auto-commit-push",
                  branchName: branch.name,
                }),
              })

              if (startingCommitRef.current) {
                const logRes = await fetch("/api/sandbox/git", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sandboxId: branch.sandboxId,
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

    setTimeout(() => {
      poll()
      pollingRef.current = setInterval(poll, 500)
    }, 150)
  }, [branch.sandboxId, branch.name, branch.messages, branch.agent, repoName, onUpdateMessage, onUpdateBranch, onAddMessage, onForceSave, onCommitsDetected, processEvents])

  startPollingRef.current = startPolling

  // Stop polling and update message
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    if (currentMessageIdRef.current) {
      const lastMsg = branch.messages.find(m => m.id === currentMessageIdRef.current)
      const currentContent = lastMsg?.content || accumulatedContentRef.current || ""
      onUpdateMessage(currentMessageIdRef.current, {
        content: currentContent ? `${currentContent}\n\n[Stopped by user]` : "[Stopped by user]"
      })
    }

    currentExecutionIdRef.current = null
    currentMessageIdRef.current = null
    currentCursorRef.current = null
    onUpdateBranch({ status: BRANCH_STATUS.IDLE })
  }, [branch.messages, onUpdateMessage, onUpdateBranch])

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
          onUpdateBranch({ status: BRANCH_STATUS.STOPPED })
        } else if (currentStatus === BRANCH_STATUS.RUNNING && !pollingRef.current) {
          if (currentMessages && currentMessages.length > 0) {
            const lastAssistantMsg = [...currentMessages].reverse().find(m => m.role === "assistant" && !m.commitHash)
            if (lastAssistantMsg) {
              currentMessageIdRef.current = lastAssistantMsg.id
              startPollingRef.current(lastAssistantMsg.id, undefined, undefined, branch.agent)
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
                  startPollingRef.current(execData.execution.messageId, execData.execution.executionId, undefined, branch.agent)
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
    currentCursorRef,
    startPolling,
    stopPolling,
  }
}
