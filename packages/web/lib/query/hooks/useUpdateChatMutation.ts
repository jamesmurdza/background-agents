"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../keys"
import { updateChat as apiUpdateChat } from "@/lib/sync/api"
import type { Chat } from "@/lib/types"

type UpdateChatData = Parameters<typeof apiUpdateChat>[1]

interface UpdateChatParams {
  chatId: string
  data: UpdateChatData
}

/**
 * Returns a copy of `chat` with the defined fields from `data` applied.
 * Only fields explicitly present (not `undefined`) are overwritten, so a
 * partial update never clobbers existing values. Shared by the detail-cache
 * and list-cache optimistic updates so the field mapping lives in one place.
 */
function applyChatUpdate(chat: Chat, data: UpdateChatData): Chat {
  const updated: Chat = { ...chat }
  if (data.displayName !== undefined) updated.displayName = data.displayName
  if (data.status !== undefined) updated.status = data.status as Chat["status"]
  if (data.agent !== undefined) updated.agent = data.agent
  if (data.model !== undefined) updated.model = data.model
  if (data.planModeEnabled !== undefined) updated.planModeEnabled = data.planModeEnabled
  if (data.repo !== undefined) updated.repo = data.repo
  if (data.baseBranch !== undefined) updated.baseBranch = data.baseBranch
  if (data.branch !== undefined) updated.branch = data.branch
  if (data.environmentId !== undefined) updated.environmentId = data.environmentId
  // sandboxId / sessionId / previewUrlPattern / backgroundSessionId are
  // server-managed (see updateChat type) and never part of `data` here.
  if (data.needsSync !== undefined) updated.needsSync = data.needsSync
  if (data.lastActiveAt !== undefined) updated.lastActiveAt = data.lastActiveAt
  return updated
}

/**
 * Updates a chat.
 * Uses optimistic updates with rollback on error.
 */
export function useUpdateChatMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ chatId, data }: UpdateChatParams) => {
      return apiUpdateChat(chatId, data)
    },
    onMutate: async ({ chatId, data }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.chats.detail(chatId) })
      await queryClient.cancelQueries({ queryKey: queryKeys.chats.list() })

      // Snapshot previous values
      const previousChat = queryClient.getQueryData<Chat>(
        queryKeys.chats.detail(chatId)
      )
      const previousChats = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())

      // Optimistically update detail cache.
      // Only fields defined in `data` are applied (see applyChatUpdate).
      if (previousChat) {
        queryClient.setQueryData<Chat>(
          queryKeys.chats.detail(chatId),
          applyChatUpdate(previousChat, data)
        )
      }

      // Optimistically update list cache
      if (previousChats) {
        const updatedChats = previousChats.map((chat) =>
          chat.id === chatId ? applyChatUpdate(chat, data) : chat
        )
        queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), updatedChats)
      }

      return { previousChat, previousChats }
    },
    onError: (err, { chatId }, context) => {
      // Rollback on error
      if (context?.previousChat) {
        queryClient.setQueryData(queryKeys.chats.detail(chatId), context.previousChat)
      }
      if (context?.previousChats) {
        queryClient.setQueryData(queryKeys.chats.list(), context.previousChats)
      }
      console.error("Failed to update chat:", err)
    },
    onSettled: (_, __, { chatId }) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.detail(chatId) })
    },
  })
}
