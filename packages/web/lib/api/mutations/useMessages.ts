"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../query-keys"
import { apiPost, apiPatch } from "../fetcher"
import type { Message, ToolCall, ContentBlock, AssistantSource } from "@/lib/shared/types"

/**
 * Parameters for adding a message
 */
interface AddMessageParams {
  branchId: string
  message: {
    role: "user" | "assistant"
    content: string
    toolCalls?: ToolCall[]
    contentBlocks?: ContentBlock[]
    timestamp: string
    commitHash?: string
    commitMessage?: string
    assistantSource?: AssistantSource
    pushError?: Message["pushError"]
  }
}

/**
 * Response from adding a message
 */
interface AddMessageResponse {
  message: {
    id: string
  }
}

/**
 * Parameters for updating a message
 */
interface UpdateMessageParams {
  messageId: string
  updates: {
    content?: string
    toolCalls?: ToolCall[]
    contentBlocks?: ContentBlock[]
    pushError?: Message["pushError"] | null
  }
}

/**
 * Mutation hook to add a message to a branch
 */
export function useAddMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ branchId, message }: AddMessageParams) => {
      return apiPost<AddMessageResponse>("/api/branches/messages", {
        branchId,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls,
        contentBlocks: message.contentBlocks,
        timestamp: message.timestamp,
        commitHash: message.commitHash,
        commitMessage: message.commitMessage,
        ...(message.role === "assistant" && {
          assistantSource:
            message.assistantSource ?? (message.commitHash ? "commit" : "model"),
        }),
        ...(message.pushError != null && { pushError: message.pushError }),
      })
    },
    onSuccess: (_, variables) => {
      // Invalidate branch messages
      queryClient.invalidateQueries({
        queryKey: queryKeys.branches.messages(variables.branchId),
      })
      // Invalidate sync data to update lastMessageId
      queryClient.invalidateQueries({
        queryKey: queryKeys.sync.data(),
      })
    },
    onError: (error) => {
      console.error("Failed to add message:", error)
    },
  })
}

/**
 * Mutation hook to update an existing message
 */
export function useUpdateMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ messageId, updates }: UpdateMessageParams) => {
      return apiPatch<{ success: boolean }>("/api/branches/messages", {
        messageId,
        ...updates,
      })
    },
    // Don't invalidate on message update - it's typically during streaming
    // and we don't want to interrupt the polling
    onError: (error) => {
      console.error("Failed to update message:", error)
    },
  })
}

/**
 * Hook to optimistically add a message to the cache
 * while the mutation is in flight
 */
export function useOptimisticAddMessage() {
  const queryClient = useQueryClient()
  const addMessageMutation = useAddMessage()

  return {
    ...addMessageMutation,
    /**
     * Add a message with optimistic update
     */
    mutateOptimistic: async (
      params: AddMessageParams & { tempId: string }
    ): Promise<string> => {
      const { branchId, message, tempId } = params

      // Optimistically add to cache
      // Note: This would need the cache structure from useBranchMessages
      // For now, just call the mutation
      const result = await addMessageMutation.mutateAsync({ branchId, message })

      return result.message.id
    },
  }
}
