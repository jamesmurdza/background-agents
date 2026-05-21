"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../keys"
import { createChat as apiCreateChat, toChatType } from "@/lib/sync/api"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"

interface CreateChatParams {
  repo?: string
  baseBranch?: string
  parentChatId?: string
  agent?: string | null
  model?: string | null
  status?: Chat["status"]
  planModeEnabled?: boolean
}

/**
 * Creates a new chat.
 * Optimistically adds the chat to the cache.
 */
export function useCreateChatMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateChatParams): Promise<Chat> => {
      const serverChat = await apiCreateChat({
        repo: params.repo ?? NEW_REPOSITORY,
        baseBranch: params.baseBranch,
        parentChatId: params.parentChatId,
        agent: params.agent ?? undefined,
        model: params.model ?? undefined,
        status: params.status,
        planModeEnabled: params.planModeEnabled,
      })
      return toChatType(serverChat)
    },
    onSuccess: (newChat) => {
      // Add to the chats list cache
      queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (old = []) => [
        newChat,
        ...old,
      ])

      // Also set the detail cache
      queryClient.setQueryData(queryKeys.chats.detail(newChat.id), newChat)
    },
    onError: (error) => {
      console.error("Failed to create chat:", error)
    },
  })
}
