"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useCallback, useEffect } from "react"
import { queryKeys } from "../query-keys"
import { apiPost } from "../fetcher"
import { EXECUTION_STATUS } from "@/lib/shared/constants"
import type { ToolCall, ContentBlock } from "@/lib/shared/types"

/**
 * Execution status response from /api/agent/status
 */
export interface ExecutionStatusResponse {
  status: "running" | "completed" | "error" | "stopped" | "unknown"
  content?: string
  toolCalls?: ToolCall[]
  contentBlocks?: ContentBlock[]
  error?: string
  agentCrashed?: boolean
}

/**
 * Active execution response from /api/agent/execution/active
 */
export interface ActiveExecutionResponse {
  execution?: {
    executionId: string
    messageId: string
    status: string
  }
}

interface UseExecutionStatusOptions {
  /**
   * Execution ID to poll
   */
  executionId: string | null
  /**
   * Message ID associated with the execution
   */
  messageId: string | null
  /**
   * Whether polling is enabled
   * @default true when executionId is provided
   */
  enabled?: boolean
  /**
   * Callback when status updates
   */
  onStatusUpdate?: (status: ExecutionStatusResponse) => void
  /**
   * Callback when execution completes (status is "completed" or "error")
   */
  onComplete?: (status: ExecutionStatusResponse) => void
}

/**
 * Fetch execution status from the API
 */
async function fetchExecutionStatus(
  executionId: string,
  messageId: string
): Promise<ExecutionStatusResponse> {
  return apiPost<ExecutionStatusResponse>("/api/agent/status", {
    executionId,
    messageId,
  })
}

/**
 * Hook to poll for execution status using TanStack Query
 *
 * This provides the core polling mechanism for agent execution status.
 * The complex side effects (message updates, commit detection) should
 * be handled by the caller using the onStatusUpdate and onComplete callbacks.
 *
 * Note: For the full execution polling experience with all side effects,
 * use the original useExecutionPolling hook which wraps this with
 * the necessary callbacks.
 */
export function useExecutionStatus(options: UseExecutionStatusOptions) {
  const {
    executionId,
    messageId,
    enabled = true,
    onStatusUpdate,
    onComplete,
  } = options

  // Track whether completion has been handled to avoid duplicate callbacks
  const completedRef = useRef(false)

  // Store callbacks in refs to avoid recreating the query
  const onStatusUpdateRef = useRef(onStatusUpdate)
  const onCompleteRef = useRef(onComplete)
  onStatusUpdateRef.current = onStatusUpdate
  onCompleteRef.current = onComplete

  // Reset completion flag when execution changes
  useEffect(() => {
    completedRef.current = false
  }, [executionId])

  const query = useQuery({
    queryKey: executionId
      ? queryKeys.execution.status(executionId)
      : ["disabled"],
    queryFn: async () => {
      const status = await fetchExecutionStatus(executionId!, messageId!)

      // Call status update handler
      onStatusUpdateRef.current?.(status)

      // Check for completion
      if (
        status.status === EXECUTION_STATUS.COMPLETED ||
        status.status === EXECUTION_STATUS.ERROR
      ) {
        if (!completedRef.current) {
          completedRef.current = true
          onCompleteRef.current?.(status)
        }
      }

      return status
    },
    enabled: enabled && !!executionId && !!messageId,
    // Polling configuration
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return 500

      // Stop polling when execution is complete
      if (
        data.status === EXECUTION_STATUS.COMPLETED ||
        data.status === EXECUTION_STATUS.ERROR ||
        data.status === "stopped"
      ) {
        return false
      }

      return 500 // 500ms polling interval
    },
    // Continue polling in background (user might switch branches)
    refetchIntervalInBackground: true,
    // Retry on failure
    retry: 10, // Match MAX_NOT_FOUND_RETRIES from original implementation
    retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 5000),
    // Don't refetch on window focus - polling handles it
    refetchOnWindowFocus: false,
    // No stale time - always fresh for polling
    staleTime: 0,
  })

  return {
    ...query,
    isPolling: query.isFetching && !completedRef.current,
    isCompleted:
      query.data?.status === EXECUTION_STATUS.COMPLETED ||
      query.data?.status === EXECUTION_STATUS.ERROR,
  }
}

/**
 * Hook to check for active execution on a branch
 *
 * Used to resume polling after page refresh.
 */
export function useActiveExecution(branchId: string | null) {
  return useQuery({
    queryKey: branchId ? queryKeys.execution.active(branchId) : ["disabled"],
    queryFn: async () => {
      const response = await apiPost<ActiveExecutionResponse>(
        "/api/agent/execution/active",
        { branchId }
      )
      return response
    },
    enabled: !!branchId,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

/**
 * Hook to invalidate execution queries
 */
export function useInvalidateExecution() {
  const queryClient = useQueryClient()

  return {
    /**
     * Invalidate a specific execution status query
     */
    invalidateStatus: (executionId: string) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.execution.status(executionId),
      })
    },

    /**
     * Invalidate active execution check for a branch
     */
    invalidateActive: (branchId: string) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.execution.active(branchId),
      })
    },

    /**
     * Clear all execution queries
     */
    clearAll: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.execution.all,
      })
    },
  }
}
