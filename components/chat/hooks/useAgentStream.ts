import { useCallback, useRef } from "react"
import type { Branch, Message } from "@/lib/types"
import { BRANCH_STATUS } from "@/lib/constants"

interface UseAgentStreamOptions {
  branch: Branch
  repoName: string
  onUpdateMessage: (messageId: string, updates: Partial<Message>) => void
  onUpdateBranch: (updates: Partial<Branch>) => void
  onCommitsDetected?: () => void
}

/**
 * Hook for streaming agent responses via SSE
 */
export function useAgentStream({
  branch,
  repoName,
  onUpdateMessage,
  onUpdateBranch,
  onCommitsDetected,
}: UseAgentStreamOptions) {
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)

  const startStream = useCallback(async (messageId: string, prompt: string) => {
    // Abort any existing stream
    abortControllerRef.current?.abort()

    const controller = new AbortController()
    abortControllerRef.current = controller
    currentMessageIdRef.current = messageId

    let content = ""
    const toolCalls: { tool: string; summary: string }[] = []

    try {
      const response = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          prompt,
          previewUrlPattern: branch.previewUrlPattern,
          repoName,
          messageId,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to start agent")
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error("No response body")
      }

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE messages
        const lines = buffer.split("\n")
        buffer = lines.pop() || "" // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue

          const jsonStr = line.slice(6) // Remove "data: " prefix
          if (!jsonStr.trim()) continue

          try {
            const event = JSON.parse(jsonStr)

            switch (event.type) {
              case "stdout":
                content += event.content || ""
                onUpdateMessage(messageId, { content })
                break

              case "tool-start":
                toolCalls.push({
                  tool: event.tool,
                  summary: event.summary || event.tool,
                })
                onUpdateMessage(messageId, { content, toolCalls: [...toolCalls] })

                // Check for git commits
                if (event.tool === "shell" && event.summary?.includes("git commit")) {
                  onCommitsDetected?.()
                }
                break

              case "tool-delta":
                // Tool output delta - could append to content if desired
                break

              case "tool-end":
                // Tool completed
                break

              case "session-id":
                // Session ID received - stored on server
                break

              case "status":
                // Status update (e.g., "Starting sandbox...")
                if (event.message) {
                  onUpdateMessage(messageId, { content: event.message })
                }
                break

              case "error":
                content += `\n\nError: ${event.message}`
                onUpdateMessage(messageId, { content })
                break

              case "done":
                // Stream complete
                break
            }
          } catch {
            // Invalid JSON, skip
          }
        }
      }

      // Final update
      onUpdateMessage(messageId, { content, toolCalls })
      onUpdateBranch({ status: BRANCH_STATUS.IDLE })

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // Stream was aborted by user
        onUpdateBranch({ status: BRANCH_STATUS.IDLE })
        return
      }

      const message = err instanceof Error ? err.message : "Unknown error"
      content += `\n\nError: ${message}`
      onUpdateMessage(messageId, { content })
      onUpdateBranch({ status: BRANCH_STATUS.IDLE })
    } finally {
      currentMessageIdRef.current = null
      abortControllerRef.current = null
    }
  }, [branch.sandboxId, branch.previewUrlPattern, repoName, onUpdateMessage, onUpdateBranch, onCommitsDetected])

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    currentMessageIdRef.current = null
    onUpdateBranch({ status: BRANCH_STATUS.IDLE })
  }, [onUpdateBranch])

  return {
    currentMessageIdRef,
    startStream,
    stopStream,
  }
}
