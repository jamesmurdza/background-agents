"use client"

import { useEffect, useRef, useCallback } from "react"
import {
  useExecutionStore,
  startPollingManager,
  type ExecutionContext,
} from "@/lib/stores/execution-store"
import type { Branch, Message } from "@/lib/shared/types"

interface UseExecutionManagerOptions {
  /** Update message in a specific branch */
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void | Promise<void>
  /** Update branch status/metadata */
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  /** Add message to a specific branch */
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  /** Force save to database */
  onForceSave: () => void
  /** Commits were detected */
  onCommitsDetected?: () => void
  /** Loop continuation callback */
  onLoopContinue?: (branchId: string) => void
  /** Refresh git conflict state */
  onRefreshGitConflictState?: () => void
}

/**
 * Hook to manage execution polling.
 *
 * This hook:
 * 1. Starts the global polling manager on mount
 * 2. Registers callbacks so the polling manager can update React state
 * 3. Provides methods to start/stop executions
 *
 * Unlike the old useExecutionPolling, this doesn't create polling loops -
 * it just connects the global polling manager to React state.
 */
export function useExecutionManager({
  onUpdateMessage,
  onUpdateBranch,
  onAddMessage,
  onForceSave,
  onCommitsDetected,
  onLoopContinue,
  onRefreshGitConflictState,
}: UseExecutionManagerOptions) {
  const setCallbacks = useExecutionStore(state => state.setCallbacks)
  const startExecution = useExecutionStore(state => state.startExecution)
  const stopExecution = useExecutionStore(state => state.stopExecution)
  const isStreaming = useExecutionStore(state => state.isStreaming)

  // Keep callback refs up to date
  const callbacksRef = useRef({
    onUpdateMessage,
    onUpdateBranch,
    onAddMessage,
    onForceSave,
    onCommitsDetected,
    onLoopContinue,
    onRefreshGitConflictState,
  })

  useEffect(() => {
    callbacksRef.current = {
      onUpdateMessage,
      onUpdateBranch,
      onAddMessage,
      onForceSave,
      onCommitsDetected,
      onLoopContinue,
      onRefreshGitConflictState,
    }
  })

  // Initialize polling manager and set callbacks on mount
  useEffect(() => {
    // Start the global polling manager (idempotent - only starts once)
    startPollingManager()

    // Set callbacks using wrapper functions that always use latest refs
    setCallbacks({
      onUpdateMessage: (branchId, messageId, updates) =>
        callbacksRef.current.onUpdateMessage(branchId, messageId, updates),
      onUpdateBranch: (branchId, updates) =>
        callbacksRef.current.onUpdateBranch(branchId, updates),
      onAddMessage: (branchId, message) =>
        callbacksRef.current.onAddMessage(branchId, message),
      onForceSave: () =>
        callbacksRef.current.onForceSave(),
      onCommitsDetected: () =>
        callbacksRef.current.onCommitsDetected?.(),
      onLoopContinue: (branchId) =>
        callbacksRef.current.onLoopContinue?.(branchId),
      onRefreshGitConflictState: () =>
        callbacksRef.current.onRefreshGitConflictState?.(),
    })
  }, [setCallbacks])

  /**
   * Start polling for an execution.
   * Call this after starting an agent execution.
   */
  const startPolling = useCallback((
    messageId: string,
    executionId: string,
    branch: Branch,
    repoContext: {
      repoName: string
      repoOwner: string
      repoApiName: string
    }
  ) => {
    const context: Omit<ExecutionContext, 'notFoundRetries' | 'highestSnapshotVersion' | 'completionHandled'> = {
      messageId,
      executionId,
      branchId: branch.id,
      sandboxId: branch.sandboxId || "",
      repoName: repoContext.repoName,
      repoOwner: repoContext.repoOwner,
      repoApiName: repoContext.repoApiName,
      branchName: branch.name,
      lastShownCommitHash: branch.lastShownCommitHash || null,
      messages: branch.messages,
      loopEnabled: branch.loopEnabled || false,
      loopCount: branch.loopCount || 0,
      loopMaxIterations: branch.loopMaxIterations || 10,
    }

    startExecution(context)
  }, [startExecution])

  /**
   * Stop polling for an execution.
   * Call this when user clicks stop.
   */
  const stopPolling = useCallback((messageId: string) => {
    stopExecution(messageId)
  }, [stopExecution])

  return {
    startPolling,
    stopPolling,
    isStreaming,
  }
}

export type ExecutionManager = ReturnType<typeof useExecutionManager>
