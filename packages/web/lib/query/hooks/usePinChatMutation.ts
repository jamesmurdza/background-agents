"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../keys"
import { updateChat as apiUpdateChat } from "@/lib/sync/api"
import type { Chat } from "@/lib/types"

interface PinChatParams {
  chatId: string
  pinned: boolean
}

/**
 * Pins or unpins a single chat. Pinned chats sort to the top of the sidebar and
 * command palettes. Optimistically flips the flag in the list cache, then
 * reconciles against the server on settle. Unlike archiving, pinning does not
 * cascade to branched descendants — it's a per-chat preference.
 */
export function usePinChatMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ chatId, pinned }: PinChatParams) => {
      return apiUpdateChat(chatId, { pinned })
    },
    onMutate: async ({ chatId, pinned }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.chats.list() })

      const previousChats = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())

      if (previousChats) {
        queryClient.setQueryData<Chat[]>(
          queryKeys.chats.list(),
          previousChats.map((chat) =>
            chat.id === chatId ? { ...chat, pinned } : chat
          )
        )
      }

      return { previousChats }
    },
    onError: (err, _params, context) => {
      if (context?.previousChats) {
        queryClient.setQueryData(queryKeys.chats.list(), context.previousChats)
      }
      console.error("Failed to pin chat:", err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.list() })
    },
  })
}
