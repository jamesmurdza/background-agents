"use client"

import { useRef, useCallback } from "react"
import type { Branch, Message, ToolCall } from "@/lib/shared/types"
import { detectAndShowCommits } from "@/lib/core/execution/detect-and-show-commits"

const DEBOUNCE_MS = 2500

interface UseDebouncedCommitDetectionOptions {
  branchRef: React.RefObject<Branch>
  repoName: string
  repoOwner: string
  repoApiName: string
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void | Promise<void>
  onUpdateBranch?: (branchId: string, updates: Partial<Branch>) => void
  onCommitsDetected?: () => void
  onRefreshGitConflictState?: () => void
}

/**
 * Provides debounced commit detection triggered by Bash tool calls.
 *
 * Commits only happen via `git commit` in Bash, so we only check for new
 * commits after Bash tool calls. Uses a 2.5s debounce to batch rapid calls.
 *
 * This is for real-time detection during execution - auto-commit-push still
 * only happens at the end of a turn via the main detectAndShowCommits call.
 */
export function useDebouncedCommitDetection({
  branchRef,
  repoName,
  repoOwner,
  repoApiName,
  onAddMessage,
  onUpdateMessage,
  onUpdateBranch,
  onCommitsDetected,
  onRefreshGitConflictState,
}: UseDebouncedCommitDetectionOptions) {
  const prevBashCountRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Store callbacks in ref to avoid stale closures
  const callbacksRef = useRef({
    onAddMessage,
    onUpdateMessage,
    onUpdateBranch,
    onCommitsDetected,
    onRefreshGitConflictState,
  })
  callbacksRef.current = {
    onAddMessage,
    onUpdateMessage,
    onUpdateBranch,
    onCommitsDetected,
    onRefreshGitConflictState,
  }

  /**
   * Call this after processing tool calls. If Bash count increased,
   * schedules a debounced commit detection.
   */
  const checkAfterToolCalls = useCallback((toolCalls: ToolCall[], branchId: string) => {
    const bashCount = toolCalls.filter(tc => tc.tool === "Bash").length
    if (bashCount <= prevBashCountRef.current) return

    prevBashCountRef.current = bashCount

    // Clear any pending check
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Schedule new check after debounce period
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null

      const b = branchRef.current
      if (!b?.sandboxId || !repoName) return

      detectAndShowCommits({
        runAutoCommit: false, // Just detect, don't auto-commit during execution
        sandboxId: b.sandboxId,
        branchId,
        branchName: b.name,
        repoName,
        repoOwner,
        repoApiName,
        lastShownCommitHash: b.lastShownCommitHash || null,
        messages: b.messages,
        onAddMessage: callbacksRef.current.onAddMessage,
        onUpdateMessage: callbacksRef.current.onUpdateMessage,
        onUpdateBranch: callbacksRef.current.onUpdateBranch,
        onCommitsDetected: callbacksRef.current.onCommitsDetected,
        onRefreshGitConflictState: callbacksRef.current.onRefreshGitConflictState,
      }).catch(() => {
        // Non-critical - commit detection failure shouldn't break anything
      })
    }, DEBOUNCE_MS)
  }, [branchRef, repoName, repoOwner, repoApiName])

  /**
   * Reset state. Call when starting a new polling session or on cleanup.
   */
  const reset = useCallback(() => {
    prevBashCountRef.current = 0
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  /**
   * Flush any pending debounced check. Call before the final
   * detectAndShowCommits at turn completion to avoid duplicate checks.
   */
  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  return { checkAfterToolCalls, reset, flush }
}
